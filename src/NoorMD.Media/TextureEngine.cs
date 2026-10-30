using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Media;

// NoorMaterial: tileable procedural materials. A stack of layers builds a height field (0–1); the surface settings
// turn it into PBR maps (albedo, normal, roughness, ambient occlusion, metallic, height). Every generator works on
// whole-number frequencies over a wrapped lattice, so every map tiles without a seam, at any size. The same recipe
// and seed always give the same pixels.

/// <summary>One step of the height stack: a generator, how it is shaped, and how it is blended onto what is below.</summary>
public sealed class TextureLayer
{
    public static readonly string[] Types = ["noise", "ridged", "turbulence", "musgrave", "cells", "wave", "gradient", "checker", "magic", "wood", "bricks", "tiles", "hexagons", "planks", "spots", "weave", "scratches", "image", "painted", "current", "curvature", "erosion"];
    public static readonly string[] Profiles = ["dome", "flat", "crater", "cone"];
    public static readonly string[] WaveProfiles = ["sine", "saw", "triangle"];
    public static readonly string[] ErosionModes = ["rain", "crumble", "wear"];
    public static readonly string[] Metrics = ["euclidean", "manhattan", "chebyshev"];
    public static readonly string[] Blends = ["normal", "add", "subtract", "multiply", "screen", "overlay", "softlight", "linearlight", "dodge", "burn", "difference", "divide", "max", "min"];
    public static readonly string[] RampModes = ["linear", "ease", "constant", "bspline"];

    /// <summary>The kinds each type can be (its Mode); the first is the default.</summary>
    public static readonly Dictionary<string, string[]> Modes = new()
    {
        ["cells"] = ["cells", "edges", "cracks", "stones", "f2", "smooth"],
        ["musgrave"] = ["fbm", "multifractal", "hybrid", "hetero", "ridged"],
        ["wave"] = ["bands", "rings"],
        ["gradient"] = ["linear", "quadratic", "diagonal", "radial", "spherical"],
        ["erosion"] = ["rain", "crumble", "wear"],
    };

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
    // tiles, hexagons and planks
    /// <summary>Tiles: how round the corners are (0 = square, 1 = as round as they can be).</summary>
    public double Roundness { get; set; } = 0.2;
    /// <summary>Tiles, hexagons and planks: each piece sloped a little in its own direction (0–1), as if not quite flat.</summary>
    public double Tilt { get; set; }
    /// <summary>Planks: how deep the wood grain is (0–1).</summary>
    public double Grain { get; set; } = 0.5;
    // spots (rivets, pebbles, bubbles, craters): one per cell of ScaleX × ScaleY, wandering by Jitter
    /// <summary>Spots: their size (0.05–1 of a cell).</summary>
    public double Size { get; set; } = 0.35;
    /// <summary>Spots: how many cells have one (0–1).</summary>
    public double Density { get; set; } = 1;
    /// <summary>Spots: "dome", "flat" (rivets, coins), "crater" (a rim and a hollow) or "cone".</summary>
    public string Profile { get; set; } = "dome";
    // Blender-style noises: cells' distance Metric; musgrave's Dimension (how fast detail fades) and Gain (hybrid,
    // ridged); wave's rings per cell (Frequency) and Distortion (noise added to the waves).
    public string Metric { get; set; } = "euclidean";
    public double Dimension { get; set; } = 1;
    public double Gain { get; set; } = 1;
    public int Frequency { get; set; } = 4;
    public double Distortion { get; set; }
    /// <summary>Relief only: how much this layer adds to the normal map's detail without changing the height (a bump).</summary>
    public double Bump { get; set; }
    /// <summary>Moves the pattern across and down (0–1 of the tile; it still tiles).</summary>
    public double ShiftX { get; set; }
    public double ShiftY { get; set; }
    /// <summary>Colours of its own: the layer's value through this ramp (with transparency), on the surface by ColorAmount.</summary>
    public List<RampStop>? Ramp { get; set; }
    public string RampMode { get; set; } = "linear";
    // erosion (works on the height so far; Mode is "rain", "crumble" or "wear")
    /// <summary>Erosion: how much (0–1).</summary>
    public double Amount { get; set; } = 0.5;
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
    // painted: a painting made for this material in NoorSketch (Path to its .noorsketch, with transparency): its
    // colours go on the surface where it is painted (by ColorAmount), and with Opacity its brightness raises (white)
    // or lowers (black) the relief there; mid-grey leaves it as it is.
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
    /// <summary>How much of this colour shows (layer ramps: 0 = see through to what is below).</summary>
    public double Alpha { get; set; } = 1;
}

/// <summary>How the height becomes a surface.</summary>
public sealed class TextureSurface
{
    /// <summary>Albedo: colours along the height (0 = deepest, 1 = highest).</summary>
    public List<RampStop> Ramp { get; set; } = [new() { Pos = 0, Color = "#3a3a3a" }, new() { Pos = 1, Color = "#bdbdbd" }];
    /// <summary>How the ramp goes from one colour to the next: linear, ease, constant (steps) or bspline (smooth).</summary>
    public string RampMode { get; set; } = "linear";
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

    // Each map on its own (the Maps tab). Neutral by default, so older recipes look the same.
    /// <summary>Albedo: brightness (−1…1), contrast (−1…1), saturation (0…2, 1 = as it is) and hue turned (−180…180°).</summary>
    public double AlbedoBrightness { get; set; }
    public double AlbedoContrast { get; set; }
    public double AlbedoSaturation { get; set; } = 1;
    public double AlbedoHue { get; set; }
    /// <summary>Roughness: contrast (−1…1) around the middle, then the result kept within Min…Max; Invert writes smoothness.</summary>
    public double RoughnessContrast { get; set; }
    public double RoughnessMin { get; set; }
    public double RoughnessMax { get; set; } = 1;
    public bool RoughnessInvert { get; set; }
    /// <summary>AO: how deep the shading goes in the cavities (gamma, 0.2…5; above 1 darker).</summary>
    public double AoGamma { get; set; } = 1;
    /// <summary>Metallic: 0 keeps soft edges; above it, metal or not (cut at this value).</summary>
    public double MetallicThreshold { get; set; }
    /// <summary>The height map written out (not the relief): levels (low/high), middle (gamma) and contrast.</summary>
    public double HeightLow { get; set; }
    public double HeightHigh { get; set; } = 1;
    public double HeightGamma { get; set; } = 1;
    public double HeightContrast { get; set; }
}

public sealed class TextureRecipe
{
    public int Version { get; set; } = 1;
    public string Name { get; set; } = "Untitled material";
    public string Family { get; set; } = "Custom";
    public int Seed { get; set; } = 1;
    public List<TextureLayer> Layers { get; set; } = [];
    public TextureSurface Surface { get; set; } = new();
    /// <summary>How much ground (or wall) one tile of the texture covers, in metres: its real-world scale.</summary>
    public double TileMetres { get; set; } = 2;
    /// <summary>What the height map's full range (black to white) stands for, in centimetres.</summary>
    public double HeightCm { get; set; } = 4;

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
        TileMetres = double.IsFinite(TileMetres) && TileMetres > 0 ? Math.Clamp(TileMetres, 0.05, 100) : 2;
        HeightCm = double.IsFinite(HeightCm) && HeightCm > 0 ? Math.Clamp(HeightCm, 0.1, 500) : 4;
        Layers = (Layers ?? []).Where(l => l != null).Take(MaxLayers).ToList();
        foreach (var l in Layers)
        {
            l.Type = TextureLayer.Types.Contains(l.Type) ? l.Type : "noise";
            l.Name = string.IsNullOrWhiteSpace(l.Name) ? "Layer" : l.Name.Trim()[..Math.Min(l.Name.Trim().Length, 40)];
            // Wave bands may run one way only (0 the other way); everything else repeats at least once.
            var lowest = l.Type == "wave" && l.Mode != "rings" ? 0 : 1;
            l.ScaleX = Math.Clamp(l.ScaleX, lowest, 256); l.ScaleY = Math.Clamp(l.ScaleY, lowest, 256);
            if (l.ScaleX == 0 && l.ScaleY == 0) l.ScaleX = 1;
            l.Octaves = Math.Clamp(l.Octaves, 1, 10); l.Persistence = C(l.Persistence, 0, 1); l.Lacunarity = Math.Clamp(l.Lacunarity, 2, 4);
            l.Warp = C(l.Warp, 0, 1); l.WarpScale = Math.Clamp(l.WarpScale, 1, 64);
            l.Mode = TextureLayer.Modes.TryGetValue(l.Type, out var modes) ? (modes.Contains(l.Mode) ? l.Mode : modes[0]) : TextureLayer.Modes["cells"].Contains(l.Mode) ? l.Mode : "cells";
            l.Metric = TextureLayer.Metrics.Contains(l.Metric) ? l.Metric : "euclidean";
            l.Dimension = C(l.Dimension, 0, 2); l.Gain = C(l.Gain, 0, 4); l.Frequency = Math.Clamp(l.Frequency, 1, 64); l.Distortion = C(l.Distortion, 0, 4);
            l.Bump = C(l.Bump, 0, 1); l.ShiftX = C(l.ShiftX, 0, 1); l.ShiftY = C(l.ShiftY, 0, 1);
            l.RampMode = TextureLayer.RampModes.Contains(l.RampMode) ? l.RampMode : "linear";
            l.Ramp = l.Ramp == null ? null : CleanRamp(l.Ramp);
            if (l.Ramp is { Count: 0 }) l.Ramp = null;
            l.Roundness = C(l.Roundness, 0, 1); l.Tilt = C(l.Tilt, 0, 1); l.Grain = C(l.Grain, 0, 1);
            l.Size = C(l.Size, 0.05, 1); l.Density = C(l.Density, 0, 1);
            l.Profile = l.Type == "wave" ? (TextureLayer.WaveProfiles.Contains(l.Profile) ? l.Profile : "sine") : TextureLayer.Profiles.Contains(l.Profile) ? l.Profile : "dome";
            l.Amount = C(l.Amount, 0, 1);
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
            if (l.Type is "weave" or "checker") { l.ScaleX += l.ScaleX & 1; l.ScaleY += l.ScaleY & 1; }
            if (l.Type == "bricks" && l.Offset > 0 || l.Type == "hexagons") l.ScaleY += l.ScaleY & 1;
        }
        // Stable ids, as in NoorSound: valid ones kept (the first of repeats), the others the lowest free number.
        var used = new HashSet<string>(StringComparer.Ordinal);
        var keep = Layers.Select(l => l.Id is { Length: > 1 and <= 8 } id && id[0] == 'T' && id[1..].All(char.IsAsciiDigit) && used.Add(id)).ToList();
        for (var i = 0; i < Layers.Count; i++) { if (keep[i]) continue; var n = 1; while (!used.Add("T" + n)) n++; Layers[i].Id = "T" + n; }
        Surface ??= new();
        var s = Surface;
        s.Ramp = CleanRamp(s.Ramp ?? []);
        s.RampMode = TextureLayer.RampModes.Contains(s.RampMode) ? s.RampMode : "linear";
        if (s.Ramp.Count == 0) s.Ramp = [new() { Pos = 0, Color = "#000000" }, new() { Pos = 1, Color = "#ffffff" }];
        s.ColorVariation = C(s.ColorVariation, 0, 1); s.Dirt = C(s.Dirt, 0, 1);
        s.RoughnessLow = C(s.RoughnessLow, 0, 1); s.RoughnessHigh = C(s.RoughnessHigh, 0, 1); s.RoughnessVariation = C(s.RoughnessVariation, 0, 1);
        s.Metallic = C(s.Metallic, 0, 1); s.NormalStrength = C(s.NormalStrength, 0, 20); s.AoStrength = C(s.AoStrength, 0, 1); s.AoRadius = C(s.AoRadius, 0.002, 0.1);
        s.AlbedoBrightness = C(s.AlbedoBrightness, -1, 1); s.AlbedoContrast = C(s.AlbedoContrast, -1, 1); s.AlbedoSaturation = C(s.AlbedoSaturation, 0, 2); s.AlbedoHue = C(s.AlbedoHue, -180, 180);
        s.RoughnessContrast = C(s.RoughnessContrast, -1, 1); s.RoughnessMin = C(s.RoughnessMin, 0, 1); s.RoughnessMax = C(s.RoughnessMax, 0, 1);
        if (s.RoughnessMax < s.RoughnessMin) (s.RoughnessMin, s.RoughnessMax) = (s.RoughnessMax, s.RoughnessMin);
        s.AoGamma = C(s.AoGamma, 0.2, 5); s.MetallicThreshold = C(s.MetallicThreshold, 0, 1);
        s.HeightLow = C(s.HeightLow, 0, 1); s.HeightHigh = C(s.HeightHigh, 0, 1); s.HeightGamma = C(s.HeightGamma, 0.1, 10); s.HeightContrast = C(s.HeightContrast, -1, 1);
        return this;
    }

    private static string? HexOrNull(string c) => c is { Length: 7 } && c[0] == '#' && c[1..].All(Uri.IsHexDigit) ? c.ToLowerInvariant() : null;

    /// <summary>Pictures the recipe reads (image layers).</summary>
    public IEnumerable<string> Files() => (Layers ?? []).Where(l => l.Type is "image" or "painted" && !string.IsNullOrEmpty(l.Path)).Select(l => l.Path!);

    /// <summary>For a recipe opened from a file: pictures named by a relative path, or whose folder moved, are found next to it.</summary>
    public TextureRecipe FindImagesBeside(string folder)
    {
        foreach (var l in Layers ?? [])
        {
            if (l.Type is not ("image" or "painted") || string.IsNullOrEmpty(l.Path)) continue;
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

    private static List<RampStop> CleanRamp(List<RampStop> stops) =>
        stops.Where(r => r != null).Take(16).Select(r => { r.Pos = C(r.Pos, 0, 1); r.Color = Hex(r.Color); r.Alpha = C(r.Alpha, 0, 1); return r; }).OrderBy(r => r.Pos).ToList();

    private static string Hex(string? c) =>
        c is { Length: 7 } && c[0] == '#' && c[1..].All(Uri.IsHexDigit) ? c.ToLowerInvariant() : "#808080";
}

/// <summary>The maps of a material, all Size × Size; height as 0–1 floats, the rest as bytes ready for PNG.</summary>
public sealed class TextureMaps
{
    public required int Size { get; init; }
    public required float[] Height { get; init; }
    /// <summary>The height map as written out (after the Maps tab's levels); the relief itself uses Height.</summary>
    public float[]? HeightOut { get; init; }
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
        "height" => PngWriter.Gray16(Size, Size, HeightOut ?? Height, fast),
        _ => throw new ArgumentException("Unknown map."),
    };

    /// <summary>
    /// The albedo's average colour in linear light (each channel 0–1) and its luminance: what a game reads to keep a
    /// set of materials at the same brightness (grass and soil about 0.15–0.35).
    /// </summary>
    public (float R, float G, float B, float Luminance) AlbedoMean()
    {
        double r = 0, g = 0, b = 0;
        var n = Size * Size;
        for (var i = 0; i < n; i++) { r += Lin(Albedo[i * 3]); g += Lin(Albedo[i * 3 + 1]); b += Lin(Albedo[i * 3 + 2]); }
        float R = (float)(r / n), G = (float)(g / n), B = (float)(b / n);
        return (R, G, B, 0.2126f * R + 0.7152f * G + 0.0722f * B);
        static double Lin(byte v) { var c = v / 255.0; return c <= 0.04045 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4); }
    }

    /// <summary>The height map in 8 bits (smaller; 16 keeps smooth slopes).</summary>
    public byte[] Height8() { var h = HeightOut ?? Height; var px = new byte[h.Length]; for (var i = 0; i < h.Length; i++) px[i] = (byte)Math.Round(Math.Clamp(h[i], 0, 1) * 255); return px; }

    private static byte[] FlipGreen(byte[] n) { var c = (byte[])n.Clone(); for (var i = 1; i < c.Length; i += 3) c[i] = (byte)(255 - c[i]); return c; }

    /// <summary>Several grey maps in the channels of one RGBA picture (ORM for Unreal; metallic + smoothness for Unity).</summary>
    public byte[] Packed(string r, string g, string b, string? a = null)
    {
        byte[] Get(string m) => m switch
        {
            "roughness" => Roughness, "ao" => Ao, "metallic" => Metallic, "smoothness" => Roughness.Select(v => (byte)(255 - v)).ToArray(), "height" => Height8(),
            "zero" => new byte[Size * Size], "one" => Enumerable.Repeat((byte)255, Size * Size).ToArray(), _ => throw new ArgumentException("Unknown map."),
        };
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
    private sealed record Paint(TextureLayer Layer, float[] Mask, float[]? Rgb, float[]? Alpha = null);

    /// <param name="images">Reads a picture an image layer uses (null when it can't or may not be used).</param>
    public static TextureMaps Render(TextureRecipe recipe, int size, Func<string, TextureImage?>? images = null)
    {
        if (size is < MinSize or > MaxSize) throw new ArgumentException("Texture size out of range.");
        var r = recipe.Clone().Clamped();
        var n = size * size;
        var h = new float[n];
        var paints = new List<Paint>();
        var warnings = new List<string>();
        float[]? detail = null; // relief for the normal map only (layers' Bump)
        foreach (var layer in r.Layers)
        {
            if (layer.Mute) continue;
            if (layer.Type == "painted")
            {
                var art = string.IsNullOrEmpty(layer.Path) ? null : images?.Invoke(layer.Path);
                if (art == null) { warnings.Add($"“{layer.ImageName ?? layer.Name}”: the painting is missing or can't be read"); continue; }
                var (prgb, alpha) = PaintedLayer(art, size);
                if (layer.Opacity > 0)
                    for (var i = 0; i < n; i++)
                    {
                        var lum = 0.2126 * prgb[i * 3] + 0.7152 * prgb[i * 3 + 1] + 0.0722 * prgb[i * 3 + 2];
                        h[i] = (float)Math.Clamp(h[i] + layer.Opacity * alpha[i] * (lum - 0.5), 0, 1);
                    }
                paints.Add(new Paint(layer, alpha, prgb, alpha));
                continue;
            }
            var ramped = layer.Ramp is { Count: > 0 } && layer.ColorAmount > 0;
            var painting = layer.TintAmount > 0 && layer.Tint != null || layer.RoughnessShift != 0 || layer.MetallicShift != 0 || (layer.Type == "image" && layer.ColorAmount > 0) || ramped;
            if (layer.Opacity <= 0 && !painting && layer.Bump <= 0) continue;
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
            else if (layer.Type == "erosion") (values, rgb) = Erosion(layer, h, size, seed);
            else values = Generate(layer, size, seed);
            if ((layer.ShiftX > 0 || layer.ShiftY > 0) && layer.Type is not ("current" or "curvature" or "erosion"))
            {
                values = Roll(values, size, layer.ShiftX, layer.ShiftY, 1);
                if (rgb != null) rgb = Roll(rgb, size, layer.ShiftX, layer.ShiftY, 3);
            }
            // Erosion paints where it acted (where the water ran, the rubble settled or the edges wore), not by height.
            var where = layer.Type == "erosion" ? rgb : null;
            if (where != null) rgb = null;
            var mask = painting ? new float[n] : null;
            if (layer.Bump > 0) detail ??= new float[n];
            for (var i = 0; i < n; i++)
            {
                // Erosion's height is used as it comes; its levels shape where it paints instead.
                var v = where != null ? Math.Clamp(values[i], 0, 1) : Shape(layer, values[i]);
                if (mask != null) mask[i] = where != null ? (float)Shape(layer, where[i]) : (float)v;
                if (layer.Opacity > 0) h[i] = (float)Math.Clamp(Mix(layer.Blend, h[i], v, layer.Opacity), 0, 1);
                if (layer.Bump > 0) detail![i] += (float)(layer.Bump * 0.25 * (v - 0.5));
            }
            if (ramped)
            {
                // Colours of its own: its value (as shaped) through its ramp; the ramp's transparency lets what is below show.
                var stops = Stops(layer.Ramp!);
                var colours = new float[n * 3]; var alpha = new float[n];
                Parallel.For(0, n, i =>
                {
                    var (cr, cg, cb, ca) = RampSample(stops, mask![i], layer.RampMode);
                    colours[i * 3] = (float)cr; colours[i * 3 + 1] = (float)cg; colours[i * 3 + 2] = (float)cb; alpha[i] = (float)ca;
                });
                paints.Add(new Paint(layer, mask!, colours, alpha));
            }
            else if (mask != null) paints.Add(new Paint(layer, mask, rgb));
        }
        return Surface(r, h, size, paints, warnings, detail);
    }

    private static double Shape(TextureLayer l, double v)
    {
        v = Math.Clamp(v, 0, 1);
        if (l.Invert) v = 1 - v;
        var span = Math.Max(1e-6, l.High - l.Low);
        v = Math.Clamp((v - l.Low) / span, 0, 1);
        return l.Gamma == 1 ? v : Math.Pow(v, l.Gamma);
    }

    internal static double Mix(string blend, double a, double b, double opacity)
    {
        var f = blend switch
        {
            "add" => a + b,
            "subtract" => a - b,
            "multiply" => a * b,
            "screen" => 1 - (1 - a) * (1 - b),
            "overlay" => a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b),
            "softlight" => (1 - 2 * b) * a * a + 2 * b * a,
            "linearlight" => a + 2 * b - 1,
            "dodge" => b >= 1 ? 1 : Math.Min(1, a / (1 - b)),
            "burn" => b <= 0 ? 0 : 1 - Math.Min(1, (1 - a) / b),
            "difference" => Math.Abs(a - b),
            "divide" => b <= 1e-6 ? 1 : Math.Min(1, a / b),
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
        if (l.Type == "musgrave") Level(v);
        return v;
    }

    private static double Sample(TextureLayer l, double u, double v, uint seed) => l.Type switch
    {
        "noise" => 0.5 + 0.5 * Fbm(u, v, l.ScaleX, l.ScaleY, l.Octaves, l.Persistence, l.Lacunarity, seed),
        "ridged" => Ridged(u, v, l, seed),
        "turbulence" => Turbulence(u, v, l, seed),
        "cells" => Cells(u, v, l, seed),
        "musgrave" => Musgrave(u, v, l, seed),
        "wave" => Wave(u, v, l, seed),
        "gradient" => GradientShape(u, v, l),
        "checker" => Checker(u, v, l),
        "magic" => Magic(u, v, l),
        "wood" => Wood(u, v, l, seed),
        "bricks" => Bricks(u, v, l, seed),
        "tiles" => Tiles(u, v, l, seed),
        "hexagons" => Hexagons(u, v, l, seed),
        "planks" => Planks(u, v, l, seed),
        "spots" => Spots(u, v, l, seed),
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
        double f1 = 9, f2 = 9, soft = 0; uint id = 0;
        for (var dy = -1; dy <= 1; dy++)
            for (var dx = -1; dx <= 1; dx++)
            {
                int cx = ix + dx, cy = iy + dy;
                var hsh = Hash(Wrap(cx, px), Wrap(cy, py), seed);
                var fpx = cx + 0.5 + (Unit(hsh) - 0.5) * l.Jitter;
                var fpy = cy + 0.5 + (Unit(Hash(Wrap(cx, px), Wrap(cy, py), seed ^ 0x68E31DA4u)) - 0.5) * l.Jitter;
                double ddx = Math.Abs(x - fpx), ddy = Math.Abs(y - fpy);
                var d = l.Metric switch { "manhattan" => (ddx + ddy) * 0.7071, "chebyshev" => Math.Max(ddx, ddy), _ => Math.Sqrt(ddx * ddx + ddy * ddy) };
                soft += Math.Exp(-8 * d);
                if (d < f1) { f2 = f1; f1 = d; id = hsh; }
                else if (d < f2) f2 = d;
            }
        return l.Mode switch
        {
            "edges" => Math.Clamp((f2 - f1) * 1.5, 0, 1),
            "cracks" => SmoothStep(0, 0.12, f2 - f1),
            "stones" => SmoothStep(0.02, 0.12, f2 - f1) * (1 - l.Variation * Unit(id)) * (0.85 + 0.15 * (1 - Math.Min(1, f1))),
            "f2" => Math.Clamp(f2 / 1.2, 0, 1),
            "smooth" => 1 - Math.Clamp(-Math.Log(Math.Max(1e-12, soft)) / 8, 0, 1), // smooth F1: cells melting into each other
            _ => 1 - Math.Clamp(f1, 0, 1),
        };
    }

    private static double SmoothStep(double a, double b, double x) { var t = Math.Clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

    /// <summary>
    /// Musgrave fractals (F. K. Musgrave, as in Blender): fBm, multifractal, hybrid multifractal, heterogeneous terrain
    /// and ridged multifractal, over gradient noise with whole-number periods (seamless). Dimension sets how fast the
    /// detail fades; Offset and Gain shape the hybrid, hetero and ridged kinds. Levelled to 0–1 per layer afterwards.
    /// </summary>
    private static double Musgrave(double u, double v, TextureLayer l, uint seed)
    {
        double N(int o, int fx, int fy) => Gradient(u, v, fx, fy, seed + (uint)o * 1013u);
        var pwHL = Math.Pow(l.Lacunarity, -l.Dimension);
        int fx0 = l.ScaleX, fy0 = l.ScaleY;
        double pwr = 1, value;
        var offset = l.Offset * 2; // 0–2
        switch (l.Mode)
        {
            case "multifractal":
                value = 1;
                for (int o = 0, fx = fx0, fy = fy0; o < l.Octaves && fx <= 4096; o++, fx *= l.Lacunarity, fy *= l.Lacunarity) { value *= pwr * N(o, fx, fy) + 1; pwr *= pwHL; }
                return value;
            case "hetero":
            {
                value = offset + N(0, fx0, fy0); pwr = pwHL;
                for (int o = 1, fx = fx0 * l.Lacunarity, fy = fy0 * l.Lacunarity; o < l.Octaves && fx <= 4096; o++, fx *= l.Lacunarity, fy *= l.Lacunarity) { value += (N(o, fx, fy) + offset) * pwr * value; pwr *= pwHL; }
                return value;
            }
            case "hybrid":
            {
                value = N(0, fx0, fy0) + offset; var weight = l.Gain * value; pwr = pwHL;
                for (int o = 1, fx = fx0 * l.Lacunarity, fy = fy0 * l.Lacunarity; o < l.Octaves && fx <= 4096 && weight > 0.001; o++, fx *= l.Lacunarity, fy *= l.Lacunarity)
                {
                    weight = Math.Min(weight, 1);
                    var signal = (N(o, fx, fy) + offset) * pwr;
                    pwr *= pwHL; value += weight * signal; weight *= l.Gain * signal;
                }
                return value;
            }
            case "ridged":
            {
                var signal = offset - Math.Abs(N(0, fx0, fy0)); signal *= signal; value = signal; var weight = 1.0;
                for (int o = 1, fx = fx0 * l.Lacunarity, fy = fy0 * l.Lacunarity; o < l.Octaves && fx <= 4096; o++, fx *= l.Lacunarity, fy *= l.Lacunarity)
                {
                    pwr *= pwHL;
                    weight = Math.Clamp(signal * l.Gain, 0, 1);
                    signal = offset - Math.Abs(N(o, fx, fy)); signal *= signal; signal *= weight;
                    value += signal * pwr;
                }
                return value;
            }
            default:
                value = 0;
                for (int o = 0, fx = fx0, fy = fy0; o < l.Octaves && fx <= 4096; o++, fx *= l.Lacunarity, fy *= l.Lacunarity) { value += N(o, fx, fy) * pwr; pwr *= pwHL; }
                return value;
        }
    }

    /// <summary>A layer's values spread to 0–1 (the 1st to the 99th percentile), for generators whose range varies.</summary>
    private static void Level(double[] v)
    {
        var sorted = (double[])v.Clone();
        Array.Sort(sorted);
        double lo = sorted[(int)(sorted.Length * 0.01)], hi = sorted[(int)(sorted.Length * 0.99)];
        var span = Math.Max(1e-9, hi - lo);
        for (var i = 0; i < v.Length; i++) v[i] = Math.Clamp((v[i] - lo) / span, 0, 1);
    }

    /// <summary>
    /// Waves: bands (ScaleX across and ScaleY down: both set gives diagonal bands; whole numbers keep them seamless)
    /// or rings (Frequency rings in each of ScaleX × ScaleY cells), with a sine, saw or triangle profile, bent by
    /// Distortion (noise of Octaves detail).
    /// </summary>
    private static double Wave(double u, double v, TextureLayer l, uint seed)
    {
        double t;
        if (l.Mode == "rings")
        {
            double x = u * l.ScaleX, y = v * l.ScaleY;
            double fx = x - Math.Floor(x) - 0.5, fy = y - Math.Floor(y) - 0.5;
            t = Math.Sqrt(fx * fx + fy * fy) * 2 * l.Frequency;
        }
        else t = u * l.ScaleX + v * l.ScaleY;
        if (l.Distortion > 0) t += l.Distortion * Fbm(u, v, Math.Max(1, l.ScaleX), Math.Max(1, l.ScaleY), Math.Max(1, l.Octaves), l.Persistence, l.Lacunarity, seed);
        var f = t - Math.Floor(t);
        return l.Profile switch
        {
            "saw" => f,
            "triangle" => 1 - Math.Abs(2 * f - 1),
            _ => 0.5 + 0.5 * Math.Sin(2 * Math.PI * t),
        };
    }

    /// <summary>
    /// Gradients that still tile: linear and quadratic go up and back down across each of ScaleX repeats, diagonal
    /// along ScaleX across and ScaleY down; radial goes round, spherical is a dome, in each of ScaleX × ScaleY cells.
    /// </summary>
    private static double GradientShape(double u, double v, TextureLayer l)
    {
        double Tri(double t) { var f = t - Math.Floor(t); return 1 - Math.Abs(2 * f - 1); }
        double x = u * l.ScaleX, y = v * l.ScaleY;
        double cx = x - Math.Floor(x) - 0.5, cy = y - Math.Floor(y) - 0.5;
        return l.Mode switch
        {
            "quadratic" => Tri(x) * Tri(x),
            "diagonal" => Tri(x + y),
            "radial" => (Math.Atan2(cy, cx) / (2 * Math.PI) + 0.5),
            "spherical" => Math.Max(0, 1 - 2 * Math.Sqrt(cx * cx + cy * cy)),
            _ => Tri(x),
        };
    }

    /// <summary>A checkerboard of ScaleX × ScaleY squares (even counts, to tile), its edges softened by Bevel.</summary>
    private static double Checker(double u, double v, TextureLayer l)
    {
        double x = u * l.ScaleX, y = v * l.ScaleY;
        var odd = (((int)Math.Floor(x) + (int)Math.Floor(y)) & 1) == 1;
        if (l.Bevel <= 0) return odd ? 1 : 0;
        double fx = x - Math.Floor(x), fy = y - Math.Floor(y);
        var edge = Math.Min(Math.Min(fx, 1 - fx), Math.Min(fy, 1 - fy));
        var k = SmoothStep(0, l.Bevel, edge); // 0 at the edge, 1 inside
        return 0.5 + (odd ? 0.5 : -0.5) * k;
    }

    /// <summary>
    /// Blender's Magic texture (psychedelic interference of sines), its inputs made periodic so it tiles: Octaves is
    /// its depth (0–9) and Distortion its turbulence.
    /// </summary>
    private static double Magic(double u, double v, TextureLayer l)
    {
        double px = 2 * Math.PI * u * l.ScaleX, py = 2 * Math.PI * v * l.ScaleY;
        var x = Math.Sin(px + py); var y = Math.Cos(-px + py); var z = -Math.Cos(-px - py);
        var d = 1 + l.Distortion * 2;
        var n = Math.Min(9, Math.Max(0, l.Octaves - 1));
        if (n > 0)
        {
            x *= d; y *= d; z *= d; y = -Math.Cos(x - y + z); y *= d;
            if (n > 1) { x = Math.Cos(x - y - z); x *= d;
            if (n > 2) { z = Math.Sin(-x - y - z); z *= d;
            if (n > 3) { x = -Math.Cos(-x + y - z); x *= d;
            if (n > 4) { y = -Math.Sin(-x + y + z); y *= d;
            if (n > 5) { y = -Math.Cos(-x + y + z); y *= d;
            if (n > 6) { x = Math.Cos(x + y + z); x *= d;
            if (n > 7) { z = Math.Sin(x + y - z); z *= d;
            if (n > 8) { x = -Math.Cos(-x - y + z); x *= d; } } } } } } } }
        }
        if (d != 0) { x /= 2 * d; y /= 2 * d; z /= 2 * d; }
        return Math.Clamp(((0.5 - x) + (0.5 - y) + (0.5 - z)) / 3, 0, 1);
    }

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

    /// <summary>
    /// A piece of a pattern (a tile, a hexagon, a plank): flat on top, sloping down over the bevel to the joint at
    /// distance d (tile units) from its edge; each piece a little lower or higher (Variation) and, with Tilt, sloped
    /// in its own direction (lx, ly: where the point is in the piece, −0.5…0.5).
    /// </summary>
    private static double Piece(TextureLayer l, double d, double unit, uint id, double lx, double ly)
    {
        var mortar = l.Mortar * unit * 0.5;
        var edge = SmoothStep(mortar, mortar + l.Bevel * unit * 0.5 + 1e-6, d);
        var each = 1 - l.Variation * Unit(id);
        if (l.Tilt > 0)
        {
            var a = Unit(id * 2654435761u + 97u) * Math.PI * 2;
            each *= 1 - l.Tilt * 0.35 * (0.5 + Math.Cos(a) * lx + Math.Sin(a) * ly);
        }
        return Math.Clamp(edge * each, 0, 1);
    }

    /// <summary>Square tiles in a grid (ScaleX × ScaleY), with rounded corners, joints, bevels and tilted tiles.</summary>
    private static double Tiles(double u, double v, TextureLayer l, uint seed)
    {
        int cols = l.ScaleX, rows = l.ScaleY;
        double x = u * cols, y = v * rows;
        int col = (int)Math.Floor(x), row = (int)Math.Floor(y);
        double lx = x - col - 0.5, ly = y - row - 0.5;
        // Distance to the edge of a rounded rectangle, in tile units.
        double hx = 0.5 / cols, hy = 0.5 / rows;
        double px = Math.Abs(lx) / cols, py = Math.Abs(ly) / rows;
        var r = l.Roundness * Math.Min(hx, hy);
        double qx = px - (hx - r), qy = py - (hy - r);
        var outside = Math.Sqrt(Math.Max(qx, 0) * Math.Max(qx, 0) + Math.Max(qy, 0) * Math.Max(qy, 0)) + Math.Min(Math.Max(qx, qy), 0) - r;
        return Piece(l, -outside, 1.0 / Math.Max(cols, rows), Hash(Wrap(col, cols), Wrap(row, rows), seed), lx, ly);
    }

    /// <summary>
    /// Hexagons: ScaleX across and ScaleY rows (even), every other row shifted by half; with rows ≈ 1.15 × across they
    /// are regular. The distance to the edge is exact (to the nearest of the borders with the neighbours).
    /// </summary>
    private static double Hexagons(double u, double v, TextureLayer l, uint seed)
    {
        int cols = l.ScaleX, rows = l.ScaleY;
        double x = u, y = v;
        // Centres on the tile's edges, so its edges run through the middle of cells rather than along joints.
        int r0 = (int)Math.Round(v * rows), c0 = (int)Math.Round(u * cols);
        (double X, double Y) Centre(int c, int r) => ((c + ((r & 1) == 1 ? 0.5 : 0)) / cols, (double)r / rows);
        double best = double.MaxValue; int bc = 0, br = 0;
        for (var dr = -1; dr <= 1; dr++)
            for (var dc = -1; dc <= 1; dc++)
            {
                var (cx, cy) = Centre(c0 + dc, r0 + dr);
                var d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
                if (d < best) { best = d; bc = c0 + dc; br = r0 + dr; }
            }
        var (ax, ay) = Centre(bc, br);
        var edge = double.MaxValue;
        for (var dr = -1; dr <= 1; dr++)
            for (var dc = -1; dc <= 1; dc++)
            {
                if (dr == 0 && dc == 0) continue;
                var (bx, by) = Centre(bc + dc, br + dr);
                double nx = bx - ax, ny = by - ay, len = Math.Sqrt(nx * nx + ny * ny);
                edge = Math.Min(edge, ((ax + bx) / 2 - x) * nx / len + ((ay + by) / 2 - y) * ny / len);
            }
        return Piece(l, edge, 1.0 / Math.Max(cols, rows), Hash(Wrap(bc, cols), Wrap(br, rows), seed), (x - ax) * cols, (y - ay) * rows);
    }

    /// <summary>
    /// Planks (floorboards, a fence, a deck): ScaleX boards across, ScaleY board lengths down the tile, each column's
    /// joints shifted at random (by up to Offset of a board); wood grain along each board.
    /// </summary>
    private static double Planks(double u, double v, TextureLayer l, uint seed)
    {
        int cols = l.ScaleX, rows = l.ScaleY;
        var x = u * cols;
        var col = (int)Math.Floor(x);
        var stagger = l.Offset * Unit(Hash(Wrap(col, cols), 0, seed ^ 0x2545F491u));
        var y = v * rows + stagger;
        var row = (int)Math.Floor(y);
        double fx = x - col, fy = y - row;
        var d = Math.Min(Math.Min(fx, 1 - fx) / cols, Math.Min(fy, 1 - fy) / rows);
        var id = Hash(Wrap(col, cols), Wrap(row, rows), seed);
        var height = Piece(l, d, 1.0 / cols, id, fx - 0.5, fy - 0.5);
        if (l.Grain <= 0) return height;
        // Grain: long fibres along the board, gently bent; each board cut from a different part of the tree.
        var boardSeed = seed ^ id;
        var bend = 0.15 * Gradient(u, v, cols, Math.Max(1, rows), boardSeed);
        var lines = 0.5 + 0.5 * Math.Cos(2 * Math.PI * (u * cols * (3 + 3 * Unit(id >> 3)) + bend * 6));
        var fibres = 0.5 + 0.5 * Gradient(u, v, cols * 24, Math.Max(1, rows * 2), boardSeed ^ 0x9E37u);
        return Math.Clamp(height * (1 - l.Grain * (0.12 * Math.Pow(lines, 4) + 0.1 * (1 - fibres))), 0, 1);
    }

    /// <summary>Spots: one per cell of ScaleX × ScaleY (by Density), wandering by Jitter, of Size, as domes, flat discs, craters or cones.</summary>
    private static double Spots(double u, double v, TextureLayer l, uint seed)
    {
        int cols = l.ScaleX, rows = l.ScaleY;
        double x = u * cols, y = v * rows;
        int ix = (int)Math.Floor(x), iy = (int)Math.Floor(y);
        var top = 0.0;
        for (var dy = -1; dy <= 1; dy++)
            for (var dx = -1; dx <= 1; dx++)
            {
                int cx = ix + dx, cy = iy + dy;
                var h = Hash(Wrap(cx, cols), Wrap(cy, rows), seed);
                if (Unit(h ^ 0x5bd1e995u) >= l.Density) continue;
                var px = cx + 0.5 + (Unit(h) - 0.5) * l.Jitter * (1 - l.Size);
                var py = cy + 0.5 + (Unit(h * 747796405u + 1u) - 0.5) * l.Jitter * (1 - l.Size);
                var radius = l.Size * 0.5 * (1 - l.Variation * Unit(h >> 5));
                var t = Math.Sqrt((x - px) * (x - px) + (y - py) * (y - py)) / Math.Max(1e-6, radius);
                if (t >= 1) continue;
                var shape = l.Profile switch
                {
                    "flat" => 1 - SmoothStep(0.8, 1, t),
                    "crater" => Math.Max(SmoothStep(1, 0.75, t) * SmoothStep(0.35, 0.75, t), 0.25 * SmoothStep(1, 0.5, t)),
                    "cone" => 1 - t,
                    _ => Math.Sqrt(1 - t * t),
                };
                top = Math.Max(top, shape * (1 - 0.5 * l.Variation * Unit(h >> 9)));
            }
        return top;
    }

    // ------------------------------------------------------------------ erosion and weathering

    private const int ErosionSize = 512; // worked out at one size, so the preview and every export size agree

    /// <summary>
    /// Erosion of the height built so far, worked out at 512 × 512 (wrapping, so it stays seamless) and brought back
    /// to the size. "rain": water drops run downhill, carrying material from the slopes and leaving it in the
    /// dips (droplet hydraulic erosion, after Beyer 2015); "crumble": what is steeper than it can stand slides down
    /// (thermal erosion); "wear": raised edges and corners worn round. Returns the eroded height and where it acted (0–1).
    /// </summary>
    private static (double[] Values, float[] Where) Erosion(TextureLayer l, float[] h, int size, uint seed)
    {
        // The same height and settings give the same result: kept for a few, so changing a later layer or the surface
        // doesn't wait for the water again (previews only; large exports aren't kept).
        string? key = null;
        if (size <= 1024)
        {
            ulong fnv = 14695981039346656037UL;
            foreach (var v in h) { fnv ^= BitConverter.SingleToUInt32Bits(v); fnv *= 1099511628211UL; }
            key = $"{size}|{l.Mode}|{l.Amount:R}|{seed}|{fnv:x}";
            lock (ErosionCache) { var hit = ErosionCache.Find(e => e.Key == key); if (hit.Key != null) return (hit.Values, hit.Where); }
        }
        var result = ErodeNow(l, h, size, seed);
        if (key != null)
            lock (ErosionCache) { ErosionCache.Insert(0, (key, result.Values, result.Where)); if (ErosionCache.Count > 4) ErosionCache.RemoveAt(4); }
        return result;
    }

    private static readonly List<(string Key, double[] Values, float[] Where)> ErosionCache = [];

    private static (double[] Values, float[] Where) ErodeNow(TextureLayer l, float[] h, int size, uint seed)
    {
        const int W = ErosionSize;
        var work = Resample(h, size, W);
        var before = (float[])work.Clone();
        var where = new float[W * W];
        if (l.Amount > 0)
        {
            if (l.Mode == "crumble") Crumble(work, where, W, l.Amount);
            else if (l.Mode == "wear") Wear(work, where, W, l.Amount);
            else Rain(work, where, W, l.Amount, seed);
        }
        // Where it acted, on a 0–1 scale (the busiest 1 % count as 1).
        var sorted = where.Where(x => x > 0).OrderBy(x => x).ToArray();
        var top = sorted.Length == 0 ? 1 : Math.Max(1e-6f, sorted[(int)(sorted.Length * 0.99)]);
        for (var i = 0; i < where.Length; i++) where[i] = Math.Min(1, where[i] / top);
        // Rain runs a little everywhere: the streaks are where most of it went.
        if (l.Mode == "rain") for (var i = 0; i < where.Length; i++) where[i] *= where[i] * where[i];
        // Rain: the drops alone wear only shallow paths, so the gullies are cut deeper where most water ran.
        if (l.Mode == "rain" && l.Amount > 0)
        {
            var soft = BlurRect(where, W, W, 1);
            for (var i = 0; i < work.Length; i++) work[i] = Math.Max(0, work[i] - (float)(l.Amount * 0.12) * soft[i]);
        }
        var delta = new float[W * W];
        for (var i = 0; i < delta.Length; i++) delta[i] = work[i] - before[i];
        var d = Resample(delta, W, size);
        var w = Resample(where, W, size);
        var values = new double[size * size];
        for (var i = 0; i < values.Length; i++) values[i] = Math.Clamp(h[i] + d[i], 0, 1);
        return (values, w);
    }

    /// <summary>A square map at another size: bilinear, wrapping (a box average first when it gets much smaller).</summary>
    private static float[] Resample(float[] src, int from, int to)
    {
        if (from == to) return (float[])src.Clone();
        var s = src;
        var f = from;
        while (f >= to * 2 && f % 2 == 0)
        {
            var half = new float[f / 2 * (f / 2)];
            for (var y = 0; y < f / 2; y++)
                for (var x = 0; x < f / 2; x++)
                    half[y * (f / 2) + x] = (s[2 * y * f + 2 * x] + s[2 * y * f + 2 * x + 1] + s[(2 * y + 1) * f + 2 * x] + s[(2 * y + 1) * f + 2 * x + 1]) * 0.25f;
            s = half; f /= 2;
        }
        if (f == to) return s;
        var o = new float[to * to];
        var k = (double)f / to;
        Parallel.For(0, to, y =>
        {
            var sy = (y + 0.5) * k - 0.5;
            var y0 = (int)Math.Floor(sy); var ty = sy - y0;
            for (var x = 0; x < to; x++)
            {
                var sx = (x + 0.5) * k - 0.5;
                var x0 = (int)Math.Floor(sx); var tx = sx - x0;
                float At(int xx, int yy) => s[Wrap(yy, f) * f + Wrap(xx, f)];
                o[y * to + x] = (float)((At(x0, y0) * (1 - tx) + At(x0 + 1, y0) * tx) * (1 - ty) + (At(x0, y0 + 1) * (1 - tx) + At(x0 + 1, y0 + 1) * tx) * ty);
            }
        });
        return o;
    }

    /// <summary>Droplet hydraulic erosion on a wrapping W × W height map (0–1); counts where the water ran.</summary>
    private static void Rain(float[] map, float[] where, int w, double amount, uint seed)
    {
        const double inertia = 0.05, capacityFactor = 4, minCapacity = 0.01, erodeSpeed = 0.3, depositSpeed = 0.3, evaporate = 0.01, gravity = 4;
        const int lifetime = 36, radius = 2;
        var scale = w * 0.3; // heights in pixel units: steep enough for the water to bite
        for (var i = 0; i < map.Length; i++) map[i] *= (float)scale;
        // The brush: the cells around a point that erosion takes from, weighted towards the middle.
        var brush = new List<(int Dx, int Dy, double W)>();
        for (var dy = -radius; dy <= radius; dy++)
            for (var dx = -radius; dx <= radius; dx++)
            {
                var dist = Math.Sqrt(dx * dx + dy * dy);
                if (dist <= radius) brush.Add((dx, dy, 1 - dist / radius));
            }
        var total = brush.Sum(b => b.W);
        brush = brush.Select(b => (b.Dx, b.Dy, b.W / total)).ToList();
        int I(int x, int y) => Wrap(y, w) * w + Wrap(x, w);
        (double H, double Gx, double Gy) Sample(double px, double py)
        {
            int x = (int)Math.Floor(px), y = (int)Math.Floor(py);
            double u = px - x, v = py - y;
            double a = map[I(x, y)], b = map[I(x + 1, y)], c = map[I(x, y + 1)], d = map[I(x + 1, y + 1)];
            return (a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v, (b - a) * (1 - v) + (d - c) * v, (c - a) * (1 - u) + (d - b) * u);
        }
        var rng = new SoundRng(seed ^ 0xE7037ED1u);
        var drops = (int)(amount * w * w * 0.5);
        for (var k = 0; k < drops; k++)
        {
            double px = rng.NextDouble() * w, py = rng.NextDouble() * w, dirX = 0, dirY = 0, speed = 1, water = 1, sediment = 0;
            for (var step = 0; step < lifetime; step++)
            {
                int nx = (int)Math.Floor(px), ny = (int)Math.Floor(py);
                double ox = px - nx, oy = py - ny;
                var (height, gx, gy) = Sample(px, py);
                dirX = dirX * inertia - gx * (1 - inertia); dirY = dirY * inertia - gy * (1 - inertia);
                var len = Math.Sqrt(dirX * dirX + dirY * dirY);
                if (len < 1e-9) break; // a flat spot: the drop stays and soaks in
                dirX /= len; dirY /= len;
                px += dirX; py += dirY;
                var dh = Sample(px, py).H - height;
                var capacity = Math.Max(-dh * speed * water * capacityFactor, minCapacity);
                if (sediment > capacity || dh > 0)
                {
                    var put = dh > 0 ? Math.Min(dh, sediment) : (sediment - capacity) * depositSpeed;
                    sediment -= put;
                    map[I(nx, ny)] += (float)(put * (1 - ox) * (1 - oy)); map[I(nx + 1, ny)] += (float)(put * ox * (1 - oy));
                    map[I(nx, ny + 1)] += (float)(put * (1 - ox) * oy); map[I(nx + 1, ny + 1)] += (float)(put * ox * oy);
                }
                else
                {
                    var take = Math.Min((capacity - sediment) * erodeSpeed, -dh);
                    foreach (var (bx, by, bw) in brush)
                    {
                        var i = I(nx + bx, ny + by);
                        var t = Math.Min(map[i], take * bw);
                        map[i] -= (float)t; sediment += t;
                    }
                }
                where[I(nx, ny)] += (float)water;
                speed = Math.Sqrt(Math.Max(0, speed * speed + dh * gravity));
                water *= 1 - evaporate;
            }
        }
        for (var i = 0; i < map.Length; i++) { map[i] = (float)Math.Clamp(map[i] / scale, 0, 1); where[i] = MathF.Log(1 + where[i]); }
    }

    /// <summary>Thermal erosion: wherever a slope is steeper than it can stand, half the excess slides to the lowest neighbour.</summary>
    private static void Crumble(float[] map, float[] where, int w, double amount)
    {
        var scale = (float)(w * 0.12);
        for (var i = 0; i < map.Length; i++) map[i] *= scale;
        var passes = 8 + (int)(amount * 40);
        int[] ox = [1, -1, 0, 0, 1, 1, -1, -1], oy = [0, 0, 1, -1, 1, -1, 1, -1];
        float[] reach = [1, 1, 1, 1, 1.414f, 1.414f, 1.414f, 1.414f];
        // The steepest slope that stands, from the material's own slopes: the steepest part (more with more
        // Amount) crumbles, whether the relief is gentle or sharp.
        var slopes = new float[w * w];
        Parallel.For(0, w, y =>
        {
            for (var x = 0; x < w; x++)
            {
                var i = y * w + x; var m = 0f;
                for (var k = 0; k < 8; k++) m = Math.Max(m, (map[i] - map[Wrap(y + oy[k], w) * w + Wrap(x + ox[k], w)]) / reach[k]);
                slopes[i] = m;
            }
        });
        Array.Sort(slopes);
        var talus = Math.Max(1e-4f, slopes[(int)((slopes.Length - 1) * (1 - 0.7 * amount))]);
        // Each pass: every cell's slide to its lowest neighbour is found from the same heights (in parallel), then
        // all slides happen together, so the result doesn't depend on the order cells are visited in.
        var to = new int[w * w];
        var amountOut = new float[w * w];
        for (var pass = 0; pass < passes * 2; pass++)
        {
            Parallel.For(0, w, y =>
            {
                int up = (y + w - 1) % w * w, row = y * w, down = (y + 1) % w * w;
                Span<int> n = stackalloc int[8];
                for (var x = 0; x < w; x++)
                {
                    int l = x == 0 ? w - 1 : x - 1, r = x == w - 1 ? 0 : x + 1;
                    n[0] = row + r; n[1] = row + l; n[2] = down + x; n[3] = up + x; n[4] = down + r; n[5] = up + r; n[6] = down + l; n[7] = up + l;
                    var i = row + x;
                    var h = map[i];
                    int low = -1; var drop = 0f;
                    for (var k = 0; k < 8; k++)
                    {
                        var d = (h - map[n[k]]) * (k < 4 ? 1f : 0.70710678f);
                        if (d > drop) { drop = d; low = n[k]; }
                    }
                    to[i] = low;
                    amountOut[i] = low < 0 || drop <= talus ? 0 : (drop - talus) * 0.25f; // a quarter: neighbours may pour into the same cell
                }
            });
            for (var i = 0; i < map.Length; i++)
            {
                var m = amountOut[i];
                if (m <= 0) continue;
                map[i] -= m; map[to[i]] += m; where[to[i]] += m;
            }
        }
        for (var i = 0; i < map.Length; i++) map[i] = Math.Clamp(map[i] / scale, 0, 1);
    }

    /// <summary>Wear: what stands above its surroundings (edges, corners, ridges) is worn down a little each pass.</summary>
    private static void Wear(float[] map, float[] where, int w, double amount)
    {
        var passes = 4 + (int)(amount * 16);
        for (var pass = 0; pass < passes; pass++)
        {
            var blurred = BlurRect(map, w, w, 2);
            for (var i = 0; i < map.Length; i++)
            {
                var above = map[i] - blurred[i];
                if (above <= 0) continue;
                var t = above * (float)(0.25 + 0.5 * amount);
                map[i] -= t; where[i] += t;
            }
        }
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

    private static TextureMaps Surface(TextureRecipe r, float[] h, int size, List<Paint> paints, List<string> warnings, float[]? detail = null)
    {
        var s = r.Surface;
        var n = size * size;
        var seed = (uint)r.Seed * 2654435761u + 77;
        var strength = s.NormalStrength * size / 256.0; // slope per pixel for a height step of 1
        var cavity = Occlusion(h, size, Math.Max(2, s.AoRadius * size), Math.Max(0.5, strength));
        var ao = new byte[n];
        for (var i = 0; i < n; i++) ao[i] = Byte(Math.Pow(Math.Max(0, 1 - s.AoStrength * cavity[i]), s.AoGamma));
        var adjustAlbedo = s.AlbedoBrightness != 0 || s.AlbedoContrast != 0 || s.AlbedoSaturation != 1 || s.AlbedoHue != 0;
        double hueCos = Math.Cos(s.AlbedoHue * Math.PI / 180), hueSin = Math.Sin(s.AlbedoHue * Math.PI / 180);
        var ramp = Stops(s.Ramp);
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
                var (cr, cg, cb, _) = RampSample(ramp, t, s.RampMode);
                var rv = s.RoughnessVariation > 0 ? Fbm(u, v, 8, 8, 3, 0.5, 2, seed ^ 0x77777777u) : 0;
                var ro = s.RoughnessLow + (s.RoughnessHigh - s.RoughnessLow) * h[i] + rv * s.RoughnessVariation * 0.5;
                var me = s.Metallic;
                // Layers that paint: a picture's colours, a tint, roughness and metallic, where each layer is high.
                for (var k = 0; k < paints.Count; k++)
                {
                    var p = paints[k]; var m = p.Mask[i]; var l = p.Layer;
                    if (p.Rgb != null && l.ColorAmount > 0)
                    {
                        var a = l.ColorAmount * (p.Alpha?[i] ?? 1);
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
                cr *= dirt; cg *= dirt; cb *= dirt;
                if (adjustAlbedo) (cr, cg, cb) = AdjustColour(cr, cg, cb, s, hueCos, hueSin);
                albedo[i * 3] = Byte(cr); albedo[i * 3 + 1] = Byte(cg); albedo[i * 3 + 2] = Byte(cb);
                ro = Math.Clamp(ro, 0, 1);
                if (s.RoughnessContrast != 0) ro = Math.Clamp((ro - 0.5) * (1 + s.RoughnessContrast) + 0.5, 0, 1);
                ro = s.RoughnessMin + (s.RoughnessMax - s.RoughnessMin) * ro;
                rough[i] = Byte(s.RoughnessInvert ? 1 - ro : ro);
                if (s.MetallicThreshold > 0) me = SmoothStep(s.MetallicThreshold - 0.02, s.MetallicThreshold + 0.02, me);
                metal[i] = Byte(me);
                // Normal from the height's slope: a Sobel filter (smoother than two neighbours), wrapping at the edges;
                // OpenGL convention, +Y up.
                int xl = (x + size - 1) % size, xr = (x + 1) % size, yu = (y + size - 1) % size, yd = (y + 1) % size;
                double H(int xx, int yy) => detail == null ? h[yy * size + xx] : h[yy * size + xx] + detail[yy * size + xx];
                var gx = (H(xr, yu) + 2 * H(xr, y) + H(xr, yd) - H(xl, yu) - 2 * H(xl, y) - H(xl, yd)) / 4;
                var gy = (H(xl, yd) + 2 * H(x, yd) + H(xr, yd) - H(xl, yu) - 2 * H(x, yu) - H(xr, yu)) / 4;
                double nx = -gx * strength * 0.5, ny = gy * strength * 0.5, nz = 1;
                var len = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                normal[i * 3] = Byte(nx / len * 0.5 + 0.5); normal[i * 3 + 1] = Byte(ny / len * 0.5 + 0.5); normal[i * 3 + 2] = Byte(nz / len * 0.5 + 0.5);
            }
        });
        // The height map written out: its own levels, middle and contrast (the relief above used the height as built).
        float[]? heightOut = null;
        if (s.HeightLow != 0 || s.HeightHigh != 1 || s.HeightGamma != 1 || s.HeightContrast != 0)
        {
            heightOut = new float[n];
            var span = s.HeightHigh - s.HeightLow;
            for (var i = 0; i < n; i++)
            {
                var v = Math.Abs(span) < 1e-6 ? (h[i] >= s.HeightLow ? 1 : 0) : Math.Clamp((h[i] - s.HeightLow) / span, 0, 1);
                if (s.HeightGamma != 1) v = Math.Pow(v, s.HeightGamma);
                if (s.HeightContrast != 0) v = Math.Clamp((v - 0.5) * (1 + s.HeightContrast) + 0.5, 0, 1);
                heightOut[i] = (float)v;
            }
        }
        return new TextureMaps { Size = size, Height = h, HeightOut = heightOut, Albedo = albedo, Normal = normal, Roughness = rough, Ao = ao, Metallic = metal, Warnings = warnings };
    }

    /// <summary>
    /// The albedo's own adjustments: hue turned round the grey axis (keeping brightness), saturation from its
    /// brightness, contrast around the middle, then brightness.
    /// </summary>
    private static (double, double, double) AdjustColour(double r, double g, double b, TextureSurface s, double hc, double hs)
    {
        if (s.AlbedoHue != 0)
        {
            // Rotation about the (1,1,1) axis (Rodrigues), the usual "hue rotate" matrix.
            const double k = 0.57735026919;
            double c1 = (1 - hc) / 3;
            var nr = r * (hc + c1) + g * (c1 - k * hs) + b * (c1 + k * hs);
            var ng = r * (c1 + k * hs) + g * (hc + c1) + b * (c1 - k * hs);
            var nb = r * (c1 - k * hs) + g * (c1 + k * hs) + b * (hc + c1);
            (r, g, b) = (nr, ng, nb);
        }
        if (s.AlbedoSaturation != 1)
        {
            var y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            r = y + (r - y) * s.AlbedoSaturation; g = y + (g - y) * s.AlbedoSaturation; b = y + (b - y) * s.AlbedoSaturation;
        }
        if (s.AlbedoContrast != 0) { var f = 1 + s.AlbedoContrast; r = (r - 0.5) * f + 0.5; g = (g - 0.5) * f + 0.5; b = (b - 0.5) * f + 0.5; }
        if (s.AlbedoBrightness != 0) { var add = s.AlbedoBrightness * 0.5; r += add; g += add; b += add; }
        return (Math.Clamp(r, 0, 1), Math.Clamp(g, 0, 1), Math.Clamp(b, 0, 1));
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
    /// <summary>
    /// A painting at the material's size: bilinear and wrapping (it was painted wrapping, so it tiles). Colour is
    /// weighted by coverage when scaled, so unpainted (transparent) pixels don't darken the edges of strokes.
    /// </summary>
    private static (float[] Rgb, float[] Alpha) PaintedLayer(TextureImage img, int size)
    {
        var n = size * size;
        var rgb = new float[n * 3];
        var alpha = new float[n];
        int w = img.Width, ih = img.Height;
        Parallel.For(0, size, y =>
        {
            var sy = (y + 0.5) * ih / size - 0.5;
            var y0 = (int)Math.Floor(sy); var ty = sy - y0;
            for (var x = 0; x < size; x++)
            {
                var sx = (x + 0.5) * w / size - 0.5;
                var x0 = (int)Math.Floor(sx); var tx = sx - x0;
                double ar = 0, ag = 0, ab = 0, aa = 0;
                for (var k = 0; k < 4; k++)
                {
                    int xx = Wrap(x0 + (k & 1), w), yy = Wrap(y0 + (k >> 1), ih);
                    var wgt = ((k & 1) == 1 ? tx : 1 - tx) * ((k >> 1) == 1 ? ty : 1 - ty);
                    var j = yy * w + xx;
                    var a = (img.Alpha?[j] ?? 1) * wgt;
                    aa += a; ar += img.Rgb[j * 3] * a; ag += img.Rgb[j * 3 + 1] * a; ab += img.Rgb[j * 3 + 2] * a;
                }
                var i = y * size + x;
                alpha[i] = (float)Math.Clamp(aa, 0, 1);
                if (aa > 1e-6) { rgb[i * 3] = (float)(ar / aa); rgb[i * 3 + 1] = (float)(ag / aa); rgb[i * 3 + 2] = (float)(ab / aa); }
            }
        });
        return (rgb, alpha);
    }

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
        // Seamless: near the edges, blend with a shifted copy of the picture (any shift meets itself across the edges).
        // The shift is the one where the picture looks most like itself, so a regular pattern (bricks, tiles, planks)
        // lines up with its copy instead of showing doubled lines where they overlap.
        if (l.SeamBlend > 0)
        {
            var (sx, sy) = BestShift(ch, w, h);
            var means = ch.Select(a => a.Average()).ToArray();
            var outp = ch.Select(_ => new float[n]).ToArray();
            for (var y = 0; y < h; y++)
                for (var x = 0; x < w; x++)
                {
                    var edge = Math.Min(Math.Min(x + 0.5, w - x - 0.5) / w, Math.Min(y + 0.5, h - y - 0.5) / h);
                    var w2 = 1 - SmoothStep(0, l.SeamBlend, edge); var w1 = 1 - w2;
                    var norm = Math.Sqrt(w1 * w1 + w2 * w2);
                    var j = ((y + sy) % h) * w + (x + sx) % w;
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

    /// <summary>
    /// The shift (between a quarter and three quarters of the picture each way) at which the picture differs least
    /// from itself, measured on a small copy of its brightness; the middle when nothing is better.
    /// </summary>
    private static (int X, int Y) BestShift(float[][] ch, int w, int h)
    {
        var scale = Math.Max(1, Math.Max(w, h) / 128);
        int sw = w / scale, sh = h / scale;
        if (sw < 8 || sh < 8) return (w / 2, h / 2);
        var small = new float[sw * sh];
        for (var y = 0; y < sh; y++)
            for (var x = 0; x < sw; x++)
            {
                double sum = 0;
                for (var yy = 0; yy < scale; yy++)
                    for (var xx = 0; xx < scale; xx++) { var i = (y * scale + yy) * w + x * scale + xx; sum += 0.2126 * ch[0][i] + 0.7152 * ch[1][i] + 0.0722 * ch[2][i]; }
                small[y * sw + x] = (float)(sum / (scale * scale));
            }
        double Diff(int dx, int dy)
        {
            double d = 0;
            for (var y = 0; y < sh; y += 2)
                for (var x = 0; x < sw; x += 2) { var a = small[y * sw + x] - small[((y + dy) % sh) * sw + (x + dx) % sw]; d += a * a; }
            return d;
        }
        var best = (X: sw / 2, Y: sh / 2);
        var bestDiff = Diff(best.X, best.Y) * 0.98; // keep the middle unless something is clearly better
        var lock_ = new object();
        Parallel.For(sh / 4, 3 * sh / 4 + 1, dy =>
        {
            for (var dx = sw / 4; dx <= 3 * sw / 4; dx++)
            {
                var d = Diff(dx, dy);
                lock (lock_) if (d < bestDiff) { bestDiff = d; best = (dx, dy); }
            }
        });
        return (best.X * scale % w, best.Y * scale % h);
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

    private static (double Pos, double R, double G, double B, double A)[] Stops(List<RampStop> list) =>
        list.Select(st => (st.Pos, Convert.ToInt32(st.Color[1..3], 16) / 255.0, Convert.ToInt32(st.Color[3..5], 16) / 255.0, Convert.ToInt32(st.Color[5..7], 16) / 255.0, st.Alpha)).ToArray();

    /// <summary>
    /// A colour ramp at t: linear, ease (smoothed between stops), constant (each stop's colour up to the next) or
    /// bspline (a smooth curve through the stops, Catmull-Rom).
    /// </summary>
    private static (double R, double G, double B, double A) RampSample((double Pos, double R, double G, double B, double A)[] stops, double t, string mode)
    {
        if (stops.Length == 0) return (0.5, 0.5, 0.5, 1);
        if (t <= stops[0].Pos) return (stops[0].R, stops[0].G, stops[0].B, stops[0].A);
        for (var i = 1; i < stops.Length; i++)
        {
            if (t > stops[i].Pos) continue;
            var a = stops[i - 1]; var b = stops[i];
            var f = b.Pos - a.Pos < 1e-9 ? 1 : (t - a.Pos) / (b.Pos - a.Pos);
            switch (mode)
            {
                case "constant": return (a.R, a.G, a.B, a.A);
                case "ease": f = f * f * (3 - 2 * f); break;
                case "bspline":
                {
                    var p0 = stops[Math.Max(0, i - 2)]; var p3 = stops[Math.Min(stops.Length - 1, i + 1)];
                    double Cr(double v0, double v1, double v2, double v3) => Math.Clamp(0.5 * (2 * v1 + (-v0 + v2) * f + (2 * v0 - 5 * v1 + 4 * v2 - v3) * f * f + (-v0 + 3 * v1 - 3 * v2 + v3) * f * f * f), 0, 1);
                    return (Cr(p0.R, a.R, b.R, p3.R), Cr(p0.G, a.G, b.G, p3.G), Cr(p0.B, a.B, b.B, p3.B), Cr(p0.A, a.A, b.A, p3.A));
                }
            }
            return (a.R + (b.R - a.R) * f, a.G + (b.G - a.G) * f, a.B + (b.B - a.B) * f, a.A + (b.A - a.A) * f);
        }
        var z = stops[^1];
        return (z.R, z.G, z.B, z.A);
    }

    /// <summary>A map moved across and down by a part of the tile, wrapping (so it still tiles).</summary>
    private static T[] Roll<T>(T[] src, int size, double fx, double fy, int channels)
    {
        int dx = (int)Math.Round(fx * size) % size, dy = (int)Math.Round(fy * size) % size;
        if (dx == 0 && dy == 0) return src;
        var o = new T[src.Length];
        for (var y = 0; y < size; y++)
            for (var x = 0; x < size; x++)
            {
                int sx = (x - dx + size) % size, sy = (y - dy + size) % size;
                Array.Copy(src, (sy * size + sx) * channels, o, (y * size + x) * channels, channels);
            }
        return o;
    }

}

/// <summary>A picture for an image layer: its pixels as 0–1 RGB, and an id that changes when the picture does.</summary>
public sealed class TextureImage
{
    public required int Width { get; init; }
    public required int Height { get; init; }
    /// <summary>RGB, 3 floats a pixel, 0–1.</summary>
    public required float[] Rgb { get; init; }
    /// <summary>Coverage, 1 float a pixel, 0–1 (null: fully opaque).</summary>
    public float[]? Alpha { get; init; }
    public required string Id { get; init; }
}
