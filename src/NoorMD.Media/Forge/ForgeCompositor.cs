using System.Numerics;

namespace NoorMD.Media.Forge;

/// <summary>A texture set made by the layers: base colour, normal (tangent space, OpenGL), roughness, metallic, AO, height.</summary>
public sealed class ForgeTextures
{
    public required int Size { get; init; }
    /// <summary>RGB, 3 bytes a texel.</summary>
    public required byte[] BaseColor { get; init; }
    /// <summary>RGB, 3 bytes a texel, green up.</summary>
    public required byte[] Normal { get; init; }
    public required byte[] Roughness { get; init; }
    public required byte[] Metallic { get; init; }
    public required byte[] Ao { get; init; }
    /// <summary>0–255, mid grey neither raised nor sunk.</summary>
    public required byte[] Height { get; init; }

    public byte[] Png(string map) => map switch
    {
        "basecolor" => PngWriter.Rgb(Size, Size, BaseColor),
        "normal" => PngWriter.Rgb(Size, Size, Normal),
        "roughness" => PngWriter.Gray(Size, Size, Roughness),
        "metallic" => PngWriter.Gray(Size, Size, Metallic),
        "ao" => PngWriter.Gray(Size, Size, Ao),
        "height" => PngWriter.Gray(Size, Size, Height),
        "orm" => PngWriter.Rgb(Size, Size, Orm()),
        _ => throw new ArgumentException("Unknown map."),
    };

    /// <summary>Occlusion, roughness and metallic in the red, green and blue of one picture (glTF's and Unreal's packing).</summary>
    public byte[] Orm()
    {
        var px = new byte[Size * Size * 3];
        for (var i = 0; i < Size * Size; i++) { px[i * 3] = Ao[i]; px[i * 3 + 1] = Roughness[i]; px[i * 3 + 2] = Metallic[i]; }
        return px;
    }
}

/// <summary>
/// Layers into textures: each layer's material, projected onto the model from three sides (so no seam shows and every
/// material keeps its size in metres), shown where its mask says, over the layers below it.
/// </summary>
public static class ForgeCompositor
{
    /// <param name="materials">A Texture Bench preset's maps (cached by the caller), or null when it can't be made.</param>
    public static ForgeTextures Compose(ForgeModel model, int setIndex, ForgeBake bake, ForgeRecipe recipe, Func<string, TextureMaps?> materials)
    {
        var size = bake.Size;
        var n = size * size;
        var color = new Vector3[n]; var rough = new float[n]; var metal = new float[n]; var world = new Vector3[n]; var height = new float[n];
        for (var i = 0; i < n; i++) { color[i] = new Vector3(0.5f); rough[i] = 0.8f; world[i] = bake.Normal[i]; height[i] = 0.5f; }
        var span = bake.BoundsMax - bake.BoundsMin;
        foreach (var layer in recipe.Layers)
        {
            if (!layer.Visible || layer.Opacity <= 0) continue;
            var maps = layer.Material.Length > 0 ? materials(layer.Material) : null;
            var tint = Hex(layer.Color);
            // A tint over a material: mid grey leaves it as it is, a colour shifts it that way (darker, or brighter).
            var tinting = maps != null && layer.Color != "#808080";
            var tintScale = tint / Lin(128);
            var mask = layer.Mask;
            var scale = (float)layer.Scale;
            // Painted strokes: the mask worked out whole first (they add to it and take from it in order).
            var painted = layer.Strokes.Count > 0 ? ForgePaint.LayerMask(bake, layer, setIndex) : null;
            Parallel.For(0, n, i =>
            {
                if (bake.Covered[i] == 0) return;
                var m = (painted != null ? painted[i] : MaskAt(mask, bake, i, setIndex, span)) * (float)layer.Opacity;
                if (m <= 0) return;
                var p = bake.Position[i] / scale;
                var ng = bake.Normal[i];
                Vector3 c; float r, mt, h; Vector3 nw;
                if (maps != null)
                {
                    var (alb, ro, me, he, tn) = Triplanar(maps, p, ng);
                    c = tinting ? Vector3.Min(alb * tintScale, Vector3.One) : alb; r = ro; mt = me; h = he;
                    nw = Vector3.Normalize(ng + tn * (float)layer.NormalStrength);
                }
                else { c = tint; r = (float)layer.Roughness; mt = (float)layer.Metallic; h = (float)layer.Height; nw = ng; }
                if (layer.UseColor) color[i] = Vector3.Lerp(color[i], c, m);
                if (layer.UseRoughness) rough[i] += (r - rough[i]) * m;
                if (layer.UseMetallic) metal[i] += (mt - metal[i]) * m;
                if (layer.UseHeight) height[i] += (h - height[i]) * m;
                if (layer.UseNormal && maps != null) world[i] = Vector3.Normalize(Vector3.Lerp(world[i], nw, m));
            });
        }
        // Out: the normal in the surface's own tangent frame; everything bled outwards past the charts' edges.
        var outColor = new byte[n * 3]; var outNormal = new byte[n * 3]; var outRough = new byte[n]; var outMetal = new byte[n]; var outAo = new byte[n]; var outHeight = new byte[n];
        for (var i = 0; i < n; i++)
        {
            if (bake.Covered[i] == 0) { outNormal[i * 3] = 128; outNormal[i * 3 + 1] = 128; outNormal[i * 3 + 2] = 255; outHeight[i] = 128; continue; }
            var c = color[i];
            outColor[i * 3] = B(Srgb(c.X)); outColor[i * 3 + 1] = B(Srgb(c.Y)); outColor[i * 3 + 2] = B(Srgb(c.Z));
            var w = world[i];
            var t = new Vector3(Vector3.Dot(w, bake.Tangent[i]), Vector3.Dot(w, bake.Bitangent[i]), Vector3.Dot(w, bake.Normal[i]));
            if (t.Z < 0.05f) t.Z = 0.05f;
            t = Vector3.Normalize(t);
            outNormal[i * 3] = B(t.X * 0.5f + 0.5f); outNormal[i * 3 + 1] = B(t.Y * 0.5f + 0.5f); outNormal[i * 3 + 2] = B(t.Z * 0.5f + 0.5f);
            outRough[i] = B(rough[i]); outMetal[i] = B(metal[i]); outAo[i] = B(bake.Ao[i]); outHeight[i] = B(height[i]);
        }
        Bleed(bake.Covered, size, outColor, 3); Bleed(bake.Covered, size, outNormal, 3); Bleed(bake.Covered, size, outRough, 1); Bleed(bake.Covered, size, outMetal, 1); Bleed(bake.Covered, size, outAo, 1); Bleed(bake.Covered, size, outHeight, 1);
        return new ForgeTextures { Size = size, BaseColor = outColor, Normal = outNormal, Roughness = outRough, Metallic = outMetal, Ao = outAo, Height = outHeight };
    }

    /// <summary>Where one layer shows (its mask times its opacity), 0–255 a texel: for looking at it on the model.</summary>
    public static byte[] Mask(ForgeBake bake, ForgeLayer layer, int setIndex)
    {
        var n = bake.Size * bake.Size;
        var px = new byte[n];
        var v = ForgePaint.LayerMask(bake, layer, setIndex);
        for (var i = 0; i < n; i++) if (bake.Covered[i] != 0) px[i] = B(v[i] * (float)layer.Opacity);
        Bleed(bake.Covered, bake.Size, px, 1);
        return px;
    }

    /// <summary>The mask's value at a texel, 0–1.</summary>
    internal static float MaskAt(ForgeMask mask, ForgeBake bake, int i, int setIndex, Vector3 span)
    {
        float x;
        var a = (float)mask.Amount;
        switch (mask.Kind)
        {
            case "all": return mask.Invert ? 0 : 1;
            case "none": return mask.Invert ? 1 : 0;
            case "part": x = bake.Part[i] == mask.Index ? 1 : 0; return mask.Invert ? 1 - x : x;
            case "material": x = setIndex == mask.Index ? 1 : 0; return mask.Invert ? 1 - x : x;
            case "edges": x = bake.Curvature[i]; break;                                                  // −1…1, edges high
            case "cavity": x = MathF.Max(-bake.Curvature[i], Math.Clamp((1 - bake.Ao[i]) * 2.5f, 0, 1)); break; // creases and hidden places
            case "top": x = bake.Normal[i].Y; break;                                                     // −1…1, up high
            case "bottom": x = -bake.Normal[i].Y; break;
            default: x = span.Y > 1e-6f ? 1 - (bake.Position[i].Y - bake.BoundsMin.Y) / span.Y : 0; break; // height: low on the model high
        }
        // Noise moves the border about (in metres, on the surface), so edges and patches look natural.
        if (mask.Noise > 0) x += (Fbm(bake.Position[i] / (float)mask.NoiseScale) - 0.5f) * 2 * (float)mask.Noise * (mask.Kind is "edges" or "top" or "bottom" ? 0.6f : 0.4f);
        // Amount moves the threshold: more amount, more of the model covered.
        var threshold = mask.Kind is "edges" or "top" or "bottom" ? 1 - 2 * a : 1 - a;
        var soft = 0.02f + (float)mask.Softness * 0.5f;
        var v = Smooth(threshold - soft, threshold + soft, x);
        return mask.Invert ? 1 - v : v;
    }

    private static float Smooth(float e0, float e1, float x) { var t = Math.Clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

    /// <summary>The material at a point, from three sides blended by the normal: colour (linear), roughness, metal, height and the normal's tilt (world).</summary>
    private static (Vector3 Albedo, float Rough, float Metal, float Height, Vector3 Tilt) Triplanar(TextureMaps maps, Vector3 p, Vector3 n)
    {
        var w = new Vector3(MathF.Pow(MathF.Abs(n.X), 4), MathF.Pow(MathF.Abs(n.Y), 4), MathF.Pow(MathF.Abs(n.Z), 4));
        w /= w.X + w.Y + w.Z + 1e-6f;
        Vector3 alb = default, tilt = default; float ro = 0, me = 0, he = 0;
        // Each side: its UV axes in world space (the normal map's x and y run along them).
        void Side(float weight, float u, float v, Vector3 uAxis, Vector3 vAxis)
        {
            if (weight < 0.01f) return;
            var (c, r, m, h, tx, ty) = Sample(maps, u, v);
            alb += c * weight; ro += r * weight; me += m * weight; he += h * weight;
            tilt += (uAxis * tx + vAxis * ty) * weight;
        }
        Side(w.X, p.Z * MathF.Sign(n.X == 0 ? 1 : n.X), p.Y, Vector3.UnitZ * MathF.Sign(n.X == 0 ? 1 : n.X), Vector3.UnitY);
        Side(w.Y, p.X, p.Z * MathF.Sign(n.Y == 0 ? 1 : n.Y), Vector3.UnitX, Vector3.UnitZ * MathF.Sign(n.Y == 0 ? 1 : n.Y));
        Side(w.Z, -p.X * MathF.Sign(n.Z == 0 ? 1 : n.Z), p.Y, -Vector3.UnitX * MathF.Sign(n.Z == 0 ? 1 : n.Z), Vector3.UnitY);
        return (alb, ro, me, he, tilt - n * Vector3.Dot(tilt, n));
    }

    /// <summary>One tiling texel of the maps, bilinear: linear colour, roughness, metal, height and the normal's x and y (−1…1).</summary>
    private static (Vector3 C, float R, float M, float H, float Tx, float Ty) Sample(TextureMaps maps, float u, float v)
    {
        var s = maps.Size;
        var fx = (u - MathF.Floor(u)) * s - 0.5f; var fy = (1 - (v - MathF.Floor(v))) * s - 0.5f;
        int x0 = (int)MathF.Floor(fx), y0 = (int)MathF.Floor(fy);
        float ax = fx - x0, ay = fy - y0;
        Vector3 c = default; float r = 0, m = 0, h = 0, tx = 0, ty = 0;
        var heights = maps.HeightOut ?? maps.Height;
        for (var k = 0; k < 4; k++)
        {
            int xx = ((x0 + (k & 1)) % s + s) % s, yy = ((y0 + (k >> 1)) % s + s) % s;
            var wgt = ((k & 1) == 1 ? ax : 1 - ax) * ((k >> 1) == 1 ? ay : 1 - ay);
            var i = yy * s + xx;
            c += new Vector3(Lin(maps.Albedo[i * 3]), Lin(maps.Albedo[i * 3 + 1]), Lin(maps.Albedo[i * 3 + 2])) * wgt;
            r += maps.Roughness[i] / 255f * wgt; m += maps.Metallic[i] / 255f * wgt; h += Math.Clamp(heights[i], 0, 1) * wgt;
            tx += (maps.Normal[i * 3] / 255f * 2 - 1) * wgt; ty += (maps.Normal[i * 3 + 1] / 255f * 2 - 1) * wgt;
        }
        return (c, r, m, h, tx, ty);
    }

    private static readonly float[] LinTable = Enumerable.Range(0, 256).Select(v => { var c = v / 255.0; return (float)(c <= 0.04045 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4)); }).ToArray();
    private static float Lin(byte v) => LinTable[v];
    private static float Srgb(float c) => c <= 0.0031308f ? c * 12.92f : 1.055f * MathF.Pow(MathF.Max(0, c), 1 / 2.4f) - 0.055f;
    private static byte B(float v) => (byte)Math.Clamp((int)MathF.Round(v * 255), 0, 255);

    private static Vector3 Hex(string hex)
    {
        int v = Convert.ToInt32(hex[1..], 16);
        return new Vector3(Lin((byte)(v >> 16)), Lin((byte)(v >> 8)), Lin((byte)v));
    }

    /// <summary>Texels outside the charts take their neighbours' values, ring by ring, so filtering never shows a seam.</summary>
    private static void Bleed(byte[] covered, int size, byte[] px, int ch, int rings = 12)
    {
        var have = (byte[])covered.Clone();
        Span<int> sum = stackalloc int[4];
        for (var ring = 0; ring < rings; ring++)
        {
            var next = (byte[])have.Clone();
            for (var y = 0; y < size; y++)
                for (var x = 0; x < size; x++)
                {
                    var i = y * size + x;
                    if (have[i] != 0) continue;
                    sum.Clear(); var count = 0;
                    for (var dy = -1; dy <= 1; dy++)
                        for (var dx = -1; dx <= 1; dx++)
                        {
                            int xx = x + dx, yy = y + dy;
                            if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
                            var j = yy * size + xx;
                            if (have[j] == 0) continue;
                            for (var c = 0; c < ch; c++) sum[c] += px[j * ch + c];
                            count++;
                        }
                    if (count == 0) continue;
                    for (var c = 0; c < ch; c++) px[i * ch + c] = (byte)(sum[c] / count);
                    next[i] = 1;
                }
            have = next;
        }
    }

    // ------------------------------------------------------------------ noise (3D, on the surface)

    private static float Hash(int x, int y, int z)
    {
        var h = (uint)(x * 374761393 + y * 668265263 + z * 1274126177);
        h = (h ^ (h >> 13)) * 1274126177u;
        return ((h ^ (h >> 16)) & 0xFFFFFF) / (float)0xFFFFFF;
    }

    private static float Value(Vector3 p)
    {
        int x = (int)MathF.Floor(p.X), y = (int)MathF.Floor(p.Y), z = (int)MathF.Floor(p.Z);
        float fx = p.X - x, fy = p.Y - y, fz = p.Z - z;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
        float L(float a, float b, float t) => a + (b - a) * t;
        return L(L(L(Hash(x, y, z), Hash(x + 1, y, z), fx), L(Hash(x, y + 1, z), Hash(x + 1, y + 1, z), fx), fy),
                 L(L(Hash(x, y, z + 1), Hash(x + 1, y, z + 1), fx), L(Hash(x, y + 1, z + 1), Hash(x + 1, y + 1, z + 1), fx), fy), fz);
    }

    /// <summary>Fractal noise 0–1 (four octaves).</summary>
    internal static float Fbm(Vector3 p)
    {
        float sum = 0, amp = 0.5f, norm = 0;
        for (var o = 0; o < 4; o++) { sum += Value(p) * amp; norm += amp; p = p * 2.03f + new Vector3(17.1f, 3.7f, 9.3f); amp *= 0.5f; }
        return sum / norm;
    }
}
