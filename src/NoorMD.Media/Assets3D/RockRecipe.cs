using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// A rock, stone, boulder, outcrop or scree patch as a recipe (saved as .noorrock.json): its shape (size, height,
/// stretch, roughness, fractures, layers, a flat base), its look (a Texture Bench material, moss on top, faceted or
/// smooth) and what a game needs (triangles per level, how far it sits in the ground, convex collision pieces).
/// </summary>
public sealed class RockRecipe
{
    public int Version { get; set; } = 1;
    public string Name { get; set; } = "Rock";
    public int Seed { get; set; } = 1;
    /// <summary>"stone" (0.2–0.5 m), "rock" (0.5–1.5 m), "boulder" (1.5–4 m), "outcrop" (2–6 m, wide and flat-based) or "scree" (a patch of many small stones as one mesh).</summary>
    public string Kind { get; set; } = "rock";
    public static readonly string[] Kinds = ["stone", "rock", "boulder", "outcrop", "scree"];
    /// <summary>"realistic" (rough, noisy) or "stylized" (chunky facets, crisp edges, flat shaded).</summary>
    public string Style { get; set; } = "realistic";
    public static readonly string[] Styles = ["realistic", "stylized"];
    /// <summary>The widest size across, in metres (for scree: the patch).</summary>
    public double Size { get; set; } = 1;
    /// <summary>Height against the width (0.2 a slab … 1.5 a standing stone).</summary>
    public double Height { get; set; } = 0.7;
    /// <summary>Stretched along one side (0 round in plan … 1 twice as long as wide).</summary>
    public double Elongation { get; set; } = 0.3;
    /// <summary>Lumps and pits on the surface (0 smooth … 1 very rough).</summary>
    public double Roughness { get; set; } = 0.5;
    /// <summary>Flat broken faces cut into it (0–12).</summary>
    public int Fractures { get; set; } = 7;
    /// <summary>Sedimentary layers: ledges round it (0 none … 1 strong).</summary>
    public double Strata { get; set; }
    /// <summary>A flat underside where it meets the ground.</summary>
    public bool FlatBase { get; set; } = true;
    /// <summary>How far below the pivot the base reaches, as a share of the height (games sink rocks a little).</summary>
    public double Sink { get; set; } = 0.15;
    /// <summary>The material: a rock surface (<see cref="RockTextures.Ids"/>, in the rock's colour), any Texture Bench preset id, or "" for a plain colour.</summary>
    public string Material { get; set; } = "rock";
    /// <summary>How much rock one texture tile covers (metres).</summary>
    public double TileMetres { get; set; } = 1.5;
    public string Color { get; set; } = "#8a8580";
    /// <summary>Moss on the upward faces (0 none … 1 thick), in the vertex colours (engines multiply them).</summary>
    public double Moss { get; set; }
    public string MossColor { get; set; } = "#5e7a3a";
    /// <summary>Snow on the faces that look up (0 none … 1 on everything but the sides), as its own material.</summary>
    public double Snow { get; set; }
    public string SnowColor { get; set; } = "#eef2f6";
    /// <summary>Stones in a scree patch (scree only).</summary>
    public int Stones { get; set; } = 40;
    public int Lods { get; set; } = 3;
    /// <summary>Triangles for each level, closest first (empty: the kind's budget, then about 40 % and 15 % of it; a third of that when stylized).</summary>
    public List<int> LodTriangles { get; set; } = [];
    /// <summary>Convex collision pieces in the file (Godot's "-convcolonly" names; 0 none). Outcrops want several.</summary>
    public int CollisionPieces { get; set; } = 1;

    /// <summary>LOD0 budgets a game can afford (Thornwake's spec): stone 150, rock 400, boulder 1,200, outcrop 2,500, scree 1,500.</summary>
    public static int Budget(string kind) => kind switch { "stone" => 150, "boulder" => 1200, "outcrop" => 2500, "scree" => 1500, _ => 400 };

    public int LevelTriangles(int lod) =>
        LodTriangles.Count > lod ? LodTriangles[lod] : lod == 0 ? Budget(Kind) : Math.Max(Kind == "stone" ? 24 : 40, (int)(LevelTriangles(0) * (lod == 1 ? 0.4 : 0.15)));

    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.Never };
    public string ToJson() => JsonSerializer.Serialize(this, Options);
    public static RockRecipe FromJson(string json) => (JsonSerializer.Deserialize<RockRecipe>(json, Options) ?? new RockRecipe()).Clamped();
    public RockRecipe Clone() => FromJson(ToJson());

    private static double C(double v, double lo, double hi, double fallback) => double.IsFinite(v) ? Math.Clamp(v, lo, hi) : fallback;
    private static string Hex(string? v, string fallback) => v is { Length: 7 } && v[0] == '#' && v.Skip(1).All(Uri.IsHexDigit) ? v.ToLowerInvariant() : fallback;

    public RockRecipe Clamped()
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "Rock" : Name.Trim()[..Math.Min(Name.Trim().Length, 80)];
        Seed = Math.Clamp(Seed, 0, int.MaxValue);
        Kind = Kinds.Contains(Kind) ? Kind : "rock";
        Style = Styles.Contains(Style) ? Style : "realistic";
        Size = C(Size, 0.05, 80, 1);
        Height = C(Height, 0.1, 3, 0.7);
        Elongation = C(Elongation, 0, 1, 0.3);
        Roughness = C(Roughness, 0, 1, 0.5);
        Fractures = Math.Clamp(Fractures, 0, 12);
        Strata = C(Strata, 0, 1, 0);
        Sink = C(Sink, 0, 0.5, 0.15);
        Material = Material is { Length: <= 60 } && Material.All(c => char.IsAsciiLetterOrDigit(c) || c == '-') ? Material : "";
        TileMetres = C(TileMetres, 0.05, 50, 1.5);
        Color = Hex(Color, "#8a8580");
        Moss = C(Moss, 0, 1, 0);
        MossColor = Hex(MossColor, "#5e7a3a");
        Snow = C(Snow, 0, 1, 0);
        SnowColor = Hex(SnowColor, "#eef2f6");
        Stones = Math.Clamp(Stones, 3, 200);
        Lods = Math.Clamp(Lods, 1, 3);
        LodTriangles = (LodTriangles ?? []).Take(3).Select(t => Math.Clamp(t, 8, 100_000)).ToList();
        CollisionPieces = Math.Clamp(CollisionPieces, 0, 8);
        return this;
    }
}

/// <summary>Ready-made rocks: what a world scatters most, in Thornwake's sizes and budgets.</summary>
public static class RockPresets
{
    public sealed record Preset(string Id, string Name, string Description, Func<RockRecipe> Make);

    public static readonly IReadOnlyList<Preset> All =
    [
        new("stone", "Stone", "A small stone for scattering (0.2–0.5 m, 150 triangles).", () => new RockRecipe { Name = "Stone", Kind = "stone", Size = 0.35, Height = 0.6, Roughness = 0.4, Fractures = 5, Lods = 1, CollisionPieces = 0 }),
        new("rock", "Rock", "A knee-high rock (0.5–1.5 m).", () => new RockRecipe { Name = "Rock", Kind = "rock", Size = 1, Height = 0.7, Roughness = 0.5, Fractures = 7 }),
        new("boulder", "Boulder", "A big boulder to climb on (1.5–4 m).", () => new RockRecipe { Name = "Boulder", Kind = "boulder", Size = 2.8, Height = 0.75, Roughness = 0.55, Fractures = 8 }),
        new("mossy-boulder", "Mossy boulder", "A boulder in a damp forest, moss on top.", () => new RockRecipe { Name = "Mossy boulder", Kind = "boulder", Size = 2.4, Height = 0.7, Roughness = 0.45, Fractures = 5, Material = "mossy", Moss = 0.6, Color = "#7d7a70" }),
        new("river-stone", "River stone", "Smooth and rounded by water.", () => new RockRecipe { Name = "River stone", Kind = "rock", Size = 0.8, Height = 0.45, Elongation = 0.5, Roughness = 0.12, Fractures = 0, Material = "granite", Color = "#8e8a86" }),
        new("slab", "Slab", "A flat, layered slab.", () => new RockRecipe { Name = "Slab", Kind = "rock", Size = 1.4, Height = 0.3, Elongation = 0.4, Roughness = 0.35, Fractures = 5, Strata = 0.6, Material = "sandstone", Color = "#a58e72" }),
        new("outcrop", "Outcrop", "A wide, layered outcrop for cliff edges and rocky ground (2–6 m), flat underside.", () => new RockRecipe { Name = "Outcrop", Kind = "outcrop", Size = 4.5, Height = 0.55, Elongation = 0.6, Roughness = 0.5, Fractures = 8, Strata = 0.5, Material = "sandstone", Color = "#9c8b78", CollisionPieces = 3 }),
        new("scree", "Scree patch", "Many small stones as one mesh, a 3 m patch of loose rock.", () => new RockRecipe { Name = "Scree", Kind = "scree", Size = 3, Stones = 45, Roughness = 0.5, CollisionPieces = 0 }),
        new("stylized-boulder", "Stylized boulder", "Chunky facets and crisp edges, flat shaded.", () => new RockRecipe { Name = "Stylized boulder", Kind = "boulder", Style = "stylized", Size = 2.4, Height = 0.75, Roughness = 0.15, Fractures = 10, Material = "painted", Color = "#8c8a92" }),
        new("snowy-rock", "Snowy rock", "A mountain rock with its snow.", () => new RockRecipe { Name = "Snowy rock", Kind = "boulder", Size = 2.2, Height = 0.65, Roughness = 0.6, Fractures = 7, Material = "rock", Snow = 0.6 }),
    ];

    public static RockRecipe Make(string id) => (All.FirstOrDefault(p => p.Id == id) ?? All[1]).Make().Clamped();
}

public static class RockVariants
{
    public const int MaxCount = 50;

    /// <summary>
    /// <paramref name="count"/> rocks from one recipe: consecutive seeds, sizes spread by up to ± <paramref name="spread"/>
    /// (0–0.5), numbered names. The first keeps the recipe's own seed and size (the rock on screen).
    /// </summary>
    public static List<RockRecipe> Make(RockRecipe recipe, int count, double spread)
    {
        count = Math.Clamp(count, 1, MaxCount);
        spread = double.IsFinite(spread) ? Math.Clamp(spread, 0, 0.5) : 0;
        var list = new List<RockRecipe>();
        for (var i = 0; i < count; i++)
        {
            var r = recipe.Clone();
            if (count > 1)
            {
                r.Name = $"{recipe.Name} {i + 1:00}";
                if (i > 0)
                {
                    r.Seed = (int)((recipe.Seed + 7919L * i) % int.MaxValue);
                    r.Size = recipe.Size * (1 + spread * (new Random(r.Seed).NextDouble() * 2 - 1));
                }
            }
            list.Add(r.Clamped());
        }
        return list;
    }
}
