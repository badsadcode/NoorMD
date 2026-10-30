using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// A rock, stone, boulder, outcrop or scree patch as a recipe (saved as .noorrock.json): its shape (size, height,
/// stretch, roughness, fractures, layers, a flat base), its look (NoorMaterial material, moss on top, faceted or
/// smooth) and what a game needs (triangles per level, how far it sits in the ground, convex collision pieces).
/// </summary>
public sealed class RockRecipe
{
    public int Version { get; set; } = 1;
    public string Name { get; set; } = "Rock";
    public int Seed { get; set; } = 1;
    /// <summary>
    /// Single rocks: "stone" (0.2–0.5 m), "rock" (0.5–1.5 m), "boulder" (rounded, 1.5–4 m). Formations built of chunky
    /// blocks: "angular" (a blocky boulder with fallen chunks), "cracked" (a mound of blocks split apart), "layered"
    /// (slabs in layers, flat like sandstone or tilted like schist), "cluster" (pointed rocks together), "outcrop"
    /// (stepped blocks rising to a crest), "stacked" (flat stones balanced on a base), "pillar" (a spire of tall
    /// blocks), "arch" (blocks along an arc). And "scree" (a patch of many small stones as one mesh).
    /// </summary>
    public string Kind { get; set; } = "rock";
    public static readonly string[] Kinds = ["stone", "rock", "boulder", "angular", "cracked", "layered", "cluster", "outcrop", "stacked", "pillar", "arch", "scree"];
    /// <summary>The kinds built of blocks (chunks), with pieces, debris and collision per part.</summary>
    public static readonly string[] Formations = ["angular", "cracked", "layered", "cluster", "outcrop", "stacked", "pillar", "arch"];
    public bool IsFormation => Formations.Contains(Kind);
    /// <summary>"realistic" (rough, noisy), "stylized" (soft painted planes) or "faceted" (chunks built from exact planes, a bright chamfer along every edge, as in many stylized games).</summary>
    public string Style { get; set; } = "realistic";
    public static readonly string[] Styles = ["realistic", "stylized", "faceted"];
    /// <summary>The widest size across, in metres (for scree: the patch).</summary>
    public double Size { get; set; } = 1;
    /// <summary>Height against the width (0.2 a slab … 1.5 a standing stone … 5 a spire).</summary>
    public double Height { get; set; } = 0.7;
    /// <summary>Stretched along one side (0 round in plan … 1 twice as long as wide).</summary>
    public double Elongation { get; set; } = 0.3;
    /// <summary>Lumps and pits on the surface (0 smooth … 1 very rough).</summary>
    public double Roughness { get; set; } = 0.5;
    /// <summary>Flat broken faces cut into it (0–12).</summary>
    public int Fractures { get; set; } = 7;
    /// <summary>
    /// Worn edges (0 sharp … 1 well worn): in the mesh, edges rounded off and chipped; in the textures, worn ridges and
    /// dirty hollows; in the vertex colours, lighter worn edges (and the wear in the alpha, as a mask for shaders).
    /// </summary>
    public double EdgeWear { get; set; } = 0.4;
    /// <summary>Sedimentary layers: ledges round it (0 none … 1 strong).</summary>
    public double Strata { get; set; }
    /// <summary>A flat underside where it meets the ground.</summary>
    public bool FlatBase { get; set; } = true;
    /// <summary>How far below the pivot the base reaches, as a share of the height (games sink rocks a little).</summary>
    public double Sink { get; set; } = 0.15;
    /// <summary>The material: a rock surface (<see cref="RockTextures.Ids"/>, in the rock's colour), any NoorMaterial preset id, or "" for a plain colour.</summary>
    public string Material { get; set; } = "rock";
    /// <summary>How much rock one texture tile covers (metres).</summary>
    public double TileMetres { get; set; } = 1.5;
    public string Color { get; set; } = "#8a8580";
    /// <summary>Moss on the upward faces (0 none … 1 thick): its own material in patches, and a green fringe in the vertex colours.</summary>
    public double Moss { get; set; }
    public string MossColor { get; set; } = "#6b8a34";
    /// <summary>Snow on the faces that look up (0 none … 1 on everything but the sides), as its own material.</summary>
    public double Snow { get; set; }
    public string SnowColor { get; set; } = "#eef2f6";
    /// <summary>Stones in a scree patch (scree only).</summary>
    public int Stones { get; set; } = 40;
    /// <summary>Blocks in a formation (layers of a layered rock, rocks in a cluster, stones in an arch…; 0: as the kind likes).</summary>
    public int Pieces { get; set; }
    /// <summary>Small fallen stones round its foot (0 none … 1 many).</summary>
    public double Debris { get; set; }
    /// <summary>How steeply a layered rock's layers are tilted (degrees: 0 flat like sandstone, 30–60 like schist).</summary>
    public double Dip { get; set; }
    /// <summary>How sharply pillars and pointed rocks end (0 blunt … 1 a sharp point).</summary>
    public double Taper { get; set; } = 0.5;
    public int Lods { get; set; } = 3;
    /// <summary>Triangles for each level, closest first (empty: the kind's budget, then about 40 % and 15 % of it; a third of that when stylized).</summary>
    public List<int> LodTriangles { get; set; } = [];
    /// <summary>Convex collision pieces in the file (Godot's "-convcolonly" names; 0 none). Outcrops want several.</summary>
    public int CollisionPieces { get; set; } = 1;

    /// <summary>LOD0 budgets a game can afford (Thornwake's spec): stone 150, rock 400, boulder 1,200, outcrop 2,500, scree 1,500.</summary>
    public static int Budget(string kind) => kind switch
    {
        "stone" => 150, "boulder" or "angular" => 1200, "stacked" => 1400, "pillar" or "scree" => 1500, "layered" => 1600,
        "cracked" or "cluster" => 1800, "outcrop" or "arch" => 2500, _ => 400,
    };

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
        Height = C(Height, 0.1, 6, 0.7);
        Elongation = C(Elongation, 0, 1, 0.3);
        Roughness = C(Roughness, 0, 1, 0.5);
        Fractures = Math.Clamp(Fractures, 0, 12);
        Strata = C(Strata, 0, 1, 0);
        EdgeWear = C(EdgeWear, 0, 1, 0.4);
        Sink = C(Sink, 0, 0.5, 0.15);
        Material = Material is { Length: <= 60 } && Material.All(c => char.IsAsciiLetterOrDigit(c) || c == '-') ? Material : "";
        TileMetres = C(TileMetres, 0.05, 50, 1.5);
        Color = Hex(Color, "#8a8580");
        Moss = C(Moss, 0, 1, 0);
        MossColor = Hex(MossColor, "#6b8a34");
        Snow = C(Snow, 0, 1, 0);
        SnowColor = Hex(SnowColor, "#eef2f6");
        Stones = Math.Clamp(Stones, 3, 200);
        Pieces = Math.Clamp(Pieces, 0, 40);
        Debris = C(Debris, 0, 1, 0);
        Dip = C(Dip, 0, 80, 0);
        Taper = C(Taper, 0, 1, 0.5);
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
        // Single rocks.
        new("stone", "Stone", "A small stone for scattering (0.2–0.5 m, 150 triangles).", () => new RockRecipe { Name = "Stone", Kind = "stone", Size = 0.35, Height = 0.6, Roughness = 0.4, Fractures = 5, Lods = 1, CollisionPieces = 0 }),
        new("rock", "Rock", "A knee-high rock (0.5–1.5 m).", () => new RockRecipe { Name = "Rock", Kind = "rock", Size = 1, Height = 0.7, Roughness = 0.5, Fractures = 7 }),
        new("river-stone", "River stone", "Smooth and rounded by water.", () => new RockRecipe { Name = "River stone", Kind = "rock", Size = 0.8, Height = 0.45, Elongation = 0.5, Roughness = 0.12, Fractures = 0, Material = "granite", Color = "#8e8a86" }),
        new("rounded-boulder", "Rounded boulder", "A big rounded boulder with a little moss and stones at its foot.", () => new RockRecipe { Name = "Rounded boulder", Kind = "boulder", Style = "faceted", Size = 2.6, Height = 0.75, Roughness = 0.2, Fractures = 4, Material = "smooth", Color = "#8f8b84", Moss = 0.25, Debris = 0.5 }),
        new("mossy-stone", "Mossy forest stone", "A rounded stone deep in moss, for a damp forest floor.", () => new RockRecipe { Name = "Mossy forest stone", Kind = "boulder", Style = "faceted", Size = 2, Height = 0.7, Roughness = 0.2, Fractures = 3, Material = "smooth", Color = "#8a877e", Moss = 0.85, Debris = 0.3 }),
        new("snowy-rock", "Snowy rock", "A mountain rock with its snow.", () => new RockRecipe { Name = "Snowy rock", Kind = "boulder", Size = 2.2, Height = 0.65, Roughness = 0.6, Fractures = 7, Material = "rock", Snow = 0.6 }),
        // Formations of blocks (after the stylized rock reference sheet).
        new("angular-boulder", "Angular boulder", "A blocky boulder, big flat faces, chunks broken off at its foot.", () => new RockRecipe { Name = "Angular boulder", Kind = "angular", Style = "faceted", Size = 2.6, Height = 0.7, Material = "smooth", Color = "#8d8a86", Debris = 0.6, CollisionPieces = 2 }),
        new("cracked-rock", "Cracked rock", "A mound of blocks split apart along its cracks.", () => new RockRecipe { Name = "Cracked rock", Kind = "cracked", Style = "faceted", Size = 3, Height = 0.75, Material = "smooth", Color = "#8a8782", Moss = 0.2, Debris = 0.5, CollisionPieces = 3 }),
        new("layered-sandstone", "Layered sandstone", "Flat slabs in layers, warm red sandstone.", () => new RockRecipe { Name = "Layered sandstone", Kind = "layered", Style = "stylized", Size = 3, Height = 0.45, Elongation = 0.4, Material = "sandstone", Color = "#b8744a", Debris = 0.3, CollisionPieces = 2 }),
        new("schist-tor", "Schist tor", "Thin tilted layers breaking out of a hillside, jagged and half buried (as on the Otago high country).", () => new RockRecipe { Name = "Schist tor", Kind = "layered", Size = 3.5, Height = 0.55, Elongation = 0.5, Dip = 50, Roughness = 0.6, Material = "rock", Color = "#85847e", Debris = 0.5, CollisionPieces = 3 }),
        new("rock-cluster", "Rock cluster", "Pointed rocks leaning out from a tall one.", () => new RockRecipe { Name = "Rock cluster", Kind = "cluster", Style = "faceted", Size = 3, Height = 0.8, Taper = 0.6, Material = "smooth", Color = "#8b8984", Debris = 0.4, CollisionPieces = 3 }),
        new("rocky-outcrop", "Rocky outcrop", "Stepped blocks rising to a crest, for cliff edges and hillsides.", () => new RockRecipe { Name = "Rocky outcrop", Kind = "outcrop", Style = "faceted", Size = 5, Height = 0.6, Elongation = 0.6, Material = "smooth", Color = "#8a8780", Moss = 0.3, Debris = 0.4, CollisionPieces = 4 }),
        new("stacked-stones", "Stacked formation", "Flat stones balanced on a blocky base.", () => new RockRecipe { Name = "Stacked formation", Kind = "stacked", Style = "faceted", Size = 2, Height = 1.1, Material = "smooth", Color = "#8e8a84", Moss = 0.2, Debris = 0.5, CollisionPieces = 3 }),
        new("stone-spire", "Stone pillar", "A spire of tall blocks tapering to a point.", () => new RockRecipe { Name = "Stone pillar", Kind = "pillar", Style = "faceted", Size = 1.8, Height = 2.6, Taper = 0.7, Material = "smooth", Color = "#86847f", Debris = 0.5, CollisionPieces = 2 }),
        new("natural-arch", "Natural arch", "Blocks along an arc, big ones at its feet.", () => new RockRecipe { Name = "Natural arch", Kind = "arch", Style = "faceted", Size = 5, Height = 0.75, Elongation = 0.3, Material = "smooth", Color = "#8c8984", Moss = 0.3, Debris = 0.4, CollisionPieces = 6 }),
        new("snowy-peaks", "Snowy peaks", "Tall pointed blocks crowding together, snow on every ledge.", () => new RockRecipe { Name = "Snowy peaks", Kind = "cluster", Style = "faceted", Size = 4, Height = 1.3, Taper = 0.75, Pieces = 7, Material = "smooth", Color = "#9a9db8", Snow = 0.55, Debris = 0.4, CollisionPieces = 4 }),
        new("desert-spires", "Desert spires", "Warm sandstone blocks in a stepped crest, moss on the ledges.", () => new RockRecipe { Name = "Desert spires", Kind = "outcrop", Style = "faceted", Size = 6, Height = 0.8, Elongation = 0.5, Material = "smooth", Color = "#d08a5c", Moss = 0.4, Debris = 0.4, CollisionPieces = 4 }),
        // Ground.
        new("scree", "Scree patch", "Many small stones as one mesh, a 3 m patch of loose rock.", () => new RockRecipe { Name = "Scree", Kind = "scree", Size = 3, Stones = 45, Roughness = 0.5, CollisionPieces = 0 }),
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
