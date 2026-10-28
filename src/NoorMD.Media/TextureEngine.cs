using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Media;

// Texture Bench: tileable procedural materials. A stack of layers builds a height field (0–1); the surface settings
// turn it into PBR maps (albedo, normal, roughness, ambient occlusion, metallic, height). Every generator works on
// whole-number frequencies over a wrapped lattice, so every map tiles without a seam, at any size. The same recipe
// and seed always give the same pixels.

/// <summary>One step of the height stack: a generator, how it is shaped, and how it is blended onto what is below.</summary>
public sealed class TextureLayer
{
    public static readonly string[] Types = ["noise", "ridged", "turbulence", "cells", "wood", "bricks", "weave", "scratches", "image", "current", "curvature"];
    public static readonly string[] Blends = ["normal", "add", "subtract", "multiply", "screen", "overlay", "max", "min"];

    public string Id { get; set; } = "";
    public string Name { get; set; } = "Layer";
    public string Type { get; set; } = "noise";
    public bool Mute { get; set; }
    /// <summary>How many times the pattern repeats across the tile (whole numbers keep it seamless).</summary>
    public int ScaleX { get; set; } = 4;
    public int ScaleY { get; set; } = 4;
    // fractal detail
    public int Octaves { get; set; } = 5;
    public double Persistence { get; set; } = 0.5;
    public int Lacunarity { get; set; } = 2;
    /// <summary>Domain warp: how far (0–1) the pattern is pushed around by a noise of WarpScale.</summary>
    public double Warp { get; set; }
    public int WarpScale { get; set; } = 3;
    /// <summary>Cells: "cells" (round bumps), "edges" (raised borders), "cracks" (thin dark lines), "stones" (flat stones with gaps).</summary>
    public string Mode { get; set; } = "cells";
    /// <summary>Cells: how far feature points wander from their cell's centre (0 = a grid, 1 = random).</summary>
    public double Jitter { get; set; } = 1;
    // bricks (ScaleX = bricks across, ScaleY = rows)
    public double Mortar { get; set; } = 0.08;
    public double Bevel { get; set; } = 0.1;
    public double Offset { get; set; } = 0.5;
    /// <summary>Bricks and stones: how much each one's height differs (0–1).</summary>
    public double Variation { get; set; } = 0.3;
    // scratches
    public int Count { get; set; } = 40;
    public double Length { get; set; } = 0.2;
    public double Width { get; set; } = 0.004;
    // shaping and blending
    public double Low { get; set; }
    public double High { get; set; } = 1;
    public double Gamma { get; set; } = 1;
    public bool Invert { get; set; }
    public string Blend { get; set; } = "normal";
    public double Opacity { get; set; } = 1;
    /// <summary>Added to the recipe's seed for this layer (two layers of the same kind can differ).</summary>
    public int SeedShift { get; set; }

    // Painting the surface (any layer): where this layer is high, the albedo takes Tint (by TintAmount), the roughness
    // and metallic move by their shifts (−1…1). Moss on the tops of stones, wet puddles in the dips, rust on metal.
    public string? Tint { get; set; }
    public double TintAmount { get; set; }
    public double RoughnessShift { get; set; }
    public double MetallicShift { get; set; }

    // image: a picture you picked (Path, shown as ImageName), repeated ScaleX × ScaleY times across the tile.
    public string? Path { get; set; }
    public string? ImageName { get; set; }
    /// <summary>How wide (0–0.5 of the picture) its edges are blended with a half-shifted copy, so it tiles.</summary>
    public double SeamBlend { get; set; } = 0.15;
    /// <summary>Evening out the light baked into a photo (0–1), over DelightRadius (0.02–1 of the picture).</summary>
    public double Delight { get; set; }
    public double DelightRadius { get; set; } = 0.25;
    /// <summary>Height from the picture's fine, medium and large detail (0–1 each).</summary>
    public double DetailFine { get; set; } = 0.4;
    public double DetailMedium { get; set; } = 0.7;
    public double DetailLarge { get; set; } = 0.5;
    /// <summary>A colour of the picture that is high (amount above 0) or low (below 0), within a tolerance (0.02–1).</summary>
    public string? HeightColor { get; set; }
    public double HeightColorAmount { get; set; }
    public double HeightColorTolerance { get; set; } = 0.15;
    /// <summary>How much of the picture's own colours go on the albedo (0–1).</summary>
    public double ColorAmount { get; set; } = 1;

    public TextureLayer Clone() => (TextureLayer)MemberwiseClone();
}

public sealed class RampStop
{
    public double Pos { get; set; }
    public string Color { get; set; } = "#808080";
}

/// <summary>How the height becomes a surface.</summary>
public sealed class TextureSurface
{
    /// <summary>Albedo: colours along the height (0 = deepest, 1 = highest).</summary>
    public List<RampStop> Ramp { get; set; } = [new() { Pos = 0, Color = "#3a3a3a" }, new() { Pos = 1, Color = "#bdbdbd" }];
    /// <summary>A slow colour drift that doesn't follow the height (0–1).</summary>
    public double ColorVariation { get; set; } = 0.15;
    /// <summary>Dirt: how much the cavities darken the albedo (0–1).</summary>
    public double Dirt { get; set; } = 0.3;
    public double RoughnessLow { get; set; } = 0.9;
    public double RoughnessHigh { get; set; } = 0.6;
    public double RoughnessVariation { get; set; } = 0.1;
    public double Metallic { get; set; }
    /// <summary>How steep the normal map makes the height look (0–20).</summary>
    public double NormalStrength { get; set; } = 4;
    public double AoStrength { get; set; } = 0.6;
    /// <summary>How wide around a point the AO looks (fraction of the tile, 0.002–0.1).</summary>
    public double AoRadius { get; set; } = 0.02;
}

public sealed class TextureRecipe
{
    public int Version { get; set; } = 1;
    public string Name { get; set; } = "Untitled material";
    public string Family { get; set; } = "Custom";
    public int Seed { get; set; } = 1;
    public List<TextureLayer> Layers { get; set; } = [];
    public TextureSurface Surface { get; set; } = new();

    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.Never };
    public string ToJson() => JsonSerializer.Serialize(this, Options);
    public static TextureRecipe FromJson(string json) => (JsonSerializer.Deserialize<TextureRecipe>(json, Options) ?? new TextureRecipe()).Clamped();
    public TextureRecipe Clone() => FromJson(ToJson());

    public const int MaxLayers = 12;
    private static double C(double v, double lo, double hi) => double.IsFinite(v) ? Math.Clamp(v, lo, hi) : lo;

    public TextureRecipe Clamped()
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "Untitled material" : Name.Trim()[..Math.Min(Name.Trim().Length, 80)];
        Family = string.IsNullOrWhiteSpace(Family) ? "Custom" : Family.Trim()[..Math.Min(Family.Trim().Length, 40)];
        Seed = Math.Clamp(Seed, 0, int.MaxValue);
        Layers = (Layers ?? []).Where(l => l != null).Take(MaxLayers).ToList();
        foreach (var l in Layers)
        {
            l.Type = TextureLayer.Types.Contains(l.Type) ? l.Type : "noise";
            l.Name = string.IsNullOrWhiteSpace(l.Name) ? "Layer" : l.Name.Trim()[..Math.Min(l.Name.Trim().Length, 40)];
            l.ScaleX = Math.Clamp(l.ScaleX, 1, 256); l.ScaleY = Math.Clamp(l.ScaleY, 1, 256);
            l.Octaves = Math.Clamp(l.Octaves, 1, 10); l.Persistence = C(l.Persistence, 0, 1); l.Lacunarity = Math.Clamp(l.Lacunarity, 2, 4);
            l.Warp = C(l.Warp, 0, 1); l.WarpScale = Math.Clamp(l.WarpScale, 1, 64);
            l.Mode = l.Mode is "cells" or "edges" or "cracks" or "stones" ? l.Mode : "cells";
            l.Jitter = C(l.Jitter, 0, 1);
            l.Mortar = C(l.Mortar, 0, 0.5); l.Bevel = C(l.Bevel, 0, 0.5); l.Offset = C(l.Offset, 0, 1); l.Variation = C(l.Variation, 0, 1);
            l.Count = Math.Clamp(l.Count, 0, 500); l.Length = C(l.Length, 0.005, 1); l.Width = C(l.Width, 0.0005, 0.05);
            l.Low = C(l.Low, 0, 1); l.High = C(l.High, 0, 1); l.Gamma = C(l.Gamma, 0.1, 10);
            l.Blend = TextureLayer.Blends.Contains(l.Blend) ? l.Blend : "normal";
            l.Opacity = C(l.Opacity, 0, 1);
            l.SeedShift = Math.Clamp(l.SeedShift, -100000, 100000);
            l.Tint = l.Tint == null ? null : HexOrNull(l.Tint); l.TintAmount = C(l.TintAmount, 0, 1);
            l.RoughnessShift = double.IsFinite(l.RoughnessShift) ? Math.Clamp(l.RoughnessShift, -1, 1) : 0;
            l.MetallicShift = double.IsFinite(l.MetallicShift) ? Math.Clamp(l.MetallicShift, -1, 1) : 0;
            if (l.Path != null && (l.Path.Length > 1000 || l.Path.Any(char.IsControl))) l.Path = null;
            if (l.ImageName != null) l.ImageName = l.ImageName.Length > 120 ? l.ImageName[..120] : l.ImageName;
            l.SeamBlend = C(l.SeamBlend, 0, 0.5); l.Delight = C(l.Delight, 0, 1); l.DelightRadius = C(l.DelightRadius, 0.02, 1);
            l.DetailFine = C(l.DetailFine, 0, 1); l.DetailMedium = C(l.DetailMedium, 0, 1); l.DetailLarge = C(l.DetailLarge, 0, 1);
            l.HeightColor = l.HeightColor == null ? null : HexOrNull(l.HeightColor);
            l.HeightColorAmount = double.IsFinite(l.HeightColorAmount) ? Math.Clamp(l.HeightColorAmount, -1, 1) : 0;
            l.HeightColorTolerance = C(l.HeightColorTolerance, 0.02, 1); l.ColorAmount = C(l.ColorAmount, 0, 1);
            // Patterns that alternate need an even count to meet themselves at the edge.
            if (l.Type == "weave") { l.ScaleX += l.ScaleX & 1; l.ScaleY += l.ScaleY & 1; }
            if (l.Type == "bricks" && l.Offset > 0) l.ScaleY += l.ScaleY & 1;
        }
        // Stable ids, as in the Sound Bench: valid ones kept (the first of repeats), the others the lowest free number.
        var used = new HashSet<string>(StringComparer.Ordinal);
        var keep = Layers.Select(l => l.Id is { Length: > 1 and <= 8 } id && id[0] == 'T' && id[1..].All(char.IsAsciiDigit) && used.Add(id)).ToList();
        for (var i = 0; i < Layers.Count; i++) { if (keep[i]) continue; var n = 1; while (!used.Add("T" + n)) n++; Layers[i].Id = "T" + n; }
        Surface ??= new();
        var s = Surface;
        s.Ramp = (s.Ramp ?? []).Where(r => r != null).Take(16).Select(r => { r.Pos = C(r.Pos, 0, 1); r.Color = Hex(r.Color); return r; }).OrderBy(r => r.Pos).ToList();
        if (s.Ramp.Count == 0) s.Ramp = [new() { Pos = 0, Color = "#000000" }, new() { Pos = 1, Color = "#ffffff" }];
        s.ColorVariation = C(s.ColorVariation, 0, 1); s.Dirt = C(s.Dirt, 0, 1);
        s.RoughnessLow = C(s.RoughnessLow, 0, 1); s.RoughnessHigh = C(s.RoughnessHigh, 0, 1); s.RoughnessVariation = C(s.RoughnessVariation, 0, 1);
        s.Metallic = C(s.Metallic, 0, 1); s.NormalStrength = C(s.NormalStrength, 0, 20); s.AoStrength = C(s.AoStrength, 0, 1); s.AoRadius = C(s.AoRadius, 0.002, 0.1);
        return this;
    }

    private static string? HexOrNull(string c) => c is { Length: 7 } && c[0] == '#' && c[1..].All(Uri.IsHexDigit) ? c.ToLowerInvariant() : null;

    /// <summary>Pictures the recipe reads (image layers).</summary>
    public IEnumerable<string> Files() => (Layers ?? []).Where(l => l.Type == "image" && !string.IsNullOrEmpty(l.Path)).Select(l => l.Path!);

    /// <summary>For a recipe opened from a file: pictures named by a relative path, or whose folder moved, are found next to it.</summary>
    public TextureRecipe FindImagesBeside(string folder)
    {
        foreach (var l in Layers ?? [])
        {
            if (l.Type != "image" || string.IsNullOrEmpty(l.Path)) continue;
            try
            {
                if (!System.IO.Path.IsPathFullyQualified(l.Path)) { l.Path = System.IO.Path.GetFullPath(System.IO.Path.Combine(folder, l.Path)); continue; }
                if (File.Exists(l.Path)) continue;
                var name = System.IO.Path.GetFileName(l.Path.Replace('\\', System.IO.Path.DirectorySeparatorChar));
                var beside = System.IO.Path.Combine(folder, name);
                if (name.Length > 0 && File.Exists(beside)) l.Path = beside;
            }
            catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { /* reported missing when rendered */ }
        }
        return this;
    }

    private static string Hex(string? c) =>
        c is { Length: 7 } && c[0] == '#' && c[1..].All(Uri.IsHexDigit) ? c.ToLowerInvariant() : "#808080";
}

/// <summary>The maps of a material, all Size × Size; height as 0–1 floats, the rest as bytes ready for PNG.</summary>
public sealed class TextureMaps
{
    public required int Size { get; init; }
    public required float[] Height { get; init; }
    /// <summary>RGB, 3 bytes a pixel.</summary>
    public required byte[] Albedo { get; init; }
    /// <summary>RGB, 3 bytes a pixel, OpenGL convention (green up); flip green for DirectX.</summary>
    public required byte[] Normal { get; init; }
    public required byte[] Roughness { get; init; }
    public required byte[] Ao { get; init; }
    public required byte[] Metallic { get; init; }
    /// <summary>What couldn't be used (a picture that is missing or not allowed).</summary>
    public IReadOnlyList<string> Warnings { get; init; } = [];

    public static readonly string[] Names = ["albedo", "normal", "roughness", "ao", "metallic", "height"];

    /// <summary>A map as a PNG. Height is 16-bit; normal can be flipped to the DirectX convention.</summary>
    public byte[] Png(string map, bool directX = false, bool fast = false) => map switch
    {
        "albedo" => PngWriter.Rgb(Size, Size, Albedo, fast),
        "normal" => PngWriter.Rgb(Size, Size, directX ? FlipGreen(Normal) : Normal, fast),
        "roughness" => PngWriter.Gray(Size, Size, Roughness, fast),
        "ao" => PngWriter.Gray(Size, Size, Ao, fast),
        "metallic" => PngWriter.Gray(Size, Size, Metallic, fast),
        "height" => PngWriter.Gray16(Size, Size, Height, fast),
        _ => throw new ArgumentException("Unknown map."),
    };

    private static byte[] FlipGreen(byte[] n) { var c = (byte[])n.Clone(); for (var i = 1; i < c.Length; i += 3) c[i] = (byte)(255 - c[i]); return c; }

    /// <summary>Several grey maps in the channels of one RGBA picture (ORM for Unreal; metallic + smoothness for Unity).</summary>
    public byte[] Packed(string r, string g, string b, string? a = null)
    {
        byte[] Get(string m) => m switch { "roughness" => Roughness, "ao" => Ao, "metallic" => Metallic, "smoothness" => Roughness.Select(v => (byte)(255 - v)).ToArray(), "zero" => new byte[Size * Size], _ => throw new ArgumentException("Unknown map.") };
        byte[] cr = Get(r), cg = Get(g), cb = Get(b);
        var ca = a == null ? null : Get(a);
        var px = new byte[Size * Size * 4];
        for (var i = 0; i < Size * Size; i++) { px[i * 4] = cr[i]; px[i * 4 + 1] = cg[i]; px[i * 4 + 2] = cb[i]; px[i * 4 + 3] = ca == null ? (byte)255 : ca[i]; }
        return PngWriter.Rgba(Size, Size, px);
    }
}

public static class TextureEngine
{
    public const int MinSize = 64, MaxSize = 4096;

    /// <summary>A layer's own values (after its levels), kept when it paints the surface; an image layer's colours too.</summary>
    private sealed record Paint(TextureLayer Layer, float[] Mask, float[]? Rgb);

    /// <param name="images">Reads a picture an image layer uses (null when it can't or may not be used).</param>
    public static TextureMaps Render(TextureRecipe recipe, int size, Func<string, TextureImage?>? images = null)
    {
        if (size is < MinSize or > MaxSize) throw new ArgumentException("Texture size out of range.");
        var r = recipe.Clone().Clamped();
        var n = size * size;
        var h = new float[n];
        var paints = new List<Paint>();
        var warnings = new List<string>();
        foreach (var layer in r.Layers)
        {
            if (layer.Mute) continue;
            var painting = layer.TintAmount > 0 && layer.Tint != null || layer.RoughnessShift != 0 || layer.MetallicShift != 0 || (layer.Type == "image" && layer.ColorAmount > 0);
            if (layer.Opacity <= 0 && !painting) continue;
            var seed = (uint)(r.Seed + layer.SeedShift) * 2654435761u + 0x9E3779B9u;
            float[]? rgb = null;
            double[] values;
            if (layer.Type == "image")
            {
                var img = string.IsNullOrEmpty(layer.Path) ? null : images?.Invoke(layer.Path);
                if (img == null) { warnings.Add($"“{layer.ImageName ?? layer.Name}”: the picture is missing or can't be read"); continue; }
                (values, rgb) = ImageLayer(layer, img, size);
            }
            else if (layer.Type is "current" or "curvature") values = FromStack(layer, h, size, seed);
            else values = Generate(layer, size, seed);
            var mask = painting ? new float[n] : null;
            for (var i = 0; i < n; i++)
            {
                var v = Shape(layer, values[i]);
                if (mask != null) mask[i] = (float)v;
                if (layer.Opacity > 0) h[i] = (float)Math.Clamp(Mix(layer.Blend, h[i], v, layer.Opacity), 0, 1);
            }
            if (mask != null) paints.Add(new Paint(layer, mask, rgb));
        }
        return Surface(r, h, size, paints, warnings);
    }

    private static double Shape(TextureLayer l, double v)
    {
        v = Math.Clamp(v, 0, 1);
        if (l.Invert) v = 1 - v;
        var span = Math.Max(1e-6, l.High - l.Low);
        v = Math.Clamp((v - l.Low) / span, 0, 1);
        return l.Gamma == 1 ? v : Math.Pow(v, l.Gamma);
    }

    private static double Mix(string blend, double a, double b, double opacity)
    {
        var f = blend switch
        {
            "add" => a + b,
            "subtract" => a - b,
            "multiply" => a * b,
            "screen" => 1 - (1 - a) * (1 - b),
            "overlay" => a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b),
            "max" => Math.Max(a, b),
            "min" => Math.Min(a, b),
            _ => b,
        };
        return a + (f - a) * opacity;
    }

    /// <summary>
    /// Masks from the material itself: "current" is the height built so far (tops, dips or a band of it, through the
    /// levels); "curvature" is how much each point stands above (edges, ridges) or below (cavities) its surroundings
    /// over ScaleX/256 of the tile. Warp breaks their outlines up.
    /// </summary>
    private static double[] FromStack(TextureLayer l, float[] h, int size, uint seed)
    {
        var field = h;
        if (l.Type == "curvature")
        {
            var blurred = BlurRect(h, size, size, Math.Max(1, (int)Math.Round(l.ScaleX * size / 256.0)));
            field = new float[h.Length];
            for (var i = 0; i < h.Length; i++) field[i] = (float)Math.Clamp(0.5 + (h[i] - blurred[i]) * 6, 0, 1);
        }
        var v = new double[size * size];
        Parallel.For(0, size, y =>
        {
            for (var x = 0; x < size; x++)
            {
                if (l.Warp <= 0) { v[y * size + x] = field[y * size + x]; continue; }
                double u = (x + 0.5) / size, w = (y + 0.5) / size;
                var du = l.Warp * 0.08 * Fbm(u, w, l.WarpScale, l.WarpScale, 4, 0.5, 2, seed ^ 0xA5A5A5A5u);
                var dv = l.Warp * 0.08 * Fbm(u, w, l.WarpScale, l.WarpScale, 4, 0.5, 2, seed ^ 0x5A5A5A5Au);
                var fx = (u + du) * size - 0.5; var fy = (w + dv) * size - 0.5;
                int x0 = (int)Math.Floor(fx), y0 = (int)Math.Floor(fy);
                double tx = fx - x0, ty = fy - y0;
                double F(int xx, int yy) => field[Wrap(yy, size) * size + Wrap(xx, size)];
                v[y * size + x] = (F(x0, y0) * (1 - tx) + F(x0 + 1, y0) * tx) * (1 - ty) + (F(x0, y0 + 1) * (1 - tx) + F(x0 + 1, y0 + 1) * tx) * ty;
            }
        });
        return v;
    }

    // ------------------------------------------------------------------ generators (values 0–1, tileable)

    private static double[] Generate(TextureLayer l, int size, uint seed)
    {
        var v = new double[size * size];
        if (l.Type == "scratches") { Scratches(l, size, seed, v); return v; }
        Parallel.For(0, size, y =>
        {
            for (var x = 0; x < size; x++)
            {
                double u = (x + 0.5) / size, w = (y + 0.5) / size;
                if (l.Warp > 0)
                {
                    var wu = Fbm(u, w, l.WarpScale, l.WarpScale, 3, 0.5, 2, seed ^ 0xA5A5A5A5u);
                    var wv = Fbm(u, w, l.WarpScale, l.WarpScale, 3, 0.5, 2, seed ^ 0x5A5A5A5Au);
                    u += l.Warp * 0.25 * wu; w += l.Warp * 0.25 * wv;
                }
                v[y * size + x] = Sample(l, u, w, seed);
            }
        });
        return v;
    }

    private static double Sample(TextureLayer l, double u, double v, uint seed) => l.Type switch
    {
        "noise" => 0.5 + 0.5 * Fbm(u, v, l.ScaleX, l.ScaleY, l.Octaves, l.Persistence, l.Lacunarity, seed),
        "ridged" => Ridged(u, v, l, seed),
        "turbulence" => Turbulence(u, v, l, seed),
        "cells" => Cells(u, v, l, seed),
        "wood" => Wood(u, v, l, seed),
        "bricks" => Bricks(u, v, l, seed),
        "weave" => Weave(u, v, l),
        _ => 0,
    };

    private static uint Hash(int x, int y, uint seed)
    {
        unchecked
        {
            var h = (uint)x * 374761393u + (uint)y * 668265263u + seed * 2246822519u;
            h = (h ^ (h >> 13)) * 1274126177u;
            h ^= h >> 16;
            h *= 0x85EBCA6Bu;
            return h ^ (h >> 13);
        }
    }

    private static double Unit(uint h) => (h >> 8) * (1.0 / (1 << 24));
    private static int Wrap(int i, int p) => ((i % p) + p) % p;
    private static double Fade(double t) => t * t * t * (t * (t * 6 - 15) + 10);

    private static readonly double[] GradX = Enumerable.Range(0, 256).Select(i => Math.Cos(i * Math.PI * 2 / 256)).ToArray();
    private static readonly double[] GradY = Enumerable.Range(0, 256).Select(i => Math.Sin(i * Math.PI * 2 / 256)).ToArray();

    /// <summary>Gradient noise with period (px, py) cells over the tile, about −1…1.</summary>
    internal static double Gradient(double u, double v, int px, int py, uint seed)
    {
        double x = u * px, y = v * py;
        int ix = (int)Math.Floor(x), iy = (int)Math.Floor(y);
        double fx = x - ix, fy = y - iy;
        double Corner(int cx, int cy, double dx, double dy)
        {
            var g = (int)(Hash(Wrap(cx, px), Wrap(cy, py), seed) >> 24); // one of 256 directions around the circle
            return GradX[g] * dx + GradY[g] * dy;
        }
        double n00 = Corner(ix, iy, fx, fy), n10 = Corner(ix + 1, iy, fx - 1, fy), n01 = Corner(ix, iy + 1, fx, fy - 1), n11 = Corner(ix + 1, iy + 1, fx - 1, fy - 1);
        double sx = Fade(fx), sy = Fade(fy);
        var a0 = n00 + (n10 - n00) * sx; var a1 = n01 + (n11 - n01) * sx;
        return Math.Clamp((a0 + (a1 - a0) * sy) * 1.41421356, -1, 1);
    }

    /// <summary>Fractal (fBm) gradient noise, about −1…1; each octave multiplies the period by a whole number.</summary>
    internal static double Fbm(double u, double v, int px, int py, int octaves, double persistence, int lacunarity, uint seed)
    {
        double sum = 0, amp = 1, norm = 0;
        int fx = px, fy = py;
        for (var o = 0; o < octaves; o++)
        {
            sum += amp * Gradient(u, v, fx, fy, seed + (uint)o * 1013u);
            norm += amp; amp *= persistence; fx *= lacunarity; fy *= lacunarity;
            if (fx > 4096 || fy > 4096) break;
        }
        return norm > 0 ? sum / norm : 0;
    }

    private static double Ridged(double u, double v, TextureLayer l, uint seed)
    {
        double sum = 0, amp = 1, norm = 0;
        int fx = l.ScaleX, fy = l.ScaleY;
        for (var o = 0; o < l.Octaves && fx <= 4096; o++)
        {
            var r = 1 - Math.Abs(Gradient(u, v, fx, fy, seed + (uint)o * 1013u));
            sum += amp * r * r; norm += amp; amp *= l.Persistence; fx *= l.Lacunarity; fy *= l.Lacunarity;
        }
        return norm > 0 ? sum / norm : 0;
    }

    private static double Turbulence(double u, double v, TextureLayer l, uint seed)
    {
        double sum = 0, amp = 1, norm = 0;
        int fx = l.ScaleX, fy = l.ScaleY;
        for (var o = 0; o < l.Octaves && fx <= 4096; o++)
        {
            sum += amp * Math.Abs(Gradient(u, v, fx, fy, seed + (uint)o * 1013u));
            norm += amp; amp *= l.Persistence; fx *= l.Lacunarity; fy *= l.Lacunarity;
        }
        return norm > 0 ? Math.Min(1, sum / norm * 1.6) : 0;
    }

    /// <summary>Worley cells over a (ScaleX × ScaleY) grid with wrap-around: the distance to the nearest and second-nearest points.</summary>
    private static double Cells(double u, double v, TextureLayer l, uint seed)
    {
        int px = l.ScaleX, py = l.ScaleY;
        double x = u * px, y = v * py;
        int ix = (int)Math.Floor(x), iy = (int)Math.Floor(y);
        double f1 = 9, f2 = 9; uint id = 0;
        for (var dy = -1; dy <= 1; dy++)
            for (var dx = -1; dx <= 1; dx++)
            {
                int cx = ix + dx, cy = iy + dy;
                var hsh = Hash(Wrap(cx, px), Wrap(cy, py), seed);
                var fpx = cx + 0.5 + (Unit(hsh) - 0.5) * l.Jitter;
                var fpy = cy + 0.5 + (Unit(Hash(Wrap(cx, px), Wrap(cy, py), seed ^ 0x68E31DA4u)) - 0.5) * l.Jitter;
                var d = Math.Sqrt((x - fpx) * (x - fpx) + (y - fpy) * (y - fpy));
                if (d < f1) { f2 = f1; f1 = d; id = hsh; }
                else if (d < f2) f2 = d;
            }
        return l.Mode switch
        {
            "edges" => Math.Clamp((f2 - f1) * 1.5, 0, 1),
            "cracks" => SmoothStep(0, 0.12, f2 - f1),
            "stones" => SmoothStep(0.02, 0.12, f2 - f1) * (1 - l.Variation * Unit(id)) * (0.85 + 0.15 * (1 - Math.Min(1, f1))),
            _ => 1 - Math.Clamp(f1, 0, 1),
        };
    }

    private static double SmoothStep(double a, double b, double x) { var t = Math.Clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

    /// <summary>
    /// Wood grain: ScaleX bands across the tile, gently bent by noise (ScaleY sets how fine the bending is). Each band
    /// is smooth: broad light early wood and a thin darker line of late wood, with fine fibres along it.
    /// </summary>
    private static double Wood(double u, double v, TextureLayer l, uint seed)
    {
        var bend = Fbm(u, v, 1, Math.Max(1, l.ScaleY), Math.Max(1, l.Octaves - 1), l.Persistence, l.Lacunarity, seed) * 0.6;
        var t = u * l.ScaleX + bend;
        var s = 0.5 + 0.5 * Math.Cos(2 * Math.PI * t);
        var late = Math.Pow(s, 6); // the thin line where each band ends
        var fibres = 0.5 + 0.5 * Gradient(u, v, l.ScaleX * 16, Math.Max(1, l.ScaleY), seed ^ 0x1234567u);
        return Math.Clamp(0.9 - 0.6 * late - 0.15 * (1 - fibres), 0, 1);
    }

    /// <summary>Bricks or tiles: ScaleX across, ScaleY rows, every other row shifted by Offset; mortar and bevelled edges.</summary>
    private static double Bricks(double u, double v, TextureLayer l, uint seed)
    {
        int cols = l.ScaleX, rows = l.ScaleY;
        var ry = v * rows;
        var row = (int)Math.Floor(ry);
        var shift = (Wrap(row, rows) % 2 == 1) ? l.Offset : 0;
        var rx = u * cols + shift;
        var col = (int)Math.Floor(rx);
        double fx = rx - col, fy = ry - row;
        // Distance to the brick's edge, in tile units (so mortar is as wide across as down).
        var dx = Math.Min(fx, 1 - fx) / cols; var dy = Math.Min(fy, 1 - fy) / rows;
        var d = Math.Min(dx, dy);
        var unit = 1.0 / Math.Max(cols, rows);
        var mortar = l.Mortar * unit * 0.5;
        var edge = SmoothStep(mortar, mortar + l.Bevel * unit * 0.5 + 1e-6, d);
        var each = 1 - l.Variation * Unit(Hash(Wrap(col, cols), Wrap(row, rows), seed));
        return edge * each;
    }

    /// <summary>Woven fabric: threads over and under (ScaleX × ScaleY), each with a rounded profile.</summary>
    private static double Weave(double u, double v, TextureLayer l)
    {
        double x = u * l.ScaleX, y = v * l.ScaleY;
        int ix = (int)Math.Floor(x), iy = (int)Math.Floor(y);
        double fx = x - ix, fy = y - iy;
        var warpOnTop = ((ix + iy) & 1) == 0;
        var across = Math.Sin(Math.PI * fy); // a horizontal thread's profile
        var down = Math.Sin(Math.PI * fx);
        var a = (warpOnTop ? 0.6 : 1.0) * across * (0.75 + 0.25 * Math.Sin(Math.PI * fx));
        var b = (warpOnTop ? 1.0 : 0.6) * down * (0.75 + 0.25 * Math.Sin(Math.PI * fy));
        return Math.Clamp(Math.Max(a, b), 0, 1);
    }

    /// <summary>Thin scratches: Count lines of about Length (tile units), drawn with wrap-around; 1 where scratched.</summary>
    private static void Scratches(TextureLayer l, int size, uint seed, double[] v)
    {
        var rng = new SoundRng(seed);
        var radius = Math.Max(0.6, l.Width * size);
        for (var k = 0; k < l.Count; k++)
        {
            double x0 = rng.NextDouble() * size, y0 = rng.NextDouble() * size;
            var angle = rng.NextDouble() * Math.PI * 2;
            var len = l.Length * size * (0.5 + rng.NextDouble());
            var depth = 0.5 + 0.5 * rng.NextDouble();
            var steps = (int)Math.Ceiling(len / Math.Max(0.5, radius * 0.5));
            for (var s = 0; s <= steps; s++)
            {
                var t = (double)s / Math.Max(1, steps);
                var taper = Math.Sin(Math.PI * t); // thinner at the ends
                double cx = x0 + Math.Cos(angle) * len * t, cy = y0 + Math.Sin(angle) * len * t;
                var r = radius * (0.3 + 0.7 * taper);
                var ri = (int)Math.Ceiling(r + 1);
                for (var oy = -ri; oy <= ri; oy++)
                    for (var ox = -ri; ox <= ri; ox++)
                    {
                        int px = (int)Math.Floor(cx) + ox, py = (int)Math.Floor(cy) + oy;
                        var dist = Math.Sqrt((px + 0.5 - cx) * (px + 0.5 - cx) + (py + 0.5 - cy) * (py + 0.5 - cy));
                        var a = Math.Clamp(r - dist + 0.5, 0, 1) * depth;
                        if (a <= 0) continue;
                        var i = Wrap(py, size) * size + Wrap(px, size);
                        if (a > v[i]) v[i] = a;
                    }
            }
        }
    }

    // ------------------------------------------------------------------ the surface

    private static TextureMaps Surface(TextureRecipe r, float[] h, int size, List<Paint> paints, List<string> warnings)
    {
        var s = r.Surface;
        var n = size * size;
        var seed = (uint)r.Seed * 2654435761u + 77;
        var strength = s.NormalStrength * size / 256.0; // slope per pixel for a height step of 1
        var cavity = Occlusion(h, size, Math.Max(2, s.AoRadius * size), Math.Max(0.5, strength));
        var ao = new byte[n];
        for (var i = 0; i < n; i++) ao[i] = Byte(1 - s.AoStrength * cavity[i]);
        var ramp = s.Ramp.Select(st => (st.Pos, R: Convert.ToInt32(st.Color[1..3], 16) / 255.0, G: Convert.ToInt32(st.Color[3..5], 16) / 255.0, B: Convert.ToInt32(st.Color[5..7], 16) / 255.0)).ToArray();
        var tints = paints.Select(p => p.Layer.Tint is { } t ? (R: Convert.ToInt32(t[1..3], 16) / 255.0, G: Convert.ToInt32(t[3..5], 16) / 255.0, B: Convert.ToInt32(t[5..7], 16) / 255.0) : (R: 0.0, G: 0.0, B: 0.0)).ToArray();
        var albedo = new byte[n * 3];
        var rough = new byte[n];
        var normal = new byte[n * 3];
        var metal = new byte[n];
        Parallel.For(0, size, y =>
        {
            for (var x = 0; x < size; x++)
            {
                var i = y * size + x;
                double u = (x + 0.5) / size, v = (y + 0.5) / size;
                var drift = s.ColorVariation > 0 ? Fbm(u, v, 3, 3, 4, 0.5, 2, seed) : 0;
                var t = Math.Clamp(h[i] + drift * s.ColorVariation * 0.5, 0, 1);
                var (cr, cg, cb) = Ramp(ramp, t);
                var rv = s.RoughnessVariation > 0 ? Fbm(u, v, 8, 8, 3, 0.5, 2, seed ^ 0x77777777u) : 0;
                var ro = s.RoughnessLow + (s.RoughnessHigh - s.RoughnessLow) * h[i] + rv * s.RoughnessVariation * 0.5;
                var me = s.Metallic;
                // Layers that paint: a picture's colours, a tint, roughness and metallic, where each layer is high.
                for (var k = 0; k < paints.Count; k++)
                {
                    var p = paints[k]; var m = p.Mask[i]; var l = p.Layer;
                    if (p.Rgb != null && l.ColorAmount > 0)
                    {
                        var a = l.ColorAmount;
                        cr += (p.Rgb[i * 3] - cr) * a; cg += (p.Rgb[i * 3 + 1] - cg) * a; cb += (p.Rgb[i * 3 + 2] - cb) * a;
                    }
                    if (l.Tint != null && l.TintAmount > 0)
                    {
                        var a = l.TintAmount * m;
                        cr += (tints[k].R - cr) * a; cg += (tints[k].G - cg) * a; cb += (tints[k].B - cb) * a;
                    }
                    ro += l.RoughnessShift * m;
                    me += l.MetallicShift * m;
                }
                var dirt = 1 - s.Dirt * cavity[i] * 0.85;
                albedo[i * 3] = Byte(cr * dirt); albedo[i * 3 + 1] = Byte(cg * dirt); albedo[i * 3 + 2] = Byte(cb * dirt);
                rough[i] = Byte(ro);
                metal[i] = Byte(me);
                // Normal from the height's slope: a Sobel filter (smoother than two neighbours), wrapping at the edges;
                // OpenGL convention, +Y up.
                int xl = (x + size - 1) % size, xr = (x + 1) % size, yu = (y + size - 1) % size, yd = (y + 1) % size;
                double H(int xx, int yy) => h[yy * size + xx];
                var gx = (H(xr, yu) + 2 * H(xr, y) + H(xr, yd) - H(xl, yu) - 2 * H(xl, y) - H(xl, yd)) / 4;
                var gy = (H(xl, yd) + 2 * H(x, yd) + H(xr, yd) - H(xl, yu) - 2 * H(x, yu) - H(xr, yu)) / 4;
                double nx = -gx * strength * 0.5, ny = gy * strength * 0.5, nz = 1;
                var len = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                normal[i * 3] = Byte(nx / len * 0.5 + 0.5); normal[i * 3 + 1] = Byte(ny / len * 0.5 + 0.5); normal[i * 3 + 2] = Byte(nz / len * 0.5 + 0.5);
            }
        });
        return new TextureMaps { Size = size, Height = h, Albedo = albedo, Normal = normal, Roughness = rough, Ao = ao, Metallic = metal, Warnings = warnings };
    }

    /// <summary>
    /// Horizon-based ambient occlusion from the height: in 8 directions, how high the surroundings rise above each point
    /// (as seen from it), within a radius. 0 = open sky, 1 = fully hidden. The height is as tall as the normal map shows it.
    /// </summary>
    private static float[] Occlusion(float[] h, int size, double radius, double slope)
    {
        const int dirs = 8, steps = 6;
        var offsets = new (int Dx, int Dy, double Dist)[dirs * steps];
        for (var d = 0; d < dirs; d++)
        {
            var a = (d + 0.5) * Math.PI * 2 / dirs;
            for (var k = 0; k < steps; k++)
            {
                var dist = Math.Max(1, radius * Math.Pow((k + 1.0) / steps, 1.5));
                var dx = (int)Math.Round(Math.Cos(a) * dist); var dy = (int)Math.Round(Math.Sin(a) * dist);
                offsets[d * steps + k] = (dx, dy, Math.Max(1, Math.Sqrt(dx * dx + dy * dy)));
            }
        }
        var occ = new float[size * size];
        Parallel.For(0, size, y =>
        {
            for (var x = 0; x < size; x++)
            {
                var h0 = h[y * size + x];
                double sum = 0;
                for (var d = 0; d < dirs; d++)
                {
                    double best = 0;
                    for (var k = 0; k < steps; k++)
                    {
                        var (dx, dy, dist) = offsets[d * steps + k];
                        var hh = h[Wrap(y + dy, size) * size + Wrap(x + dx, size)];
                        var tan = (hh - h0) * slope / dist;
                        if (tan > best) best = tan;
                    }
                    sum += best / Math.Sqrt(1 + best * best); // sine of the horizon's elevation
                }
                occ[y * size + x] = (float)Math.Clamp(sum / dirs * 1.6, 0, 1);
            }
        });
        return occ;
    }

    // ------------------------------------------------------------------ pictures

    private sealed record Prepared(int W, int H, float[] Rgb, float[] Height);
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, Prepared> PreparedCache = new();

    /// <summary>An image layer at the tile's size: its height (0–1) and its colours, repeated ScaleX × ScaleY times.</summary>
    private static (double[] Values, float[] Rgb) ImageLayer(TextureLayer l, TextureImage img, int size)
    {
        var key = string.Join('|', img.Id, l.SeamBlend, l.Delight, l.DelightRadius, l.DetailFine, l.DetailMedium, l.DetailLarge, l.HeightColor, l.HeightColorAmount, l.HeightColorTolerance);
        if (!PreparedCache.TryGetValue(key, out var p))
        {
            p = Prepare(l, img);
            if (PreparedCache.Count > 8) PreparedCache.Clear();
            PreparedCache[key] = p;
        }
        var values = new double[size * size];
        var rgb = new float[size * size * 3];
        Parallel.For(0, size, y =>
        {
            for (var x = 0; x < size; x++)
            {
                // Where in the picture: ScaleX × ScaleY repeats, sampled between pixels, wrapping.
                var fx = (x + 0.5) / size * l.ScaleX * p.W - 0.5; var fy = (y + 0.5) / size * l.ScaleY * p.H - 0.5;
                int x0 = (int)Math.Floor(fx), y0 = (int)Math.Floor(fy);
                double tx = fx - x0, ty = fy - y0;
                int ax = Wrap(x0, p.W), bx = Wrap(x0 + 1, p.W), ay = Wrap(y0, p.H), by = Wrap(y0 + 1, p.H);
                double W(int px, int py, float[] a, int ch, int stride) => a[(py * p.W + px) * stride + ch];
                double Bi(float[] a, int ch, int stride) =>
                    (W(ax, ay, a, ch, stride) * (1 - tx) + W(bx, ay, a, ch, stride) * tx) * (1 - ty) + (W(ax, by, a, ch, stride) * (1 - tx) + W(bx, by, a, ch, stride) * tx) * ty;
                var i = y * size + x;
                values[i] = Bi(p.Height, 0, 1);
                for (var c = 0; c < 3; c++) rgb[i * 3 + c] = (float)Math.Clamp(Bi(p.Rgb, c, 3), 0, 1);
            }
        });
        return (values, rgb);
    }

    /// <summary>
    /// A picture made ready to tile: its light evened out (divided by a wide blur of itself), its edges blended with a
    /// half-shifted copy so the left meets the right and the top the bottom (variance-preserving, so the blend keeps
    /// its contrast), and its height from three bands of detail plus any colour you said is high or low.
    /// </summary>
    private static Prepared Prepare(TextureLayer l, TextureImage img)
    {
        int w = img.Width, h = img.Height, n = w * h;
        var ch = new float[3][];
        for (var c = 0; c < 3; c++) { ch[c] = new float[n]; for (var i = 0; i < n; i++) ch[c][i] = img.Rgb[i * 3 + c]; }
        // Even out the light: a wide blur is the lighting; dividing by it (and keeping the average) leaves the surface.
        if (l.Delight > 0)
        {
            var r = Math.Max(2, (int)(l.DelightRadius * Math.Min(w, h) * 0.5));
            for (var c = 0; c < 3; c++)
            {
                var mean = ch[c].Average();
                var light = BlurRect(ch[c], w, h, r, wrap: false); // the photo doesn't tile yet: mirror at its edges
                for (var i = 0; i < n; i++)
                {
                    var flat = ch[c][i] / Math.Max(0.02, light[i]) * mean;
                    ch[c][i] = (float)Math.Clamp(ch[c][i] + (flat - ch[c][i]) * l.Delight, 0, 1);
                }
            }
        }
        // Seamless: near the edges, blend with the picture shifted by half its size (which meets itself there).
        if (l.SeamBlend > 0)
        {
            var means = ch.Select(a => a.Average()).ToArray();
            var outp = ch.Select(_ => new float[n]).ToArray();
            for (var y = 0; y < h; y++)
                for (var x = 0; x < w; x++)
                {
                    var edge = Math.Min(Math.Min(x + 0.5, w - x - 0.5) / w, Math.Min(y + 0.5, h - y - 0.5) / h);
                    var w2 = 1 - SmoothStep(0, l.SeamBlend, edge); var w1 = 1 - w2;
                    var norm = Math.Sqrt(w1 * w1 + w2 * w2);
                    var j = ((y + h / 2) % h) * w + (x + w / 2) % w;
                    var i = y * w + x;
                    for (var c = 0; c < 3; c++)
                        outp[c][i] = (float)Math.Clamp(means[c] + ((ch[c][i] - means[c]) * w1 + (ch[c][j] - means[c]) * w2) / norm, 0, 1);
                }
            ch = outp;
        }
        // Height: brightness in three bands of detail (fine, medium, large), weighted; the light was evened out above.
        var lum = new float[n];
        for (var i = 0; i < n; i++) lum[i] = 0.2126f * ch[0][i] + 0.7152f * ch[1][i] + 0.0722f * ch[2][i];
        var unit = Math.Max(1.0, Math.Max(w, h) / 1024.0);
        var b1 = BlurRect(lum, w, h, Math.Max(1, (int)(2 * unit)));
        var b2 = BlurRect(lum, w, h, Math.Max(2, (int)(8 * unit)));
        var b3 = BlurRect(lum, w, h, Math.Max(4, (int)(32 * unit)));
        var b4 = BlurRect(lum, w, h, Math.Max(8, (int)(96 * unit)));
        var band = new double[n];
        for (var i = 0; i < n; i++)
            band[i] = l.DetailFine * (lum[i] - b1[i]) + l.DetailMedium * (b1[i] - b2[i]) + l.DetailLarge * (b2[i] - b3[i]) + l.DetailLarge * 0.5 * (b3[i] - b4[i]);
        var std = Math.Sqrt(band.Select(v => v * v).Average()) + 1e-6;
        (double R, double G, double B)? pick = l.HeightColor is { } hc && l.HeightColorAmount != 0
            ? (Convert.ToInt32(hc[1..3], 16) / 255.0, Convert.ToInt32(hc[3..5], 16) / 255.0, Convert.ToInt32(hc[5..7], 16) / 255.0) : null;
        var height = new float[n];
        for (var i = 0; i < n; i++)
        {
            var v = 0.5 + band[i] / (4 * std);
            if (pick is { } c)
            {
                var d = Math.Sqrt(((ch[0][i] - c.R) * (ch[0][i] - c.R) + (ch[1][i] - c.G) * (ch[1][i] - c.G) + (ch[2][i] - c.B) * (ch[2][i] - c.B)) / 3);
                v += l.HeightColorAmount * 0.5 * Math.Exp(-(d / l.HeightColorTolerance) * (d / l.HeightColorTolerance));
            }
            height[i] = (float)Math.Clamp(v, 0, 1);
        }
        var rgb = new float[n * 3];
        for (var i = 0; i < n; i++) { rgb[i * 3] = ch[0][i]; rgb[i * 3 + 1] = ch[1][i]; rgb[i * 3 + 2] = ch[2][i]; }
        return new Prepared(w, h, rgb, height);
    }

    /// <summary>A box blur of radius r over a w × h picture, wrapping (or mirroring) at the edges; three passes: close to a Gaussian.</summary>
    private static float[] BlurRect(float[] src, int w, int h, int r, bool wrap = true)
    {
        var a = (float[])src.Clone();
        var b = new float[a.Length];
        for (var pass = 0; pass < 3; pass++)
        {
            BlurLines(a, b, w, h, r, horizontal: true, wrap);
            BlurLines(b, a, w, h, r, horizontal: false, wrap);
        }
        return a;
    }

    private static int Mirror(int k, int len) { var p = 2 * len; k = ((k % p) + p) % p; return k < len ? k : p - 1 - k; }

    private static void BlurLines(float[] src, float[] dst, int w, int h, int r, bool horizontal, bool wrap)
    {
        int lines = horizontal ? h : w, len = horizontal ? w : h;
        var rr = Math.Min(r, (len - 1) / 2);
        var span = 2 * rr + 1;
        Parallel.For(0, lines, line =>
        {
            int Idx(int k) => wrap ? Wrap(k, len) : Mirror(k, len);
            int At(int k) => horizontal ? line * w + Idx(k) : Idx(k) * w + line;
            double sum = 0;
            for (var k = -rr; k <= rr; k++) sum += src[At(k)];
            for (var k = 0; k < len; k++)
            {
                dst[horizontal ? line * w + k : k * w + line] = (float)(sum / span);
                sum += src[At(k + rr + 1)] - src[At(k - rr)];
            }
        });
    }

    private static byte Byte(double v) => (byte)Math.Round(255 * Math.Clamp(v, 0, 1));

    private static (double, double, double) Ramp((double Pos, double R, double G, double B)[] stops, double t)
    {
        if (t <= stops[0].Pos) return (stops[0].R, stops[0].G, stops[0].B);
        for (var i = 1; i < stops.Length; i++)
        {
            if (t > stops[i].Pos) continue;
            var a = stops[i - 1]; var b = stops[i];
            var f = b.Pos - a.Pos < 1e-9 ? 1 : (t - a.Pos) / (b.Pos - a.Pos);
            return (a.R + (b.R - a.R) * f, a.G + (b.G - a.G) * f, a.B + (b.B - a.B) * f);
        }
        var z = stops[^1];
        return (z.R, z.G, z.B);
    }

}

/// <summary>A picture for an image layer: its pixels as 0–1 RGB, and an id that changes when the picture does.</summary>
public sealed class TextureImage
{
    public required int Width { get; init; }
    public required int Height { get; init; }
    /// <summary>RGB, 3 floats a pixel, 0–1.</summary>
    public required float[] Rgb { get; init; }
    public required string Id { get; init; }
}
