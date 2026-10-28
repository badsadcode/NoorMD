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
    public static readonly string[] Types = ["noise", "ridged", "turbulence", "cells", "wood", "bricks", "weave", "scratches"];
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

    public static TextureMaps Render(TextureRecipe recipe, int size)
    {
        if (size is < MinSize or > MaxSize) throw new ArgumentException("Texture size out of range.");
        var r = recipe.Clone().Clamped();
        var n = size * size;
        var h = new float[n];
        foreach (var layer in r.Layers)
        {
            if (layer.Mute || layer.Opacity <= 0) continue;
            var seed = (uint)(r.Seed + layer.SeedShift) * 2654435761u + 0x9E3779B9u;
            var values = Generate(layer, size, seed);
            for (var i = 0; i < n; i++)
            {
                var v = Shape(layer, values[i]);
                h[i] = (float)Math.Clamp(Mix(layer.Blend, h[i], v, layer.Opacity), 0, 1);
            }
        }
        return Surface(r, h, size);
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

    private static TextureMaps Surface(TextureRecipe r, float[] h, int size)
    {
        var s = r.Surface;
        var n = size * size;
        var seed = (uint)r.Seed * 2654435761u + 77;
        // AO: how far below its surroundings each point sits (blurred height minus height), at two widths.
        var radius = Math.Max(1, (int)Math.Round(s.AoRadius * size));
        var near = Blur(h, size, Math.Max(1, radius / 3));
        var wide = Blur(h, size, radius);
        var ao = new byte[n];
        var cavity = new float[n];
        for (var i = 0; i < n; i++)
        {
            var c = Math.Max(0, (near[i] - h[i]) * 0.6 + (wide[i] - h[i]) * 0.9);
            cavity[i] = (float)Math.Clamp(c * 4, 0, 1);
            ao[i] = (byte)Math.Round(255 * Math.Clamp(1 - s.AoStrength * cavity[i], 0, 1));
        }
        var ramp = s.Ramp.Select(st => (st.Pos, R: Convert.ToInt32(st.Color[1..3], 16) / 255.0, G: Convert.ToInt32(st.Color[3..5], 16) / 255.0, B: Convert.ToInt32(st.Color[5..7], 16) / 255.0)).ToArray();
        var albedo = new byte[n * 3];
        var rough = new byte[n];
        var normal = new byte[n * 3];
        var metal = new byte[n];
        var mbyte = (byte)Math.Round(255 * s.Metallic);
        var strength = s.NormalStrength * size / 256.0;
        Parallel.For(0, size, y =>
        {
            for (var x = 0; x < size; x++)
            {
                var i = y * size + x;
                double u = (x + 0.5) / size, v = (y + 0.5) / size;
                var drift = s.ColorVariation > 0 ? Fbm(u, v, 3, 3, 4, 0.5, 2, seed) : 0;
                var t = Math.Clamp(h[i] + drift * s.ColorVariation * 0.5, 0, 1);
                var (cr, cg, cb) = Ramp(ramp, t);
                var dirt = 1 - s.Dirt * cavity[i] * 0.85;
                albedo[i * 3] = Byte(cr * dirt); albedo[i * 3 + 1] = Byte(cg * dirt); albedo[i * 3 + 2] = Byte(cb * dirt);
                var rv = s.RoughnessVariation > 0 ? Fbm(u, v, 8, 8, 3, 0.5, 2, seed ^ 0x77777777u) : 0;
                rough[i] = Byte(s.RoughnessLow + (s.RoughnessHigh - s.RoughnessLow) * h[i] + rv * s.RoughnessVariation * 0.5);
                metal[i] = mbyte;
                // Normal from the height's slope (wrapping at the edges), OpenGL convention: +Y up.
                double l = h[y * size + (x + size - 1) % size], rr = h[y * size + (x + 1) % size];
                double up = h[((y + size - 1) % size) * size + x], dn = h[((y + 1) % size) * size + x];
                double nx = (l - rr) * strength, ny = (dn - up) * strength, nz = 1;
                var len = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                normal[i * 3] = Byte(nx / len * 0.5 + 0.5); normal[i * 3 + 1] = Byte(ny / len * 0.5 + 0.5); normal[i * 3 + 2] = Byte(nz / len * 0.5 + 0.5);
            }
        });
        return new TextureMaps { Size = size, Height = h, Albedo = albedo, Normal = normal, Roughness = rough, Ao = ao, Metallic = metal };
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

    /// <summary>A box blur of radius r, wrapping at the edges (three passes: close to a Gaussian).</summary>
    private static float[] Blur(float[] src, int size, int r)
    {
        var a = (float[])src.Clone();
        var b = new float[a.Length];
        for (var pass = 0; pass < 3; pass++)
        {
            BlurLine(a, b, size, r, horizontal: true);
            BlurLine(b, a, size, r, horizontal: false);
        }
        return a;
    }

    private static void BlurLine(float[] src, float[] dst, int size, int r, bool horizontal)
    {
        var w = 2 * r + 1;
        Parallel.For(0, size, line =>
        {
            double sum = 0;
            int At(int k) => horizontal ? line * size + Wrap(k, size) : Wrap(k, size) * size + line;
            for (var k = -r; k <= r; k++) sum += src[At(k)];
            for (var k = 0; k < size; k++)
            {
                dst[horizontal ? line * size + k : k * size + line] = (float)(sum / w);
                sum += src[At(k + r + 1)] - src[At(k - r)];
            }
        });
    }
}
