using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Media.Assets3D;

/// <summary>One level of branches growing on the level below (level 1 on the trunk, level 2 on those, ...).</summary>
public sealed class TreeLevel
{
    /// <summary>Branches on each parent (spread along it from Start to its tip).</summary>
    public int Count { get; set; } = 12;
    /// <summary>Where along the parent the branches begin (0 base … 1 tip).</summary>
    public double Start { get; set; } = 0.3;
    /// <summary>Angle away from the parent (degrees) and its random spread.</summary>
    public double Angle { get; set; } = 50;
    public double AngleSpread { get; set; } = 12;
    /// <summary>Length as a share of the parent's length.</summary>
    public double Length { get; set; } = 0.5;
    public double LengthSpread { get; set; } = 0.15;
    /// <summary>Base radius as a share of the parent's radius where it grows.</summary>
    public double Radius { get; set; } = 0.55;
    /// <summary>How the branch bends over its length (degrees; positive up towards the light, negative drooping).</summary>
    public double Bend { get; set; } = 15;
    /// <summary>Random wiggle (degrees per segment).</summary>
    public double Wobble { get; set; } = 6;
    /// <summary>Turn between neighbouring branches around the parent (degrees; 137.5 is the golden angle).</summary>
    public double Spiral { get; set; } = 137.5;
    /// <summary>Branches in a ring at the same height (whorls, as on pines), or 1 for spread out.</summary>
    public int Whorl { get; set; } = 1;
}

/// <summary>
/// Everything that makes a tree, saved beside the export so it can be opened and changed later. The same recipe and
/// seed always give the same tree.
/// </summary>
public sealed class TreeRecipe
{
    public static readonly string[] Archetypes = ["broadleaf", "conifer", "birch", "dead"];
    public static readonly string[] Styles = ["realistic", "stylized"];
    public static readonly string[] Shapes = ["spherical", "hemispherical", "conical", "cylindrical", "flame", "inverse", "tapered"];
    public static readonly string[] BranchModes = ["merged", "separate", "mixed"];
    public static readonly string[] FoliageKinds = ["cards", "tufts", "clumps", "both", "none"];
    public static readonly string[] LeafShapes = ["broad", "round", "needle", "maple"];
    public static readonly string[] Qualities = ["low", "medium", "high"];

    public int Version { get; set; } = 1;
    public string Name { get; set; } = "Tree";
    public int Seed { get; set; } = 1;
    public string Archetype { get; set; } = "broadleaf";
    public string Style { get; set; } = "realistic";

    // Trunk.
    public double Height { get; set; } = 8;
    public double TrunkRadius { get; set; } = 0.25;
    /// <summary>How thin the trunk gets at the top (0 none … 1 to a point).</summary>
    public double Taper { get; set; } = 0.75;
    /// <summary>Where the trunk splits into the crown (0–1 of the height) for broadleaf trees; 1 keeps a single leader.</summary>
    public double CrownStart { get; set; } = 0.35;
    public double Lean { get; set; } = 3;
    public double Wobble { get; set; } = 4;
    /// <summary>Spiral twist of the trunk and limbs (stylized trees love it), in turns over the height.</summary>
    public double Twist { get; set; }
    /// <summary>Root flare at the base (0 none … 1 strong buttresses) and the number of roots.</summary>
    public double Flare { get; set; } = 0.5;
    public int Roots { get; set; } = 5;
    /// <summary>How smoothly limbs melt into their parent (collar size, 0 sharp … 1 very soft).</summary>
    public double Collar { get; set; } = 0.6;

    public string Shape { get; set; } = "spherical";
    public List<TreeLevel> Levels { get; set; } = [new(), new() { Count = 8, Start = 0.2, Angle = 45, Length = 0.45, Radius = 0.5, Bend = 10 }];

    // Mesh.
    public string Branches { get; set; } = "merged";
    /// <summary>In mixed mode: limbs at least this thick (metres) are welded into the trunk; thinner ones are separate.</summary>
    public double MixedRadius { get; set; } = 0.08;
    public string Quality { get; set; } = "medium";
    /// <summary>Triangle budget of the wood in the first level of detail.</summary>
    public int Budget { get; set; } = 8000;
    /// <summary>Levels of detail (1 = only LOD0); each next one has about half the triangles.</summary>
    public int Lods { get; set; } = 3;
    public bool FlatShading { get; set; }

    // Foliage.
    public string Foliage { get; set; } = "cards";
    public string LeafShape { get; set; } = "broad";
    /// <summary>How full the crown is (0–1) and the size of each leaf card (metres).</summary>
    public double LeafDensity { get; set; } = 0.6;
    public double LeafSize { get; set; } = 0.6;
    public string LeafColor { get; set; } = "#4f7a2c";
    public string LeafColor2 { get; set; } = "#8aa83a";
    /// <summary>Leaf normals bent to point out of the crown (0 the card's own … 1 fully outwards): soft, even lighting.</summary>
    public double CrownNormals { get; set; } = 0.6;

    // Bark.
    public string BarkColor { get; set; } = "#5a4636";
    /// <summary>The Texture Bench material for the bark (a preset id), or empty for a plain colour.</summary>
    public string BarkMaterial { get; set; } = "wood-bark";
    /// <summary>How much bark one texture covers (metres).</summary>
    public double BarkTile { get; set; } = 1;

    public bool Wind { get; set; } = true;
    /// <summary>
    /// Where the wind data goes: "uv" (TEXCOORD_1 = branch bend, leaf flutter; TEXCOORD_2 = phase, trunk sway) keeps
    /// the colours true in every viewer and engine; "color" (COLOR_0 = sway, bend, flutter, phase) suits shaders that
    /// read vertex colours, but viewers that multiply by vertex colour will show it as a tint.
    /// </summary>
    public string WindData { get; set; } = "uv";
    public static readonly string[] WindChannels = ["uv", "color"];

    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.Never };
    public string ToJson() => JsonSerializer.Serialize(this, Options);
    public static TreeRecipe FromJson(string json) => (JsonSerializer.Deserialize<TreeRecipe>(json, Options) ?? new TreeRecipe()).Clamped();
    public TreeRecipe Clone() => FromJson(ToJson());

    public const int MaxLevels = 3;
    private static double C(double v, double lo, double hi, double fallback) => double.IsFinite(v) ? Math.Clamp(v, lo, hi) : fallback;
    private static string Pick(string? v, string[] allowed) => v != null && allowed.Contains(v) ? v : allowed[0];
    private static string Hex(string? v, string fallback) => v is { Length: 7 } && v[0] == '#' && v.Skip(1).All(Uri.IsHexDigit) ? v.ToLowerInvariant() : fallback;

    public TreeRecipe Clamped()
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "Tree" : Name.Trim()[..Math.Min(Name.Trim().Length, 80)];
        Seed = Math.Clamp(Seed, 0, int.MaxValue);
        Archetype = Pick(Archetype, Archetypes);
        Style = Pick(Style, Styles);
        Height = C(Height, 0.5, 60, 8);
        TrunkRadius = C(TrunkRadius, 0.02, 3, 0.25);
        Taper = C(Taper, 0, 1, 0.75);
        CrownStart = C(CrownStart, 0.05, 1, 0.35);
        Lean = C(Lean, 0, 45, 3);
        Wobble = C(Wobble, 0, 30, 4);
        Twist = C(Twist, -3, 3, 0);
        Flare = C(Flare, 0, 1, 0.5);
        Roots = Math.Clamp(Roots, 0, 12);
        Collar = C(Collar, 0, 1, 0.6);
        Shape = Pick(Shape, Shapes);
        Levels = (Levels ?? []).Where(l => l != null).Take(MaxLevels).ToList();
        foreach (var l in Levels)
        {
            l.Count = Math.Clamp(l.Count, 0, 80);
            l.Start = C(l.Start, 0, 0.95, 0.3);
            l.Angle = C(l.Angle, 0, 140, 50); l.AngleSpread = C(l.AngleSpread, 0, 60, 12);
            l.Length = C(l.Length, 0.02, 1.5, 0.5); l.LengthSpread = C(l.LengthSpread, 0, 0.9, 0.15);
            l.Radius = C(l.Radius, 0.05, 0.95, 0.55);
            l.Bend = C(l.Bend, -120, 120, 15); l.Wobble = C(l.Wobble, 0, 45, 6);
            l.Spiral = C(l.Spiral, 0, 360, 137.5);
            l.Whorl = Math.Clamp(l.Whorl, 1, 12);
        }
        Branches = Pick(Branches, BranchModes);
        WindData = Pick(WindData, WindChannels);
        MixedRadius = C(MixedRadius, 0.005, 2, 0.08);
        Quality = Qualities.Contains(Quality) ? Quality : "medium";
        Budget = Math.Clamp(Budget, 200, 500_000);
        Lods = Math.Clamp(Lods, 1, 6);
        Foliage = Pick(Foliage, FoliageKinds);
        LeafShape = Pick(LeafShape, LeafShapes);
        LeafDensity = C(LeafDensity, 0, 1, 0.6);
        LeafSize = C(LeafSize, 0.05, 5, 0.6);
        LeafColor = Hex(LeafColor, "#4f7a2c"); LeafColor2 = Hex(LeafColor2, "#8aa83a");
        CrownNormals = C(CrownNormals, 0, 1, 0.6);
        BarkColor = Hex(BarkColor, "#5a4636");
        BarkMaterial = BarkMaterial is { Length: <= 60 } && BarkMaterial.All(c => char.IsAsciiLetterOrDigit(c) || c == '-') ? BarkMaterial : "";
        BarkTile = C(BarkTile, 0.05, 20, 1);
        return this;
    }
}

/// <summary>Ready-made starting points: the four archetypes in both looks.</summary>
public static class TreePresets
{
    public sealed record Preset(string Id, string Name, string Description, Func<TreeRecipe> Make);

    public static readonly IReadOnlyList<Preset> All =
    [
        new("oak", "Oak (realistic)", "A broad, spreading crown on a short, stout trunk with root flare.", () => new TreeRecipe
        {
            Name = "Oak", Archetype = "broadleaf", Height = 10, TrunkRadius = 0.35, Taper = 0.7, CrownStart = 0.35, Flare = 0.6, Roots = 6, Shape = "hemispherical",
            Levels = [new() { Count = 7, Start = 0.35, Angle = 55, AngleSpread = 15, Length = 0.62, Radius = 0.6, Bend = 12, Wobble = 10 },
                      new() { Count = 9, Start = 0.15, Angle = 45, Length = 0.5, Radius = 0.5, Bend = 8, Wobble = 12 },
                      new() { Count = 6, Start = 0.2, Angle = 50, Length = 0.4, Radius = 0.5, Bend = 0, Wobble = 15 }],
            LeafShape = "broad", LeafSize = 0.9, LeafDensity = 0.65, LeafColor = "#3f6b26", LeafColor2 = "#7a9a33",
        }),
        new("pine", "Pine (realistic)", "A tall conifer with whorls of near-level branches and needle cards.", () => new TreeRecipe
        {
            Name = "Pine", Archetype = "conifer", Height = 14, TrunkRadius = 0.25, Taper = 0.95, CrownStart = 1, Flare = 0.35, Roots = 4, Shape = "conical", Lean = 1, Wobble = 2,
            Levels = [new() { Count = 40, Start = 0.25, Angle = 85, AngleSpread = 8, Length = 0.35, Radius = 0.35, Bend = -10, Wobble = 5, Whorl = 5, Spiral = 36 },
                      new() { Count = 10, Start = 0.1, Angle = 55, Length = 0.4, Radius = 0.5, Bend = 5, Wobble = 6 }],
            LeafShape = "needle", LeafSize = 0.7, LeafDensity = 0.85, LeafColor = "#2c4a26", LeafColor2 = "#4d6b30", BarkColor = "#5b4130",
        }),
        new("birch", "Birch (realistic)", "A slender white trunk and fine, drooping branches.", () => new TreeRecipe
        {
            Name = "Birch", Archetype = "birch", Height = 11, TrunkRadius = 0.16, Taper = 0.9, CrownStart = 0.9, Flare = 0.25, Roots = 4, Shape = "flame", Lean = 4,
            Levels = [new() { Count = 22, Start = 0.3, Angle = 40, Length = 0.38, Radius = 0.45, Bend = -25, Wobble = 8 },
                      new() { Count = 10, Start = 0.15, Angle = 35, Length = 0.5, Radius = 0.5, Bend = -40, Wobble = 10 }],
            LeafShape = "round", LeafSize = 0.5, LeafDensity = 0.55, LeafColor = "#5d8a2e", LeafColor2 = "#a6b83d", BarkColor = "#d9d4c7", BarkMaterial = "",
        }),
        new("dead", "Dead tree (realistic)", "Bare, twisted and broken: no leaves.", () => new TreeRecipe
        {
            Name = "Dead tree", Archetype = "dead", Height = 7, TrunkRadius = 0.28, Taper = 0.8, CrownStart = 0.45, Flare = 0.7, Roots = 6, Shape = "inverse", Lean = 8, Wobble = 12, Twist = 0.3,
            Levels = [new() { Count = 6, Start = 0.4, Angle = 50, AngleSpread = 25, Length = 0.55, Radius = 0.55, Bend = 5, Wobble = 22 },
                      new() { Count = 5, Start = 0.2, Angle = 45, AngleSpread = 20, Length = 0.45, Radius = 0.5, Bend = -5, Wobble = 25 }],
            Foliage = "none", BarkColor = "#6b6158",
        }),
        new("stylized-oak", "Stylized oak", "A chunky, twisted trunk under big puffy leaf clumps, the hand-painted fantasy look.", () => new TreeRecipe
        {
            Name = "Stylized oak", Archetype = "broadleaf", Style = "stylized", Height = 7, TrunkRadius = 0.45, Taper = 0.6, CrownStart = 0.4, Flare = 0.9, Roots = 5, Shape = "spherical", Twist = 0.6, Wobble = 6, Collar = 0.9,
            Levels = [new() { Count = 5, Start = 0.45, Angle = 50, AngleSpread = 12, Length = 0.6, Radius = 0.65, Bend = 25, Wobble = 10 },
                      new() { Count = 4, Start = 0.3, Angle = 40, Length = 0.5, Radius = 0.55, Bend = 20, Wobble = 10 }],
            Foliage = "tufts", LeafSize = 1.3, LeafDensity = 0.7, LeafColor = "#3e7d2a", LeafColor2 = "#b7d14a", BarkColor = "#6e4a2f", BarkMaterial = "", Budget = 3000, Quality = "low",
        }),
        new("stylized-pine", "Stylized pine", "Stacked, chunky tiers of foliage on a curving trunk.", () => new TreeRecipe
        {
            Name = "Stylized pine", Archetype = "conifer", Style = "stylized", Height = 9, TrunkRadius = 0.32, Taper = 0.95, CrownStart = 1, Flare = 0.6, Roots = 4, Shape = "conical", Lean = 5, Wobble = 5, Twist = 0.2, Collar = 0.9,
            Levels = [new() { Count = 42, Start = 0.22, Angle = 80, Length = 0.3, Radius = 0.4, Bend = -15, Wobble = 4, Whorl = 6, Spiral = 30 }],
            Foliage = "tufts", LeafShape = "needle", LeafSize = 1.1, LeafDensity = 0.8, LeafColor = "#245a3a", LeafColor2 = "#6fae4f", BarkColor = "#6b4630", BarkMaterial = "", Budget = 2500, Quality = "low",
        }),
        new("stylized-dead", "Stylized dead tree", "A gnarled, spiralling spooky tree.", () => new TreeRecipe
        {
            Name = "Stylized dead tree", Archetype = "dead", Style = "stylized", Height = 6, TrunkRadius = 0.4, Taper = 0.75, CrownStart = 0.5, Flare = 1, Roots = 5, Shape = "inverse", Lean = 10, Wobble = 10, Twist = 1.2, Collar = 1,
            Levels = [new() { Count = 5, Start = 0.45, Angle = 55, AngleSpread = 20, Length = 0.6, Radius = 0.6, Bend = -20, Wobble = 20 },
                      new() { Count = 3, Start = 0.3, Angle = 50, AngleSpread = 20, Length = 0.5, Radius = 0.55, Bend = -30, Wobble = 20 }],
            Foliage = "none", BarkColor = "#5e5148", BarkMaterial = "", Budget = 3000, Quality = "low",
        }),
    ];

    public static TreeRecipe Make(string id) => (All.FirstOrDefault(p => p.Id == id) ?? All[0]).Make().Clamped();
}
