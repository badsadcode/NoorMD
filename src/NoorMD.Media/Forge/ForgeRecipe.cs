using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Media.Forge;

/// <summary>Where a layer shows (a smart mask): from the model's shape, broken up by noise, levelled.</summary>
public sealed class ForgeMask
{
    public static readonly string[] Kinds = ["all", "none", "edges", "cavity", "top", "bottom", "height", "part", "material"];

    /// <summary>"all", "none" (only where it is painted), "edges" (worn edges), "cavity" (dirt in creases and hidden corners), "top" (dust, moss, snow),
    /// "bottom" (grime), "height" (a gradient up the model), "part" (one part), "material" (one texture set).</summary>
    public string Kind { get; set; } = "all";
    /// <summary>0–1: how much of the model it covers.</summary>
    public double Amount { get; set; } = 0.5;
    /// <summary>0–1: a hard border to a soft one.</summary>
    public double Softness { get; set; } = 0.3;
    public bool Invert { get; set; }
    /// <summary>0–1: noise breaking the border up (patches, not lines).</summary>
    public double Noise { get; set; } = 0.3;
    /// <summary>The noise's size in metres.</summary>
    public double NoiseScale { get; set; } = 0.25;
    /// <summary>"part": which part; "material": which texture set (by index).</summary>
    public int Index { get; set; }

    public ForgeMask Clamped()
    {
        Kind = Kinds.Contains(Kind) ? Kind : "all";
        Amount = C(Amount, 0, 1); Softness = C(Softness, 0, 1); Noise = C(Noise, 0, 1); NoiseScale = C(NoiseScale, 0.005, 100);
        Index = Math.Clamp(Index, 0, 4095);
        return this;
    }

    internal static double C(double v, double lo, double hi) => double.IsFinite(v) ? Math.Clamp(v, lo, hi) : lo;
}

/// <summary>One layer: a material (a Texture Bench preset, or plain values), where it shows, and how strongly.</summary>
public sealed class ForgeLayer
{
    public const int MaxStrokes = 4000;

    public string Name { get; set; } = "Layer";
    public bool Visible { get; set; } = true;
    public double Opacity { get; set; } = 1;
    /// <summary>A Texture Bench preset id; empty for a plain layer (its colour, roughness and metal).</summary>
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
    /// <summary>Brush strokes into the mask, in order (painted on the model).</summary>
    public List<ForgeStroke> Strokes { get; set; } = [];

    public ForgeLayer Clamped()
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "Layer" : Name.Trim()[..Math.Min(Name.Trim().Length, 40)];
        Opacity = ForgeMask.C(Opacity, 0, 1); Scale = ForgeMask.C(Scale, 0.01, 100);
        Color = Color is { Length: 7 } c && c[0] == '#' && c[1..].All(Uri.IsHexDigit) ? c.ToLowerInvariant() : "#808080";
        Roughness = ForgeMask.C(Roughness, 0, 1); Metallic = ForgeMask.C(Metallic, 0, 1); Height = ForgeMask.C(Height, 0, 1); NormalStrength = ForgeMask.C(NormalStrength, 0, 3);
        Material = Material is { Length: <= 200 } m && !m.Any(char.IsControl) ? m : "";
        Mask = (Mask ?? new()).Clamped();
        Strokes = (Strokes ?? []).Where(st => st != null).Take(MaxStrokes).Select(st => st.Clamped()).ToList();
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
    public int AoRays { get; set; } = 24;
    public double AoDistance { get; set; } = 0.25;
    public double EdgeWidth { get; set; } = 0.02;
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
        AoRays = Math.Clamp(AoRays, 0, 256); AoDistance = ForgeMask.C(AoDistance, 0.01, 1); EdgeWidth = ForgeMask.C(EdgeWidth, 0, 0.2);
        Layers = (Layers ?? []).Where(l => l != null).Take(MaxLayers).Select(l => l.Clamped()).ToList();
        Pictures = (Pictures ?? []).Where(p => p != null).Select(p => p.Clamped()).OfType<ForgePicture>().DistinctBy(p => p.Id).Take(MaxPictures).ToList();
        return this;
    }

    public ForgeBake.Settings BakeSettings => new(AoRays, (float)AoDistance, 1, (float)EdgeWidth);
}
