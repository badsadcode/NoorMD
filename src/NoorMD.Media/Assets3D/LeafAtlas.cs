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

    public static byte[] Rgba(string shape, string color, string color2, bool stylized, int size, int seed, string cluster = "twig") => Pixels(shape, color, color2, stylized, size, seed, cluster).Png();

    /// <summary>
    /// What one card shows: "twig" (one stem with its leaves), "spray" (three stems fanning out: about three times the
    /// leaves) or "cluster" (five stems, small leaves filling the card). More leaves per card means a full crown from
    /// fewer cards, so fewer triangles.
    /// </summary>
    public static readonly string[] Clusters = ["twig", "spray", "cluster"];

    public static RawImage Pixels(string shape, string color, string color2, bool stylized, int size, int seed, string cluster = "twig")
    {
        var px = new float[size * size * 4];
        var c1 = Hex(color);
        var c2 = Hex(color2);
        var stemColour = Vector3.Lerp(c1, new Vector3(0.35f, 0.27f, 0.15f), 0.6f);
        var half = size / 2;
        // Fronds and moss are whole sprites of their own; the rest can be a twig, a spray or a cluster.
        if (shape is "frond" or "moss") cluster = "twig";
        for (var cell = 0; cell < 4; cell++)
        {
            var rng = new Random(seed * 31 + cell);
            int ox = (cell & 1) * half, oy = (cell >> 1) * half;
            // Sprite space: x −0.55…0.55 across, y 0 (anchor, bottom) … 1 (top). Stems start at the anchor and fan out.
            var leaves = new List<(Vector2 Base, Vector2 Dir, float Len, float Width, Vector3 Col)>();
            var fan = cluster switch
            {
                "spray" => new[] { (-0.6f, 0.62f), (0f, 0.92f), (0.6f, 0.62f) },
                "cluster" => new[] { (-1f, 0.5f), (-0.5f, 0.72f), (0f, 0.9f), (0.5f, 0.72f), (1f, 0.5f) },
                _ => new[] { (0f, 0.92f) },
            };
            var stems = fan.Select(f => (Angle: f.Item1 + (float)(rng.NextDouble() - 0.5) * 0.2f, Length: f.Item2 * (0.92f + 0.12f * (float)rng.NextDouble()), Bend: (float)(rng.NextDouble() - 0.5) * 0.3f)).ToList();
            Vector2 StemAt((float Angle, float Length, float Bend) st, float t)
            {
                var local = new Vector2(st.Bend * t * t, t * st.Length);
                // Side stems leave the anchor at their angle and curve up a little, as twigs do.
                var a = st.Angle * (1 - 0.35f * t);
                return new Vector2(local.X * MathF.Cos(a) + local.Y * MathF.Sin(a), -local.X * MathF.Sin(a) + local.Y * MathF.Cos(a));
            }
            // Stylized sprites are fuller: a tuft of leaves, not a twig. Sprays and clusters share them out among
            // their stems, smaller.
            var count = shape switch { "needle" => 70, "maple" => 3, "round" => 9, "slender" => 16, "frond" => 60, "moss" => 46, _ => 7 } + (stylized && shape is not ("needle" or "moss" or "frond") ? 5 : 0);
            var (perStem, scale) = cluster switch { "spray" => (0.85f, 0.72f), "cluster" => (0.8f, 0.56f), _ => (1f, 1f) };
            foreach (var st in stems)
            {
                var n = Math.Max(2, (int)MathF.Round(count * perStem * (st.Length / 0.92f)));
                for (var k = 0; k < n; k++)
                {
                    if (shape == "moss")
                    {
                        // Hanging moss: thin strands from the anchor, a little apart, of uneven length (the card hangs them down).
                        var bx = ((float)rng.NextDouble() - 0.5f) * 0.5f;
                        var ma = ((float)rng.NextDouble() - 0.5f) * 0.5f;
                        leaves.Add((new Vector2(bx, (float)rng.NextDouble() * 0.1f), Vector2.Normalize(new Vector2(MathF.Sin(ma), MathF.Cos(ma))), 0.45f + 0.5f * (float)rng.NextDouble(), 0.05f,
                            Vector3.Lerp(c1, c2, (float)rng.NextDouble())));
                        continue;
                    }
                    var t = shape is "needle" or "frond" ? 0.04f + 0.92f * k / n : 0.18f + 0.8f * (k + 0.5f) / n;
                    var side = k % 2 == 0 ? 1 : -1;
                    var spread = shape switch { "needle" => 0.75f, "maple" => 0.75f, "slender" => 0.32f, "frond" => 1.35f, _ => 0.85f };
                    var angle = st.Angle * (1 - 0.35f * t) + side * (spread + (float)(rng.NextDouble() - 0.5) * 0.4f) * (1 - 0.5f * t);
                    var dir = Vector2.Normalize(new Vector2(MathF.Sin(angle), MathF.Cos(angle)));
                    var len = shape switch
                    {
                        "needle" => 0.42f, "round" => 0.28f, "maple" => 0.5f, "slender" => 0.34f,
                        "frond" => 0.5f * MathF.Pow(MathF.Max(0, MathF.Sin(MathF.PI * MathF.Min(1, t * 1.05f))), 0.6f) / (1 - 0.35f * t),
                        _ => 0.4f,
                    } * (1 - 0.35f * t) * (0.85f + 0.3f * (float)rng.NextDouble()) * scale;
                    var width = shape switch { "needle" => 0.07f, "round" => 0.55f, "maple" => 0.9f, "slender" => 0.17f, "frond" => 0.15f, _ => 0.36f };
                    var col = Vector3.Lerp(c1, c2, (float)rng.NextDouble() * 0.8f + t * 0.2f);
                    var at = StemAt(st, t);
                    leaves.Add((at, dir, Fit(at, dir, len), width, col));
                }
                // The top leaf, straight on.
                if (shape is not ("needle" or "moss" or "frond"))
                {
                    var at = StemAt(st, 0.97f);
                    var dir = Vector2.Normalize(StemAt(st, 1) - StemAt(st, 0.9f));
                    leaves.Add((at, dir, Fit(at, dir, (shape == "maple" ? 0.5f : 0.36f) * scale), shape == "round" ? 0.55f : shape == "maple" ? 0.9f : 0.36f, Vector3.Lerp(c1, c2, 0.6f)));
                }
            }
            // Each blade's bounding circle, so a pixel only measures the blades that can reach it.
            var reach = leaves.Select(l => (Centre: l.Base + l.Dir * l.Len * 0.5f, Radius: l.Len * (0.5f + l.Width * 0.6f) + 0.02f)).ToArray();

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
                    // Stems (thicker near the anchor).
                    var ds = float.MaxValue;
                    if (shape != "moss")
                        foreach (var st in stems)
                            for (var k = 0; k < 6; k++) ds = MathF.Min(ds, SegmentDistance(p, StemAt(st, k / 6f * 0.97f), StemAt(st, (k + 1) / 6f * 0.97f)));
                    ds -= 0.012f * (1.2f - sy);
                    var stemA = Math.Clamp(0.5f - ds / aa, 0, 1);
                    if (stemA > 0 && shape != "moss") { alpha = stemA; rgb = stemColour; }
                    for (var li = 0; li < leaves.Count; li++)
                    {
                        if (Vector2.DistanceSquared(p, reach[li].Centre) > reach[li].Radius * reach[li].Radius) continue;
                        var (b, dir, len, width, col) = leaves[li];
                        var (d, along, across) = LeafDistance(shape == "moss" ? "needle" : shape, p - b, dir, len, width);
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
        return new RawImage(size, size, bytes);
    }

    /// <summary>A soft vertical gradient (dark at the bottom of the crown, light at the top) for stylized leaf clumps.</summary>
    /// <summary>
    /// A leaf picture's PBR maps, for engines that light leaves fully: a tangent-space normal map (OpenGL, green up)
    /// from a height made of the leaves' coverage and brightness (raised blades, sunken edges and veins), and an ORM map
    /// (R occlusion: darker where the leaves are thin and at their edges; G roughness: a waxy 0.5–0.7; B metallic 0).
    /// Outside the leaves: flat and fully lit. Both PNG, RGB, the picture's size.
    /// </summary>
    public static (byte[] Normal, byte[] Orm) Maps(RawImage colour, float strength = 3)
    {
        var (normal, orm) = MapPixels(colour, strength);
        return (PngWriter.Rgb(colour.Width, colour.Height, normal), PngWriter.Rgb(colour.Width, colour.Height, orm));
    }

    /// <summary>The same maps as RGB pixels (3 bytes each).</summary>
    internal static (byte[] Normal, byte[] Orm) MapPixels(RawImage colour, float strength = 3)
    {
        int w = colour.Width, h = colour.Height;
        var height = new float[w * h];
        for (var i = 0; i < w * h; i++)
        {
            var a = colour.Rgba[i * 4 + 3] / 255f;
            var luma = (colour.Rgba[i * 4] * 0.3f + colour.Rgba[i * 4 + 1] * 0.59f + colour.Rgba[i * 4 + 2] * 0.11f) / 255f;
            height[i] = a * (0.55f + 0.45f * luma);
        }
        // A little blur, so the edges slope instead of stepping.
        var soft = new float[w * h];
        for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++)
            {
                float sum = 0;
                for (var dy = -1; dy <= 1; dy++)
                    for (var dx = -1; dx <= 1; dx++)
                        sum += height[Math.Clamp(y + dy, 0, h - 1) * w + Math.Clamp(x + dx, 0, w - 1)];
                soft[y * w + x] = sum / 9;
            }
        float H(int x, int y) => soft[Math.Clamp(y, 0, h - 1) * w + Math.Clamp(x, 0, w - 1)];
        var normal = new byte[w * h * 3];
        var orm = new byte[w * h * 3];
        var scale = strength * w / 256f;
        for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++)
            {
                var i = y * w + x;
                // Image rows go down, so the slope towards +V (up the picture) is the row above minus the row below.
                var dx = (H(x + 1, y) - H(x - 1, y)) * scale;
                var dy = (H(x, y - 1) - H(x, y + 1)) * scale;
                var n = Vector3.Normalize(new Vector3(-dx, -dy, 1));
                normal[i * 3] = (byte)Math.Round((n.X * 0.5f + 0.5f) * 255);
                normal[i * 3 + 1] = (byte)Math.Round((n.Y * 0.5f + 0.5f) * 255);
                normal[i * 3 + 2] = (byte)Math.Round((n.Z * 0.5f + 0.5f) * 255);
                var cover = colour.Rgba[i * 4 + 3] / 255f;
                orm[i * 3] = (byte)Math.Round(255 * (cover <= 0 ? 1 : 0.7f + 0.3f * soft[i]));
                orm[i * 3 + 1] = (byte)Math.Round(255 * (0.7f - 0.2f * soft[i]));
                orm[i * 3 + 2] = 0;
            }
        return (normal, orm);
    }

    public static byte[] Gradient(string color, string color2, int height = 64) => GradientPixels(color, color2, height).Png();

    public static RawImage GradientPixels(string color, string color2, int height = 64)
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
        return new RawImage(4, height, px);
    }

    /// <summary>A blade's length, shortened if its tip would leave the cell (no leaves cut off at the card's edge).</summary>
    private static float Fit(Vector2 at, Vector2 dir, float len)
    {
        var f = 1f;
        if (dir.X > 1e-4f) f = MathF.Min(f, (0.52f - at.X) / (dir.X * len));
        if (dir.X < -1e-4f) f = MathF.Min(f, (-0.52f - at.X) / (dir.X * len));
        if (dir.Y > 1e-4f) f = MathF.Min(f, (0.99f - at.Y) / (dir.Y * len));
        if (dir.Y < -1e-4f) f = MathF.Min(f, (0.01f - at.Y) / (dir.Y * len));
        return len * Math.Clamp(f, 0.35f, 1);
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
            _ => MathF.Pow(MathF.Max(0, MathF.Sin(MathF.PI * MathF.Pow(t, 0.75f))), 0.9f),
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
