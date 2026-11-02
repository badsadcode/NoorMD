using System.IO.Compression;

namespace NoorMD.Media.Forge;

/// <summary>
/// Image paint layers: pictures painted straight onto the model, pixel by pixel (as Blender's texture painting), one
/// RGBA picture per texture set laid out like the model's UVs (row 0 is v = 1), at the layer's own size. Alpha is
/// where it is painted. Every change is a new version that keeps only the 64-pixel tiles it changed (before and after,
/// compressed), so undo and redo to any version are cheap and the page keeps its usual undo of the recipe.
/// </summary>
public sealed class ForgeImageStore
{
    public const int Tile = 64;
    public const int MaxSize = 4096;

    private sealed class Version
    {
        public required string Id { get; init; }
        public string? Parent { get; init; }
        public required string Root { get; init; }
        public required int Size { get; init; }
        public required int Sets { get; init; }
        /// <summary>The changed tiles: (set, tile) → before and after, each compressed.</summary>
        public Dictionary<(int Set, int Tile), (byte[] Before, byte[] After)> Patches { get; } = [];
    }

    private readonly Dictionary<string, Version> _versions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, byte[][]> _bases = new(StringComparer.Ordinal);            // root → its pixels as made
    private readonly Dictionary<string, (string At, byte[][] Pixels)> _working = new(StringComparer.Ordinal); // root → pixels at a version
    private readonly object _gate = new();

    /// <summary>A new picture (its first version): one RGBA buffer per texture set, each size × size.</summary>
    public string Create(int size, byte[][] pixels)
    {
        if (size is < 16 or > MaxSize) throw new ArgumentException("That picture size can't be painted.");
        if (pixels.Length == 0 || pixels.Any(p => p.Length != size * size * 4)) throw new ArgumentException("The picture doesn't match its size.");
        var id = "i" + Guid.NewGuid().ToString("N")[..12];
        lock (_gate)
        {
            _versions[id] = new Version { Id = id, Root = id, Size = size, Sets = pixels.Length };
            _bases[id] = pixels.Select(p => (byte[])p.Clone()).ToArray();
            _working[id] = (id, pixels.Select(p => (byte[])p.Clone()).ToArray());
        }
        return id;
    }

    public bool Has(string? id) { if (id == null) return false; lock (_gate) return _versions.ContainsKey(id); }

    /// <summary>The picture at a version: its size and a copy of each set's pixels (null when it isn't known).</summary>
    public (int Size, byte[][] Pixels)? Get(string? id)
    {
        if (id == null) return null;
        lock (_gate)
        {
            if (!_versions.TryGetValue(id, out var v)) return null;
            var px = At(v);
            return (v.Size, px.Select(p => (byte[])p.Clone()).ToArray());
        }
    }

    /// <summary>
    /// A change to one set of a version: the texels it will touch (to know the tiles), then the change on its pixels.
    /// Returns the new version (or the same one when nothing is touched).
    /// </summary>
    public string Edit(string id, int set, IReadOnlyCollection<int> texels, Action<byte[]> apply)
    {
        lock (_gate)
        {
            if (!_versions.TryGetValue(id, out var v)) throw new ArgumentException("That painting is no longer here (paint it again or open its recipe).");
            if (set < 0 || set >= v.Sets) throw new ArgumentException("No such texture set.");
            if (texels.Count == 0) return id;
            var px = At(v)[set];
            var perRow = (v.Size + Tile - 1) / Tile;
            var tiles = texels.Select(i => (i % v.Size) / Tile + (i / v.Size) / Tile * perRow).Distinct().ToList();
            var before = tiles.ToDictionary(t => t, t => Cut(px, v.Size, t));
            apply(px);
            var next = new Version { Id = "i" + Guid.NewGuid().ToString("N")[..12], Parent = id, Root = v.Root, Size = v.Size, Sets = v.Sets };
            foreach (var t in tiles) next.Patches[(set, t)] = (Pack(before[t]), Pack(Cut(px, v.Size, t)));
            _versions[next.Id] = next;
            _working[v.Root] = (next.Id, _working[v.Root].Pixels);
            return next.Id;
        }
    }

    /// <summary>The working pixels of a version's picture, moved to that version (undoing and redoing tiles as needed).</summary>
    private byte[][] At(Version v)
    {
        if (!_working.TryGetValue(v.Root, out var w)) w = _working[v.Root] = (v.Root, _bases[v.Root].Select(p => (byte[])p.Clone()).ToArray());
        if (w.At == v.Id) return w.Pixels;
        var up = Chain(w.At); var down = Chain(v.Id);
        var common = up.FirstOrDefault(down.Contains) ?? v.Root;
        foreach (var id in up.TakeWhile(x => x != common)) Put(w.Pixels, _versions[id], before: true);
        foreach (var id in down.TakeWhile(x => x != common).Reverse()) Put(w.Pixels, _versions[id], before: false);
        _working[v.Root] = (v.Id, w.Pixels);
        return w.Pixels;
    }

    private List<string> Chain(string id)
    {
        var list = new List<string>();
        for (var at = id; at != null; at = _versions[at].Parent) list.Add(at);
        return list;
    }

    private static void Put(byte[][] pixels, Version v, bool before)
    {
        var perRow = (v.Size + Tile - 1) / Tile;
        foreach (var ((set, tile), (b, a)) in v.Patches)
        {
            var data = Unpack(before ? b : a);
            int tx = tile % perRow * Tile, ty = tile / perRow * Tile, w = Math.Min(Tile, v.Size - tx), h = Math.Min(Tile, v.Size - ty);
            for (var y = 0; y < h; y++) Buffer.BlockCopy(data, y * w * 4, pixels[set], ((ty + y) * v.Size + tx) * 4, w * 4);
        }
    }

    private static byte[] Cut(byte[] px, int size, int tile)
    {
        var perRow = (size + Tile - 1) / Tile;
        int tx = tile % perRow * Tile, ty = tile / perRow * Tile, w = Math.Min(Tile, size - tx), h = Math.Min(Tile, size - ty);
        var o = new byte[w * h * 4];
        for (var y = 0; y < h; y++) Buffer.BlockCopy(px, ((ty + y) * size + tx) * 4, o, y * w * 4, w * 4);
        return o;
    }

    private static byte[] Pack(byte[] raw)
    {
        using var ms = new MemoryStream();
        using (var z = new DeflateStream(ms, CompressionLevel.Fastest, leaveOpen: true)) z.Write(raw);
        return ms.ToArray();
    }

    private static byte[] Unpack(byte[] packed)
    {
        using var z = new DeflateStream(new MemoryStream(packed), CompressionMode.Decompress);
        using var ms = new MemoryStream();
        z.CopyTo(ms);
        return ms.ToArray();
    }

    /// <summary>A blank picture: nothing painted (fully see-through).</summary>
    public static byte[][] Blank(int size, int sets) => Enumerable.Range(0, sets).Select(_ => new byte[size * size * 4]).ToArray();

    /// <summary>A picture (RGBA, any size) resized to size × size (bilinear), as the model's UVs lay it out.</summary>
    public static byte[] Resize(byte[] rgba, int w, int h, int size)
    {
        var o = new byte[size * size * 4];
        Parallel.For(0, size, y =>
        {
            var fy = (y + 0.5) * h / size - 0.5; var y0 = (int)Math.Floor(fy); var ay = fy - y0;
            for (var x = 0; x < size; x++)
            {
                var fx = (x + 0.5) * w / size - 0.5; var x0 = (int)Math.Floor(fx); var ax = fx - x0;
                for (var c = 0; c < 4; c++)
                {
                    double S(int xx, int yy) => rgba[(Math.Clamp(yy, 0, h - 1) * w + Math.Clamp(xx, 0, w - 1)) * 4 + c];
                    var v = (S(x0, y0) * (1 - ax) + S(x0 + 1, y0) * ax) * (1 - ay) + (S(x0, y0 + 1) * (1 - ax) + S(x0 + 1, y0 + 1) * ax) * ay;
                    o[(y * size + x) * 4 + c] = (byte)Math.Clamp(Math.Round(v), 0, 255);
                }
            }
        });
        return o;
    }
}

/// <summary>Strokes painted into an image layer's pixels (the same dabs, tips, stencils and fills as everywhere).</summary>
public static class ForgeImagePaint
{
    /// <summary>
    /// One stroke into one set's pixels (painted with a bake of the model at the picture's size): its colour over what
    /// is there as much as it covers (alpha grows), or, erasing, taken away (alpha shrinks).
    /// </summary>
    public static string Apply(ForgeImageStore store, string image, int set, ForgeBake bake, ForgeStroke stroke, string fallbackColor, Func<string, ForgePicture?>? pictures = null)
    {
        var cover = ForgePaint.Coverage(bake, stroke, pictures);
        if (cover.Count == 0) return image;
        var hex = stroke.Color ?? fallbackColor;
        var rgb = Convert.ToInt32(hex[1..], 16);
        float cr = (rgb >> 16) & 255, cg = (rgb >> 8) & 255, cb = rgb & 255;
        return store.Edit(image, set, cover.Keys, px =>
        {
            foreach (var (i, a) in cover)
            {
                var o = i * 4;
                var old = px[o + 3] / 255f;
                if (stroke.Erase) { px[o + 3] = (byte)Math.Round(old * (1 - a) * 255); continue; }
                var na = a + old * (1 - a);
                if (na <= 1e-6f) continue;
                // The brush's colour blended with what is painted here (as much as something is: over bare texels it is
                // the brush's own colour), then laid over it.
                float sr = cr, sg = cg, sb = cb;
                if (stroke.Blend != null && old > 0)
                {
                    var (br, bg, bb) = BlendRgb(stroke.Blend, (cr / 255f, cg / 255f, cb / 255f), (px[o] / 255f, px[o + 1] / 255f, px[o + 2] / 255f));
                    sr = cr + (br * 255 - cr) * old; sg = cg + (bg * 255 - cg) * old; sb = cb + (bb * 255 - cb) * old;
                }
                float Mix(float c, byte was) => (c * a + was * old * (1 - a)) / na;
                px[o] = (byte)Math.Clamp(Math.Round(Mix(sr, px[o])), 0, 255);
                px[o + 1] = (byte)Math.Clamp(Math.Round(Mix(sg, px[o + 1])), 0, 255);
                px[o + 2] = (byte)Math.Clamp(Math.Round(Mix(sb, px[o + 2])), 0, 255);
                px[o + 3] = (byte)Math.Clamp(Math.Round(na * 255), 0, 255);
            }
        });
    }

    /// <summary>A brush colour (s) blended onto a colour (d), both 0–1, by a blend mode's name.</summary>
    public static (float R, float G, float B) BlendRgb(string mode, (float R, float G, float B) s, (float R, float G, float B) d)
    {
        static float Each(string m, float s, float d) => m switch
        {
            "multiply" => s * d,
            "screen" => 1 - (1 - s) * (1 - d),
            "overlay" => d < 0.5f ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d),
            "softlight" => (1 - 2 * s) * d * d + 2 * s * d,
            "add" => Math.Min(1, s + d),
            "subtract" => Math.Max(0, d - s),
            "darken" => Math.Min(s, d),
            "lighten" => Math.Max(s, d),
            _ => s,
        };
        if (mode is "hue" or "saturation" or "color" or "value")
        {
            var (sh, ss, sv) = Hsv(s); var (dh, ds, dv) = Hsv(d);
            return mode switch
            {
                "hue" => Rgb(sh, ds, dv),
                "saturation" => Rgb(dh, ss, dv),
                "color" => Rgb(sh, ss, dv),
                _ => Rgb(dh, ds, sv),
            };
        }
        return (Each(mode, s.R, d.R), Each(mode, s.G, d.G), Each(mode, s.B, d.B));
    }

    private static (float H, float S, float V) Hsv((float R, float G, float B) c)
    {
        var max = Math.Max(c.R, Math.Max(c.G, c.B)); var min = Math.Min(c.R, Math.Min(c.G, c.B)); var d = max - min;
        var h = d <= 1e-6f ? 0 : max == c.R ? (c.G - c.B) / d % 6 : max == c.G ? (c.B - c.R) / d + 2 : (c.R - c.G) / d + 4;
        if (h < 0) h += 6;
        return (h / 6, max <= 1e-6f ? 0 : d / max, max);
    }

    private static (float R, float G, float B) Rgb(float h, float s, float v)
    {
        var k = (float n) => { var x = (n + h * 6) % 6; return v - v * s * Math.Max(0, Math.Min(Math.Min(x, 4 - x), 1)); };
        return (k(5), k(3), k(1));
    }

    /// <summary>
    /// The picture's colour and how much is painted at a point of the texture (u, v as the bake's texel grid: 0–1 across
    /// and down), bilinear and weighted by what is painted (no dark rims where paint meets bare texels).
    /// </summary>
    public static (float R, float G, float B, float A) Sample(byte[] px, int size, float u, float v)
    {
        var fx = u * size - 0.5f; var fy = v * size - 0.5f;
        var x0 = (int)MathF.Floor(fx); var y0 = (int)MathF.Floor(fy);
        float ax = fx - x0, ay = fy - y0;
        float r = 0, g = 0, b = 0, alpha = 0;
        for (var k = 0; k < 4; k++)
        {
            int xx = Math.Clamp(x0 + (k & 1), 0, size - 1), yy = Math.Clamp(y0 + (k >> 1), 0, size - 1);
            var w = ((k & 1) == 1 ? ax : 1 - ax) * ((k >> 1) == 1 ? ay : 1 - ay);
            var o = (yy * size + xx) * 4;
            var a = px[o + 3] / 255f * w;
            r += px[o] * a; g += px[o + 1] * a; b += px[o + 2] * a; alpha += a;
        }
        return alpha > 1e-6f ? (r / alpha / 255f, g / alpha / 255f, b / alpha / 255f, alpha) : (0, 0, 0, 0);
    }
}
