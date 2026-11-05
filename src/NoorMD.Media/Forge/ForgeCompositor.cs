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
    /// <param name="materials">NoorMaterial preset's maps (cached by the caller), or null when it can't be made.</param>
    /// <param name="images">An image paint layer's picture by its version (null when it isn't known).</param>
    public static ForgeTextures Compose(ForgeModel model, int setIndex, ForgeBake bake, ForgeRecipe recipe, Func<string, TextureMaps?> materials, Func<string, (int Size, byte[][] Pixels)?>? images = null)
    {
        var size = bake.Size;
        var n = size * size;
        var color = new Vector3[n]; var rough = new float[n]; var metal = new float[n]; var world = new Vector3[n]; var height = new float[n];
        for (var i = 0; i < n; i++) { color[i] = new Vector3(0.5f); rough[i] = 0.8f; world[i] = bake.Shade(i); height[i] = 0.5f; }
        var span = bake.BoundsMax - bake.BoundsMin;
        // Each layer's mask as worked out, for the layers above that follow it.
        var masks = new Dictionary<string, float[]>(StringComparer.Ordinal);
        var folders = recipe.Layers.Where(l => l.IsFolder).ToDictionary(l => l.Id, StringComparer.Ordinal);
        var folderMasks = new Dictionary<string, float[]>(StringComparer.Ordinal);
        float[]? FolderMask(ForgeLayer f) { if (!folderMasks.TryGetValue(f.Id, out var fm)) folderMasks[f.Id] = fm = ForgePaint.LayerMask(bake, f, setIndex, recipe.Picture, id => masks.GetValueOrDefault(id)); return fm; }
        foreach (var layer in recipe.Layers)
        {
            // A folder paints nothing; the layers inside it use its mask, opacity and visibility.
            if (layer.IsFolder) { masks[layer.Id] = FolderMask(layer)!; continue; }
            var mk = ForgePaint.LayerMask(bake, layer, setIndex, recipe.Picture, id => masks.GetValueOrDefault(id), out var painted);
            var folder = layer.Folder.Length > 0 && folders.TryGetValue(layer.Folder, out var fl) ? fl : null;
            if (folder != null)
            {
                if (!folder.Visible || folder.Opacity <= 0) { masks[layer.Id] = mk; continue; }
                var fm = FolderMask(folder)!; var fo = (float)folder.Opacity;
                var inside = new float[n];
                for (var i = 0; i < n; i++) inside[i] = mk[i] * fm[i] * fo;
                mk = inside;
            }
            masks[layer.Id] = mk;
            // Strokes that paint their own maps (colour, roughness, metal, height: each its own coverage and value).
            var ch = ForgePaint.HasChannels(layer) ? ForgePaint.Channels(bake, layer, mk, recipe.Picture) : null;
            if (ch != null && layer.Image == null)
            {
                var shown = new float[n];
                for (var i = 0; i < n; i++) shown[i] = MathF.Max(MathF.Max(ch.ColorCover[i], ch.RoughCover[i]), MathF.Max(ch.MetalCover[i], ch.HeightCover[i]));
                masks[layer.Id] = shown;
            }
            if (!layer.Visible || layer.Opacity <= 0) continue;
            if (ch != null)
            {
                var o = (float)layer.Opacity;
                var plain = layer.Image == null; // a painting's colour comes from its picture, below
                float[]? fmask = folder != null ? FolderMask(folder) : null; var fop = folder != null ? (float)folder.Opacity : 1;
                Parallel.For(0, n, i =>
                {
                    if (bake.Covered[i] == 0) return;
                    float a; var fo = fmask != null ? fmask[i] * fop : 1;
                    if (plain && (a = ch.ColorCover[i] * o * fo * (float)layer.ColorOpacity) > 0) color[i] = Vector3.Lerp(color[i], ForgeFilters.BlendColor(layer.ColorBlend, color[i], AdjustOf(layer, ch.Color[i])), a);
                    if ((a = ch.RoughCover[i] * o * fo * (float)layer.RoughOpacity) > 0) rough[i] += (ForgeFilters.BlendValue(layer.RoughBlend, rough[i], ch.Rough[i]) - rough[i]) * a;
                    if ((a = ch.MetalCover[i] * o * fo * (float)layer.MetalOpacity) > 0) metal[i] += (ForgeFilters.BlendValue(layer.MetalBlend, metal[i], ch.Metal[i]) - metal[i]) * a;
                    if ((a = ch.HeightCover[i] * o * fo * (float)layer.HeightOpacity) > 0) height[i] += (ForgeFilters.BlendValue(layer.HeightBlend, height[i], ch.Height[i], true) - height[i]) * a;
                });
                if (plain) continue;
            }
            var maps = layer.Material.Length > 0 ? materials(layer.MaterialKey) : null;
            var tint = Hex(layer.Color);
            // A tint over a material: mid grey leaves it as it is, a colour shifts it that way (darker, or brighter).
            var tinting = maps != null && layer.Color != "#808080";
            var tintScale = tint / Lin(128);
            var mask = layer.Mask;
            var scale = (float)layer.Scale;
            // An image paint layer: its picture's colour, shown by its alpha (its mask still applies on top).
            var picture = layer.Image != null ? images?.Invoke(layer.Image) : null;
            var pixels = picture is { } pic && setIndex < pic.Pixels.Length ? pic.Pixels[setIndex] : null;
            if (layer.Image != null && pixels == null) continue; // nothing painted on this set (or not known): shows nothing
            Parallel.For(0, n, i =>
            {
                if (bake.Covered[i] == 0) return;
                var m = mk[i] * (float)layer.Opacity;
                if (m <= 0) return;
                Vector3? fromImage = null;
                if (pixels != null)
                {
                    var (pr, pg, pb, pa) = ForgeImagePaint.Sample(pixels, picture!.Value.Size, (i % size + 0.5f) / size, (i / size + 0.5f) / size);
                    m *= pa;
                    if (m <= 0) return;
                    fromImage = new Vector3(Lin((byte)Math.Round(pr * 255)), Lin((byte)Math.Round(pg * 255)), Lin((byte)Math.Round(pb * 255)));
                }
                var p = bake.Position[i] / scale;
                var ng = bake.Shade(i); // the high-poly model's normal, after a high-poly bake
                Vector3 c; float r, mt, h; Vector3 nw;
                if (maps != null)
                {
                    var (alb, ro, me, he, tn) = Triplanar(maps, p, ng);
                    c = tinting ? Vector3.Min(alb * tintScale, Vector3.One) : alb; r = ro; mt = me; h = he;
                    nw = Vector3.Normalize(ng + tn * (float)layer.NormalStrength);
                }
                else { c = fromImage ?? (painted != null ? painted[i] : tint); r = (float)layer.Roughness; mt = (float)layer.Metallic; h = (float)layer.Height; nw = ng; }
                if (layer.UseColor) color[i] = Vector3.Lerp(color[i], ForgeFilters.BlendColor(layer.ColorBlend, color[i], AdjustOf(layer, c)), m * (float)layer.ColorOpacity);
                if (layer.UseRoughness) rough[i] += (ForgeFilters.BlendValue(layer.RoughBlend, rough[i], r) - rough[i]) * m * (float)layer.RoughOpacity;
                if (layer.UseMetallic) metal[i] += (ForgeFilters.BlendValue(layer.MetalBlend, metal[i], mt) - metal[i]) * m * (float)layer.MetalOpacity;
                if (layer.UseHeight) height[i] += (ForgeFilters.BlendValue(layer.HeightBlend, height[i], h, true) - height[i]) * m * (float)layer.HeightOpacity;
                if (layer.UseNormal && maps != null) world[i] = Vector3.Normalize(Vector3.Lerp(world[i], nw, m));
            });
        }
        if (recipe.Relief > 0) Relief(bake, height, world, (float)(recipe.Relief * 0.01 * span.Length()));
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

    private static Vector3 AdjustOf(ForgeLayer l, Vector3 c) => l.Hue == 0 && l.Saturation == 0 && l.Brightness == 0 && l.Contrast == 0 ? c : ForgeFilters.Adjust(c, (float)l.Hue, (float)l.Saturation, (float)l.Brightness, (float)l.Contrast);

    /// <summary>
    /// The layers' height as bumps (as a painting program turns height into normal detail): its slope across the
    /// surface, in metres (depth: the full height range), tilts each texel's normal. Neighbours on another chart (far
    /// away on the model) or not on it are left out, so charts' edges make no false bumps.
    /// </summary>
    internal static void Relief(ForgeBake bake, float[] height, Vector3[] world, float depth)
    {
        var size = bake.Size;
        var tilted = new Vector3[world.Length];
        Parallel.For(0, size, y =>
        {
            for (var x = 0; x < size; x++)
            {
                var i = y * size + x;
                tilted[i] = world[i];
                if (bake.Covered[i] == 0) continue;
                // A neighbour counts if it is on the model and next to this texel there too.
                bool Near(int xx, int yy, out int j)
                {
                    j = yy * size + xx;
                    if (xx < 0 || yy < 0 || xx >= size || yy >= size || bake.Covered[j] == 0) return false;
                    return (bake.Position[j] - bake.Position[i]).LengthSquared() < Gap(bake, i) * Gap(bake, i);
                }
                float Slope(int dx, int dy)
                {
                    var hasA = Near(x + dx, y + dy, out var a); var hasB = Near(x - dx, y - dy, out var b);
                    if (!hasA && !hasB) return 0;
                    var ia = hasA ? a : i; var ib = hasB ? b : i;
                    var d = (bake.Position[ia] - bake.Position[ib]).Length();
                    return d > 1e-9f ? (height[ia] - height[ib]) * depth / d : 0;
                }
                // Along the tangent (+u: right) and the bitangent (+v: up the picture, so a row above).
                var su = Slope(1, 0); var sv = Slope(0, -1);
                if (su == 0 && sv == 0) continue;
                var n = world[i];
                var t = bake.Tangent[i] - n * Vector3.Dot(n, bake.Tangent[i]);
                var bt = bake.Bitangent[i] - n * Vector3.Dot(n, bake.Bitangent[i]);
                tilted[i] = Vector3.Normalize(n - t * su - bt * sv);
            }
        });
        Array.Copy(tilted, world, world.Length);
    }

    /// <summary>How far a texel's neighbour may be on the model (more is another chart): a few texels' worth.</summary>
    private static float Gap(ForgeBake bake, int i) => (bake.BoundsMax - bake.BoundsMin).Length() / bake.Size * 6;

    /// <summary>Where one layer shows (its mask times its opacity), 0–255 a texel: for looking at it on the model.</summary>
    public static byte[] Mask(ForgeBake bake, ForgeLayer layer, int setIndex, Func<string, ForgePicture?>? pictures = null) =>
        Mask(bake, new ForgeRecipe { Layers = [layer] }, 0, setIndex, pictures);

    /// <summary>A layer of a recipe's mask (with the masks below it, for one that follows another).</summary>
    public static byte[] Mask(ForgeBake bake, ForgeRecipe recipe, int layerIndex, int setIndex, Func<string, ForgePicture?>? pictures = null, Func<string, (int Size, byte[][] Pixels)?>? images = null)
    {
        var n = bake.Size * bake.Size;
        var px = new byte[n];
        var masks = new Dictionary<string, float[]>(StringComparer.Ordinal);
        float[] v = [];
        for (var k = 0; k <= layerIndex; k++)
        {
            var l = recipe.Layers[k];
            v = ForgePaint.LayerMask(bake, l, setIndex, pictures ?? recipe.Picture, id => masks.GetValueOrDefault(id));
            // A paint layer whose strokes paint their own maps shows wherever any of them is painted.
            if (ForgePaint.HasChannels(l) && l.Image == null)
            {
                var ch = ForgePaint.Channels(bake, l, v, pictures ?? recipe.Picture);
                v = Enumerable.Range(0, n).Select(i => MathF.Max(MathF.Max(ch.ColorCover[i], ch.RoughCover[i]), MathF.Max(ch.MetalCover[i], ch.HeightCover[i]))).ToArray();
            }
            masks[l.Id] = v;
        }
        var layer = recipe.Layers[layerIndex];
        // An image paint layer shows where it is painted (its alpha) too.
        var picture = layer.Image != null ? images?.Invoke(layer.Image) : null;
        var image = picture is { } pic && setIndex < pic.Pixels.Length ? pic.Pixels[setIndex] : null;
        var size = bake.Size;
        for (var i = 0; i < n; i++)
            if (bake.Covered[i] != 0)
                px[i] = B(v[i] * (float)layer.Opacity * (layer.Image == null ? 1 : image == null ? 0 : ForgeImagePaint.Sample(image, picture!.Value.Size, (i % size + 0.5f) / size, (i / size + 0.5f) / size).A));
        Bleed(bake.Covered, bake.Size, px, 1);
        return px;
    }

    /// <summary>The mask's value at a texel, 0–1.</summary>
    internal static float MaskAt(ForgeMask mask, ForgeBake bake, int i, int setIndex, Vector3 span, float[]? given = null)
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
            case "chips": x = ForgeMasks.Chips(bake, i, mask); break;                                    // edges, broken into chunks
            case "layer" or "drips": x = given?[i] ?? 0; break;                                          // worked out for the whole model
            case "cavity": x = MathF.Max(-bake.Curvature[i], Math.Clamp((1 - bake.Ao[i]) * 2.5f, 0, 1)); break; // creases and hidden places
            case "top": x = bake.Shade(i).Y; break;                                                      // −1…1, up high
            case "bottom": x = -bake.Shade(i).Y; break;
            default: x = span.Y > 1e-6f ? 1 - (bake.Position[i].Y - bake.BoundsMin.Y) / span.Y : 0; break; // height: low on the model high
        }
        // Noise moves the border about (in metres, on the surface), so edges and patches look natural.
        // (Chips and drips use theirs for the chunks and the streaks.)
        if (mask.Noise > 0 && mask.Kind is not ("chips" or "drips")) x += (Fbm(bake.Position[i] / (float)mask.NoiseScale) - 0.5f) * 2 * (float)mask.Noise * (mask.Kind is "edges" or "top" or "bottom" ? 0.6f : 0.4f);
        // Amount moves the threshold: more amount, more of the model covered.
        var threshold = mask.Kind is "edges" or "chips" or "top" or "bottom" ? 1 - 2 * a : 1 - a;
        var soft = 0.02f + (float)mask.Softness * 0.5f;
        var v = Smooth(threshold - soft, threshold + soft, x);
        return mask.Invert && mask.Kind != "layer" ? 1 - v : v; // (a followed layer was turned round before)
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

    internal static Vector3 Hex(string hex)
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
