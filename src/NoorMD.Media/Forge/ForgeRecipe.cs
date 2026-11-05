using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Media.Forge;

/// <summary>Where a layer shows (a smart mask): from the model's shape, broken up by noise, levelled.</summary>
public sealed class ForgeMask
{
    public static readonly string[] Kinds = ["all", "none", "edges", "chips", "cavity", "top", "bottom", "height", "drips", "layer", "part", "material"];

    /// <summary>"all", "none" (only where it is painted), "edges" (worn edges), "cavity" (dirt in creases and hidden corners), "top" (dust, moss, snow),
    /// "bottom" (grime), "height" (a gradient up the model), "part" (one part), "material" (one texture set).</summary>
    public string Kind { get; set; } = "all";
    /// <summary>0–1: how much of the model it covers.</summary>
    public double Amount { get; set; } = 0.5;
    /// <summary>0–1: a hard border to a soft one.</summary>
    public double Softness { get; set; } = 0.3;
    /// <summary>The other way round ("layer": follows where that layer isn't).</summary>
    public bool Invert { get; set; }
    /// <summary>0–1: noise breaking the border up (patches, not lines).</summary>
    public double Noise { get; set; } = 0.3;
    /// <summary>The noise's size in metres.</summary>
    public double NoiseScale { get; set; } = 0.25;
    /// <summary>"part": which part; "material": which texture set (by index).</summary>
    public int Index { get; set; }
    /// <summary>"layer": the layer (below) whose mask this one follows, by id; "drips": the layer they run down from ("" for worn top edges).</summary>
    public string Layer { get; set; } = "";
    /// <summary>"layer": how far, in metres, that mask spreads (grows and softens) first.</summary>
    public double Spread { get; set; }
    /// <summary>"layer": only the spread around that mask (a rim), not the mask itself.</summary>
    public bool Ring { get; set; }
    /// <summary>"drips": how far they run down, in metres.</summary>
    public double Length { get; set; } = 0.3;
    /// <summary>Filters on the mask, in order, after it is worked out (levels, blur, sharpen, posterize, threshold, invert).</summary>
    public List<ForgeFilter> Filters { get; set; } = [];

    public ForgeMask Clamped()
    {
        Kind = Kinds.Contains(Kind) ? Kind : "all";
        Amount = C(Amount, 0, 1); Softness = C(Softness, 0, 1); Noise = C(Noise, 0, 1); NoiseScale = C(NoiseScale, 0.005, 100);
        Index = Math.Clamp(Index, 0, 4095);
        Layer = Layer is { Length: <= 40 } l && l.All(c => char.IsLetterOrDigit(c) || c is '-' or '_') ? l : "";
        Spread = C(Spread, 0, 10); Length = C(Length, 0.005, 50);
        Filters = (Filters ?? []).Where(f => f != null).Take(16).Select(f => f.Clamped()).ToList();
        return this;
    }

    internal static double C(double v, double lo, double hi) => double.IsFinite(v) ? Math.Clamp(v, lo, hi) : lo;
}

/// <summary>One layer: a material (NoorMaterial preset, or plain values), where it shows, and how strongly.</summary>
/// <summary>
/// A filter on a mask: "levels" (A low, B high, C gamma), "blur" (A: its radius, a share of the texture), "sharpen"
/// (A amount, B radius), "posterize" (A steps), "threshold" (A where, B how soft), "invert", "contrast" (A amount, −1…1).
/// </summary>
public sealed class ForgeFilter
{
    public static readonly string[] Kinds = ["levels", "blur", "sharpen", "posterize", "threshold", "invert", "contrast"];
    public string Kind { get; set; } = "levels";
    public double A { get; set; }
    public double B { get; set; } = 1;
    public double C { get; set; } = 1;

    public ForgeFilter Clamped()
    {
        Kind = Kinds.Contains(Kind) ? Kind : "levels";
        (A, B, C) = Kind switch
        {
            "levels" => (ForgeMask.C(A, 0, 1), ForgeMask.C(B, 0, 1), ForgeMask.C(C, 0.1, 10)),
            "blur" => (ForgeMask.C(A, 0, 0.1), 1, 1),
            "sharpen" => (ForgeMask.C(A, 0, 5), ForgeMask.C(B, 0.001, 0.05), 1),
            "posterize" => (ForgeMask.C(A, 2, 32), 1, 1),
            "threshold" => (ForgeMask.C(A, 0, 1), ForgeMask.C(B, 0, 0.5), 1),
            "contrast" => (ForgeMask.C(A, -1, 1), 1, 1),
            _ => (0, 1, 1),
        };
        return this;
    }
}

public sealed class ForgeLayer
{
    public static readonly string[] ColorBlends = ["normal", "multiply", "screen", "overlay", "softlight", "add", "subtract", "darken", "lighten", "difference"];
    public static readonly string[] ValueBlends = ["normal", "add", "subtract", "multiply", "max", "min"];
    public const int MaxStrokes = 4000;

    /// <summary>Names the layer for others' masks to follow ("layer" and "drips" masks).</summary>
    public string Id { get; set; } = "";
    public string Name { get; set; } = "Layer";
    public bool Visible { get; set; } = true;
    public double Opacity { get; set; } = 1;
    /// <summary>NoorMaterial preset id; empty for a plain layer (its colour, roughness and metal).</summary>
    public string Material { get; set; } = "";
    /// <summary>How many metres one tile of the material covers (projected from three sides, no seams).</summary>
    public double Scale { get; set; } = 1;
    /// <summary>Plain layer values, and a tint over a material (mid grey "#808080" leaves it as it is).</summary>
    public string Color { get; set; } = "#808080";
    public double Roughness { get; set; } = 0.7;
    public double Metallic { get; set; }
    /// <summary>A plain layer's height, 0–1 (mid: neither raised nor sunk); a material brings its own.</summary>
    public double Height { get; set; } = 0.5;
    /// <summary>Which channels the layer paints (the others show through).</summary>
    public bool UseColor { get; set; } = true;
    public bool UseRoughness { get; set; } = true;
    public bool UseMetallic { get; set; } = true;
    public bool UseNormal { get; set; } = true;
    public bool UseHeight { get; set; } = true;
    public double NormalStrength { get; set; } = 1;
    public ForgeMask Mask { get; set; } = new();
    /// <summary>A folder: it paints nothing itself; its mask, opacity and visibility apply to every layer inside it.</summary>
    public bool IsFolder { get; set; }
    /// <summary>The folder this layer is in (its id), or "".</summary>
    public string Folder { get; set; } = "";
    /// <summary>How each channel blends with what is below (as a painting program's per-channel blending), and how much.</summary>
    public string ColorBlend { get; set; } = "normal";
    public string RoughBlend { get; set; } = "normal";
    public string MetalBlend { get; set; } = "normal";
    public string HeightBlend { get; set; } = "normal";
    public double ColorOpacity { get; set; } = 1;
    public double RoughOpacity { get; set; } = 1;
    public double MetalOpacity { get; set; } = 1;
    public double HeightOpacity { get; set; } = 1;
    /// <summary>The layer's colour adjusted before it blends: hue turned (degrees), saturation, brightness and contrast (−1…1).</summary>
    public double Hue { get; set; }
    public double Saturation { get; set; }
    public double Brightness { get; set; }
    public double Contrast { get; set; }
    /// <summary>The material's input values (its exposed sliders: dirt, wear, moss…), by input id; the material is made with them.</summary>
    public Dictionary<string, double>? Inputs { get; set; }
    /// <summary>The key a material layer's maps are made by: its material, and its inputs' values (sorted, so the same values give the same key).</summary>
    public string MaterialKey => Inputs is { Count: > 0 } ? Material + "?" + string.Join("&", Inputs.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => $"{kv.Key}={kv.Value.ToString("R", System.Globalization.CultureInfo.InvariantCulture)}")) : Material;
    /// <summary>Brush strokes into the mask, in order (painted on the model).</summary>
    public List<ForgeStroke> Strokes { get; set; } = [];
    /// <summary>
    /// An image paint layer: the picture painted on it, pixel by pixel (its version in the app's image store), shown by
    /// its own alpha. Its size (square), and the PNG files it was saved as beside the recipe (one per texture set).
    /// </summary>
    public string? Image { get; set; }
    public int ImageSize { get; set; }
    public List<string>? ImageFiles { get; set; }

    public ForgeLayer Clamped()
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "Layer" : Name.Trim()[..Math.Min(Name.Trim().Length, 40)];
        Opacity = ForgeMask.C(Opacity, 0, 1); Scale = ForgeMask.C(Scale, 0.01, 100);
        Color = Color is { Length: 7 } c && c[0] == '#' && c[1..].All(Uri.IsHexDigit) ? c.ToLowerInvariant() : "#808080";
        Roughness = ForgeMask.C(Roughness, 0, 1); Metallic = ForgeMask.C(Metallic, 0, 1); Height = ForgeMask.C(Height, 0, 1); NormalStrength = ForgeMask.C(NormalStrength, 0, 3);
        Material = Material is { Length: <= 200 } m && !m.Any(char.IsControl) ? m : "";
        Mask = (Mask ?? new()).Clamped();
        Inputs = Inputs?.Where(kv => kv.Key is { Length: > 0 and <= 40 } && kv.Key.All(c => char.IsLetterOrDigit(c) || c is '-' or '_') && double.IsFinite(kv.Value)).Take(16).ToDictionary(kv => kv.Key, kv => kv.Value);
        if (Inputs is { Count: 0 }) Inputs = null;
        Folder = Folder is { Length: <= 40 } fo && fo.All(c => char.IsLetterOrDigit(c) || c is '-' or '_') ? fo : "";
        ColorBlend = ColorBlends.Contains(ColorBlend) ? ColorBlend : "normal";
        RoughBlend = ValueBlends.Contains(RoughBlend) ? RoughBlend : "normal"; MetalBlend = ValueBlends.Contains(MetalBlend) ? MetalBlend : "normal"; HeightBlend = ValueBlends.Contains(HeightBlend) ? HeightBlend : "normal";
        ColorOpacity = ForgeMask.C(ColorOpacity, 0, 1); RoughOpacity = ForgeMask.C(RoughOpacity, 0, 1); MetalOpacity = ForgeMask.C(MetalOpacity, 0, 1); HeightOpacity = ForgeMask.C(HeightOpacity, 0, 1);
        Hue = double.IsFinite(Hue) ? Math.Clamp(Hue, -180, 180) : 0; Saturation = ForgeMask.C(Saturation, -1, 1); Brightness = ForgeMask.C(Brightness, -1, 1); Contrast = ForgeMask.C(Contrast, -1, 1);
        Strokes = (Strokes ?? []).Where(st => st != null).Take(MaxStrokes).Select(st => st.Clamped()).ToList();
        Image = Image is { Length: > 1 and <= 40 } im && im.All(char.IsLetterOrDigit) ? im : null;
        ImageSize = Math.Clamp(ImageSize, 0, ForgeImageStore.MaxSize);
        ImageFiles = ImageFiles?.Where(f => f is { Length: > 0 and <= 200 } && f.IndexOfAny(['/', '\\', ':']) < 0 && !f.StartsWith('.')).Take(64).ToList();
        return this;
    }
}

/// <summary>A NoorForge recipe (.noorforge.json): the model, how its maps are baked, and the layers, bottom first.</summary>
public sealed class ForgeRecipe
{
    public const int MaxLayers = 32;
    public static readonly int[] Sizes = [256, 512, 1024, 2048, 4096];

    public int Version { get; set; } = 1;
    public string Name { get; set; } = "Textured model";
    /// <summary>The model (GLB or OBJ), as picked.</summary>
    public string? Model { get; set; }
    public int Size { get; set; } = 1024;
    /// <summary>Which engine the export is for (ForgeExport.Presets): the maps' names and packing.</summary>
    public string Export { get; set; } = "godot";
    /// <summary>Every texture set in one atlas (one material): the atlas is the texture size, each set in a cell of it.</summary>
    public bool Atlas { get; set; }
    /// <summary>Smaller copies of the maps for lower levels: 0 none, 1 half size (LOD1), 2 half and quarter (LOD1, LOD2).</summary>
    public int LodCopies { get; set; }
    public int AoRays { get; set; } = 24;
    public double AoDistance { get; set; } = 0.25;
    public double EdgeWidth { get; set; } = 0.02;
    /// <summary>
    /// How deep the layers' height is, as bumps in the normal map (0: the height map only, as before preview.140;
    /// 1: the full range of height a hundredth of the model's size deep; up to 4).
    /// </summary>
    public double Relief { get; set; } = 1;
    /// <summary>A high-poly model of the same thing (GLB or OBJ), as picked: its detail baked onto the model.</summary>
    public string? HighModel { get; set; }
    /// <summary>How far from the model its surface is looked for, as a share of the model's size.</summary>
    public double HighDistance { get; set; } = 0.03;
    public List<ForgeLayer> Layers { get; set; } = [];
    /// <summary>Pictures the strokes use as tips and stencils (kept here, greyscale).</summary>
    public List<ForgePicture> Pictures { get; set; } = [];
    public const int MaxPictures = 24;

    /// <summary>A picture of the recipe by id.</summary>
    public ForgePicture? Picture(string id) => Pictures.FirstOrDefault(p => p.Id == id);

    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.Never };
    public string ToJson() => JsonSerializer.Serialize(this, Options);
    public static ForgeRecipe FromJson(string json) => (JsonSerializer.Deserialize<ForgeRecipe>(json, Options) ?? new ForgeRecipe()).Clamped();

    public ForgeRecipe Clamped()
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "Textured model" : Name.Trim()[..Math.Min(Name.Trim().Length, 80)];
        if (Model != null && (Model.Length > 1000 || Model.Any(char.IsControl))) Model = null;
        Size = Sizes.Contains(Size) ? Size : 1024;
        Export = ForgeExport.Presets.Any(p => p.Id == Export) ? Export : "godot";
        LodCopies = Math.Clamp(LodCopies, 0, 2);
        AoRays = Math.Clamp(AoRays, 0, 256); AoDistance = ForgeMask.C(AoDistance, 0.01, 1); EdgeWidth = ForgeMask.C(EdgeWidth, 0, 0.2); Relief = ForgeMask.C(Relief, 0, 4);
        HighDistance = ForgeMask.C(HighDistance, 0.001, 0.5);
        if (HighModel != null && (HighModel.Length > 1000 || HighModel.Any(char.IsControl) || HighModel.Length == 0)) HighModel = null;
        Layers = (Layers ?? []).Where(l => l != null).Take(MaxLayers).Select(l => l.Clamped()).ToList();
        var folderIds = Layers.Where(l => l.IsFolder && l.Id.Length > 0).Select(l => l.Id).ToHashSet();
        foreach (var l in Layers) if (l.IsFolder || !folderIds.Contains(l.Folder)) l.Folder = "";
        // Every layer has an id of its own (letters, digits, '-' and '_').
        var ids = new HashSet<string>();
        for (var k = 0; k < Layers.Count; k++)
        {
            var id = Layers[k].Id;
            if (id.Length is 0 or > 40 || !id.All(c => char.IsLetterOrDigit(c) || c is '-' or '_') || !ids.Add(id))
            {
                var n = k + 1;
                while (!ids.Add(id = $"L{n}")) n++;
            }
            Layers[k].Id = id;
        }
        Pictures = (Pictures ?? []).Where(p => p != null).Select(p => p.Clamped()).OfType<ForgePicture>().DistinctBy(p => p.Id).Take(MaxPictures).ToList();
        return this;
    }

    public ForgeBake.Settings BakeSettings => new(AoRays, (float)AoDistance, 1, (float)EdgeWidth, (float)HighDistance);
}
