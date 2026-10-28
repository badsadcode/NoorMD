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
    public static readonly string[] Shapes = ["spherical", "hemispherical", "conical", "cylindrical", "flame", "inverse", "tapered", "umbrella"];
    public static readonly string[] RootStyles = ["flare", "surface", "prop", "compact"];
    public static readonly string[] Arrangements = ["scatter", "single", "cross", "star", "fan", "dome", "hanging", "fronds"];
    public static readonly string[] BranchModes = ["merged", "separate", "mixed"];
    public static readonly string[] FoliageKinds = ["cards", "tufts", "clumps", "both", "crystals", "none"];
    public static readonly string[] LeafShapes = ["broad", "round", "needle", "maple", "slender", "frond"];
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
    /// <summary>
    /// Roots: "flare" (short buttresses melted into the base), "surface" (long roots snaking over the ground, forking,
    /// their tips sinking in), "prop" (mangrove stilts arching from the trunk down to the ground) or "compact" (a collar only).
    /// </summary>
    public string RootStyle { get; set; } = "flare";
    /// <summary>Root length (× the usual), forks on each surface root, and how deep their tips sink (0–1).</summary>
    public double RootLength { get; set; } = 1;
    public int RootForks { get; set; } = 1;
    public double RootBurial { get; set; } = 0.4;
    /// <summary>Cypress knees: woody cones rising from the ground (or water) around the tree.</summary>
    public int Knees { get; set; }
    /// <summary>Fluting: ridges and grooves running up the trunk (sequoia, cypress), how deep (0–1), how many, how high (0–1).</summary>
    public double Flute { get; set; }
    public int FluteLobes { get; set; } = 7;
    public double FluteHeight { get; set; } = 0.35;
    /// <summary>A swelling of the trunk (baobab, bottle tree): how much (0–1) and where (0–1 of the trunk).</summary>
    public double Bulge { get; set; }
    public double BulgeAt { get; set; } = 0.3;
    /// <summary>An S-curve in the trunk, as a share of the height.</summary>
    public double SCurve { get; set; }
    /// <summary>Windswept: every branch pulled the same way (0 none … 1 a hard sea wind), the trunk leaning with it.</summary>
    public double Windswept { get; set; }

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
    /// <summary>A last level of detail made of crossed cards showing the tree drawn from 2–4 sides (for far away).</summary>
    public bool Billboard { get; set; } = true;
    public int BillboardViews { get; set; } = 2;

    // Foliage.
    public string Foliage { get; set; } = "cards";
    /// <summary>
    /// How the cards are set where leaves grow: "scatter" (one each, random), "single", "cross" (two upright, 90°
    /// apart), "star" (three, 60° apart), "fan" (three nearly level, for spruce tiers and acacias), "dome" (four
    /// leaning in and a cap), "hanging" (long ribbons down from the branches, willow) or "fronds" (a strip along every
    /// outer branch, palm and fern).
    /// </summary>
    public string Arrangement { get; set; } = "scatter";
    /// <summary>Hanging ribbons: how long (metres; they stop above the ground).</summary>
    public double HangLength { get; set; } = 3;
    /// <summary>Hanging moss on the branches (0 none … 1 heavy, the swamp look), its colour, and hanging vines (count).</summary>
    public double Moss { get; set; }
    public string MossColor { get; set; } = "#7d8a6a";
    /// <summary>
    /// A mushroom cap on top of the trunk (its width in metres; 0 none), and smaller ones on the limb tips (0–1, their
    /// size as a share of the main one). Its colour, the spots on it (0 none … 1 many) and their colour.
    /// </summary>
    public double CapWidth { get; set; }
    public double BranchCaps { get; set; }
    public string CapColor { get; set; } = "#b8321e";
    public double Spots { get; set; } = 0.6;
    public string SpotColor { get; set; } = "#f2ead6";
    /// <summary>How brightly crystals, caps and leaves of a fantasy tree glow (0 none … 1 bright), in the light colour.</summary>
    public double Glow { get; set; }
    public int Vines { get; set; }
    public string LeafShape { get; set; } = "broad";
    /// <summary>How full the crown is (0–1) and the size of each leaf card (metres).</summary>
    public double LeafDensity { get; set; } = 0.6;
    public double LeafSize { get; set; } = 0.6;
    public string LeafColor { get; set; } = "#4f7a2c";
    public string LeafColor2 { get; set; } = "#8aa83a";
    /// <summary>Leaf normals bent to point out of the crown (0 the card's own … 1 fully outwards): soft, even lighting.</summary>
    public double CrownNormals { get; set; } = 0.6;
    /// <summary>What one card shows: a twig, a spray of three twigs or a dense cluster (LeafAtlas.Clusters).</summary>
    public string LeafCluster { get; set; } = "twig";
    /// <summary>
    /// The size of each card's plane, as a share of the leaf size (0.3–4). Unlike the leaf size it doesn't change how many
    /// cards there are: bigger planes make a fuller crown for the same triangles.
    /// </summary>
    public double CardScale { get; set; } = 1;
    /// <summary>
    /// Most triangles the leaves may use on the finest level. When the density asks for more, the cards get bigger and
    /// fewer instead, so the crown stays as full.
    /// </summary>
    public int LeafBudget { get; set; } = 16000;
    /// <summary>Leaves moved from the hidden inside of the crown to its outside, where they are seen (0 none … 1 most).</summary>
    public double OuterLeaves { get; set; } = 0.5;

    // Bark.
    public string BarkColor { get; set; } = "#5a4636";
    /// <summary>
    /// The bark: "bark" (realistic furrows in the bark colour), "painted" (hand-painted grooves, the stylized look),
    /// "birch" (pale with dark marks), any Texture Bench preset id, or empty for a plain colour.
    /// </summary>
    public string BarkMaterial { get; set; } = "bark";
    /// <summary>How much bark one texture covers (metres).</summary>
    public double BarkTile { get; set; } = 1;

    /// <summary>Painted shading in the vertex colours: crowns darker inside and below, trunks darker near the ground (0 none … 1 strong).</summary>
    public double Shading { get; set; } = 0.7;
    public bool Wind { get; set; } = true;
    /// <summary>
    /// Pictures of your own (full paths; empty: generated): a bark texture (tiles round and up the branches), and a leaf
    /// picture with transparency, either a 2 × 2 atlas (each card shows one cell, its stem at the bottom middle) or one
    /// sprite for every card.
    /// </summary>
    public string BarkImage { get; set; } = "";
    public string LeafImage { get; set; } = "";
    public bool LeafImageAtlas { get; set; } = true;
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
    private static string CleanPath(string? p) => p is { Length: > 0 and <= 1000 } && !p.Any(char.IsControl) ? p : "";
    private static string Hex(string? v, string fallback) => v is { Length: 7 } && v[0] == '#' && v.Skip(1).All(Uri.IsHexDigit) ? v.ToLowerInvariant() : fallback;

    public TreeRecipe Clamped()
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "Tree" : Name.Trim()[..Math.Min(Name.Trim().Length, 80)];
        Seed = Math.Clamp(Seed, 0, int.MaxValue);
        Archetype = Pick(Archetype, Archetypes);
        Style = Pick(Style, Styles);
        Height = C(Height, 0.3, 120, 8);
        TrunkRadius = C(TrunkRadius, 0.01, 6, 0.25);
        Taper = C(Taper, 0, 1, 0.75);
        CrownStart = C(CrownStart, 0.05, 1, 0.35);
        Lean = C(Lean, 0, 45, 3);
        Wobble = C(Wobble, 0, 30, 4);
        Twist = C(Twist, -3, 3, 0);
        Flare = C(Flare, 0, 1, 0.5);
        Roots = Math.Clamp(Roots, 0, 12);
        Collar = C(Collar, 0, 1, 0.6);
        RootStyle = Pick(RootStyle, RootStyles);
        RootLength = C(RootLength, 0.2, 4, 1);
        RootForks = Math.Clamp(RootForks, 0, 3);
        RootBurial = C(RootBurial, 0, 1, 0.4);
        Knees = Math.Clamp(Knees, 0, 60);
        Flute = C(Flute, 0, 1, 0);
        FluteLobes = Math.Clamp(FluteLobes, 3, 14);
        FluteHeight = C(FluteHeight, 0.05, 1, 0.35);
        Bulge = C(Bulge, 0, 1.5, 0);
        BulgeAt = C(BulgeAt, 0, 1, 0.3);
        SCurve = C(SCurve, 0, 0.3, 0);
        Windswept = C(Windswept, 0, 1, 0);
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
        Shading = C(Shading, 0, 1, 0.7);
        BarkImage = CleanPath(BarkImage);
        LeafImage = CleanPath(LeafImage);
        MixedRadius = C(MixedRadius, 0.005, 2, 0.08);
        Quality = Qualities.Contains(Quality) ? Quality : "medium";
        Budget = Math.Clamp(Budget, 200, 500_000);
        Lods = Math.Clamp(Lods, 1, 6);
        BillboardViews = Math.Clamp(BillboardViews, 2, 4);
        Foliage = Pick(Foliage, FoliageKinds);
        Arrangement = Pick(Arrangement, Arrangements);
        HangLength = C(HangLength, 0.2, 30, 3);
        Moss = C(Moss, 0, 1, 0);
        MossColor = Hex(MossColor, "#7d8a6a");
        Vines = Math.Clamp(Vines, 0, 60);
        CapWidth = C(CapWidth, 0, 30, 0);
        BranchCaps = C(BranchCaps, 0, 1, 0);
        CapColor = Hex(CapColor, "#b8321e");
        Spots = C(Spots, 0, 1, 0.6);
        SpotColor = Hex(SpotColor, "#f2ead6");
        Glow = C(Glow, 0, 1, 0);
        LeafShape = Pick(LeafShape, LeafShapes);
        LeafDensity = C(LeafDensity, 0, 1, 0.6);
        LeafSize = C(LeafSize, 0.05, 5, 0.6);
        LeafColor = Hex(LeafColor, "#4f7a2c"); LeafColor2 = Hex(LeafColor2, "#8aa83a");
        CrownNormals = C(CrownNormals, 0, 1, 0.6);
        LeafCluster = Pick(LeafCluster, LeafAtlas.Clusters);
        CardScale = C(CardScale, 0.3, 4, 1);
        LeafBudget = Math.Clamp(LeafBudget, 500, 200_000);
        OuterLeaves = C(OuterLeaves, 0, 1, 0.5);
        BarkColor = Hex(BarkColor, "#5a4636");
        BarkMaterial = BarkMaterial is { Length: <= 60 } && BarkMaterial.All(c => char.IsAsciiLetterOrDigit(c) || c == '-') ? BarkMaterial : "";
        BarkTile = C(BarkTile, 0.05, 20, 1);
        return this;
    }
}

/// <summary>Ready-made starting points: the four archetypes in both looks.</summary>
public static class TreePresets
{
    /// <param name="Group">Where it grows, for the list: Forest, Swamp &amp; marsh, Giants, Tropical, Dry &amp; windswept, Fantasy.</param>
    public sealed record Preset(string Id, string Name, string Description, Func<TreeRecipe> Make, string Group = "Forest");

    private static TreeLevel L(int count, double start, double angle, double length, double radius, double bend, double wobble = 6, double spread = 12, int whorl = 1, double spiral = 137.5) =>
        new() { Count = count, Start = start, Angle = angle, AngleSpread = spread, Length = length, Radius = radius, Bend = bend, Wobble = wobble, Whorl = whorl, Spiral = spiral };

    public static readonly IReadOnlyList<Preset> All =
    [
        new("oak", "Oak (realistic)", "A broad, spreading crown on a short, stout trunk with root flare.", () => new TreeRecipe
        {
            Name = "Oak", Archetype = "broadleaf", Height = 10, TrunkRadius = 0.35, Taper = 0.7, CrownStart = 0.35, Flare = 0.6, Roots = 6, Shape = "hemispherical",
            Levels = [new() { Count = 7, Start = 0.35, Angle = 55, AngleSpread = 15, Length = 0.62, Radius = 0.6, Bend = 12, Wobble = 10 },
                      new() { Count = 9, Start = 0.15, Angle = 45, Length = 0.5, Radius = 0.5, Bend = 8, Wobble = 12 },
                      new() { Count = 6, Start = 0.2, Angle = 50, Length = 0.4, Radius = 0.5, Bend = 0, Wobble = 15 }],
            LeafCluster = "cluster", LeafShape = "broad", LeafSize = 0.9, LeafDensity = 0.65, LeafColor = "#3f6b26", LeafColor2 = "#7a9a33",
        }),
        new("pine", "Pine (realistic)", "A tall conifer with whorls of near-level branches and needle cards.", () => new TreeRecipe
        {
            Name = "Pine", Archetype = "conifer", Height = 14, TrunkRadius = 0.25, Taper = 0.95, CrownStart = 1, Flare = 0.35, Roots = 4, Shape = "conical", Lean = 1, Wobble = 2,
            Levels = [new() { Count = 40, Start = 0.25, Angle = 85, AngleSpread = 8, Length = 0.35, Radius = 0.35, Bend = -10, Wobble = 5, Whorl = 5, Spiral = 36 },
                      new() { Count = 10, Start = 0.1, Angle = 55, Length = 0.4, Radius = 0.5, Bend = 5, Wobble = 6 }],
            LeafCluster = "spray", LeafShape = "needle", LeafSize = 0.7, LeafDensity = 0.85, LeafColor = "#2c4a26", LeafColor2 = "#4d6b30", BarkColor = "#5b4130",
        }),
        new("birch", "Birch (realistic)", "A slender white trunk and fine, drooping branches.", () => new TreeRecipe
        {
            Name = "Birch", Archetype = "birch", Height = 11, TrunkRadius = 0.16, Taper = 0.9, CrownStart = 0.9, Flare = 0.25, Roots = 4, Shape = "flame", Lean = 4,
            Levels = [new() { Count = 22, Start = 0.3, Angle = 40, Length = 0.38, Radius = 0.45, Bend = -25, Wobble = 8 },
                      new() { Count = 10, Start = 0.15, Angle = 35, Length = 0.5, Radius = 0.5, Bend = -40, Wobble = 10 }],
            LeafCluster = "cluster", LeafShape = "round", LeafSize = 0.5, LeafDensity = 0.55, LeafColor = "#5d8a2e", LeafColor2 = "#a6b83d", BarkColor = "#e2ddd2", BarkMaterial = "birch",
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
            Foliage = "tufts", LeafSize = 1.3, LeafDensity = 0.7, LeafColor = "#3e7d2a", LeafColor2 = "#b7d14a", BarkColor = "#6e4a2f", BarkMaterial = "painted", Budget = 3000, Quality = "low",
        }),
        new("stylized-pine", "Stylized pine", "Stacked, chunky tiers of foliage on a curving trunk.", () => new TreeRecipe
        {
            Name = "Stylized pine", Archetype = "conifer", Style = "stylized", Height = 9, TrunkRadius = 0.32, Taper = 0.95, CrownStart = 1, Flare = 0.6, Roots = 4, Shape = "conical", Lean = 5, Wobble = 5, Twist = 0.2, Collar = 0.9,
            Levels = [new() { Count = 42, Start = 0.22, Angle = 80, Length = 0.3, Radius = 0.4, Bend = -15, Wobble = 4, Whorl = 6, Spiral = 30 }],
            Foliage = "tufts", LeafShape = "needle", LeafSize = 1.1, LeafDensity = 0.8, LeafColor = "#245a3a", LeafColor2 = "#6fae4f", BarkColor = "#6b4630", BarkMaterial = "painted", Budget = 2500, Quality = "low",
        }),
        new("stylized-dead", "Stylized dead tree", "A gnarled, spiralling spooky tree.", () => new TreeRecipe
        {
            Name = "Stylized dead tree", Archetype = "dead", Style = "stylized", Height = 6, TrunkRadius = 0.4, Taper = 0.75, CrownStart = 0.5, Flare = 1, Roots = 5, Shape = "inverse", Lean = 10, Wobble = 10, Twist = 1.2, Collar = 1,
            Levels = [new() { Count = 5, Start = 0.45, Angle = 55, AngleSpread = 20, Length = 0.6, Radius = 0.6, Bend = -20, Wobble = 20 },
                      new() { Count = 3, Start = 0.3, Angle = 50, AngleSpread = 20, Length = 0.5, Radius = 0.55, Bend = -30, Wobble = 20 }],
            Foliage = "none", BarkColor = "#5e5148", BarkMaterial = "painted", Budget = 3000, Quality = "low",
        }),

        // ---- Forest, more kinds.
        new("spruce", "Spruce (realistic)", "A dense, narrow cone of drooping branches in tiers of fanned needle cards.", () => new TreeRecipe
        {
            Name = "Spruce", Archetype = "conifer", Height = 16, TrunkRadius = 0.28, Taper = 0.95, CrownStart = 1, Flare = 0.4, Roots = 5, Shape = "conical", Lean = 1, Wobble = 2,
            Levels = [L(48, 0.15, 95, 0.3, 0.32, -20, 4, 8, 4, 45), L(8, 0.15, 55, 0.45, 0.5, 0, 5)],
            LeafCluster = "spray", LeafShape = "needle", Arrangement = "fan", LeafSize = 0.75, LeafDensity = 0.7, LeafColor = "#1f3d24", LeafColor2 = "#3e5f2c", BarkColor = "#4d3a2e",
        }),
        new("maple", "Autumn maple (realistic)", "A round crown of maple leaves in autumn reds and oranges.", () => new TreeRecipe
        {
            Name = "Autumn maple", Archetype = "broadleaf", Height = 11, TrunkRadius = 0.3, Taper = 0.7, CrownStart = 0.35, Flare = 0.45, Shape = "spherical",
            Levels = [L(7, 0.35, 45, 0.6, 0.6, 15, 10), L(8, 0.15, 45, 0.5, 0.5, 5, 10), L(5, 0.2, 50, 0.4, 0.5, 0, 12)],
            LeafCluster = "cluster", LeafShape = "maple", Arrangement = "dome", LeafSize = 0.7, LeafDensity = 0.6, LeafColor = "#a3301a", LeafColor2 = "#f0a028", BarkColor = "#5a4a40",
        }),

        // ---- Swamp and marsh.
        new("cypress", "Bald cypress (realistic)", "A swamp giant: fluted, flared base, knees rising from the water, a flat crown hung with moss.", () => new TreeRecipe
        {
            Name = "Bald cypress", Archetype = "broadleaf", Height = 18, TrunkRadius = 0.7, Taper = 0.85, CrownStart = 0.5, Flare = 0.9, Roots = 7, Collar = 0.7, Shape = "umbrella",
            Flute = 0.8, FluteLobes = 9, FluteHeight = 0.25, Knees = 14,
            Levels = [L(12, 0.45, 70, 0.45, 0.45, -10, 12, 15), L(7, 0.15, 50, 0.5, 0.5, 0, 10)],
            LeafCluster = "spray", LeafShape = "needle", Arrangement = "fan", LeafSize = 0.8, LeafDensity = 0.55, LeafColor = "#3d5a2a", LeafColor2 = "#6f8a3c", BarkColor = "#6b5848",
            Moss = 0.7, Budget = 12000,
        }, "Swamp & marsh"),
        new("stylized-cypress", "Stylized swamp cypress", "Chunky, fluted and twisted, knees all round, moss dripping from the boughs.", () => new TreeRecipe
        {
            Name = "Stylized swamp cypress", Archetype = "broadleaf", Style = "stylized", Height = 10, TrunkRadius = 0.75, Taper = 0.7, CrownStart = 0.5, Flare = 1, Roots = 6, Collar = 0.9,
            Shape = "umbrella", Twist = 0.4, Flute = 0.9, FluteLobes = 7, FluteHeight = 0.3, Knees = 10,
            Levels = [L(7, 0.5, 65, 0.55, 0.55, 5, 10, 15), L(4, 0.3, 45, 0.5, 0.55, 5, 10)],
            Foliage = "tufts", LeafShape = "needle", LeafSize = 1.3, LeafDensity = 0.7, LeafColor = "#335c2e", LeafColor2 = "#8fb84a", BarkColor = "#7a5a42", BarkMaterial = "painted",
            Moss = 0.8, MossColor = "#8fa07a", Budget = 4000, Quality = "low",
        }, "Swamp & marsh"),
        new("mangrove", "Mangrove (realistic)", "Stilt roots arching out of the water, a low dome of glossy leaves.", () => new TreeRecipe
        {
            Name = "Mangrove", Archetype = "broadleaf", Height = 7, TrunkRadius = 0.25, Taper = 0.6, CrownStart = 0.45, RootStyle = "prop", Roots = 9, Shape = "hemispherical", Lean = 5,
            Levels = [L(7, 0.4, 55, 0.6, 0.55, 10, 12), L(7, 0.2, 45, 0.5, 0.5, 5, 12)],
            LeafCluster = "cluster", LeafShape = "broad", Arrangement = "dome", LeafSize = 0.6, LeafDensity = 0.6, LeafColor = "#2f5a22", LeafColor2 = "#5f8a2e", BarkColor = "#5e5348",
        }, "Swamp & marsh"),
        new("stylized-mangrove", "Stylized mangrove", "A squat crown on a tangle of chunky stilt roots.", () => new TreeRecipe
        {
            Name = "Stylized mangrove", Archetype = "broadleaf", Style = "stylized", Height = 6, TrunkRadius = 0.32, Taper = 0.55, CrownStart = 0.5, RootStyle = "prop", Roots = 7, RootLength = 0.9, Shape = "hemispherical", Twist = 0.3, Collar = 0.9,
            Levels = [L(5, 0.45, 55, 0.6, 0.6, 15, 10), L(3, 0.3, 45, 0.5, 0.55, 10, 10)],
            Foliage = "tufts", LeafSize = 1.1, LeafDensity = 0.7, LeafColor = "#2e6a2a", LeafColor2 = "#9ccc4a", BarkColor = "#6a5444", BarkMaterial = "painted", Budget = 3500, Quality = "low",
        }, "Swamp & marsh"),
        new("willow", "Weeping willow (realistic)", "Long curtains of slender leaves hanging nearly to the ground.", () => new TreeRecipe
        {
            Name = "Weeping willow", Archetype = "broadleaf", Height = 11, TrunkRadius = 0.5, Taper = 0.7, CrownStart = 0.35, RootStyle = "surface", Roots = 6, RootLength = 0.8, Shape = "hemispherical", Lean = 4,
            Levels = [L(8, 0.35, 45, 0.6, 0.6, 20, 10), L(10, 0.2, 35, 0.45, 0.5, -50, 8)],
            LeafShape = "slender", Arrangement = "hanging", HangLength = 7, LeafSize = 0.7, LeafDensity = 0.5, LeafColor = "#6d8a2c", LeafColor2 = "#b2c24a", BarkColor = "#5a4c3e",
        }, "Swamp & marsh"),
        new("stylized-willow", "Stylized willow", "A chunky twisted willow under swaying curtains.", () => new TreeRecipe
        {
            Name = "Stylized willow", Archetype = "broadleaf", Style = "stylized", Height = 8, TrunkRadius = 0.55, Taper = 0.65, CrownStart = 0.4, RootStyle = "surface", Roots = 5, Shape = "hemispherical", Twist = 0.5, Collar = 0.9,
            Levels = [L(6, 0.4, 50, 0.6, 0.6, 25, 8), L(6, 0.25, 40, 0.5, 0.55, -45, 8)],
            LeafShape = "slender", Arrangement = "hanging", HangLength = 4, LeafSize = 0.9, LeafDensity = 0.75, LeafColor = "#4f8a2a", LeafColor2 = "#c4dc5a", BarkColor = "#6e5440", BarkMaterial = "painted", Budget = 3500, Quality = "low",
        }, "Swamp & marsh"),
        new("bog-snag", "Bog snag (realistic)", "A dead swamp tree hung with moss and vines.", () => new TreeRecipe
        {
            Name = "Bog snag", Archetype = "dead", Height = 9, TrunkRadius = 0.4, Taper = 0.75, CrownStart = 0.45, Flare = 0.8, Roots = 6, Shape = "inverse", Lean = 6, Wobble = 10, Flute = 0.4, Knees = 6,
            Levels = [L(6, 0.4, 55, 0.5, 0.55, 0, 20, 25), L(4, 0.2, 45, 0.45, 0.5, -10, 22, 20)],
            Foliage = "none", BarkColor = "#5e5850", Moss = 0.9, Vines = 6,
        }, "Swamp & marsh"),
        new("stylized-horror", "Haunted swamp tree", "Twisted, knotted and hung with moss and vines: the spooky marsh landmark.", () => new TreeRecipe
        {
            Name = "Haunted swamp tree", Archetype = "dead", Style = "stylized", Height = 8, TrunkRadius = 0.55, Taper = 0.75, CrownStart = 0.45, Flare = 1, Roots = 6, Shape = "inverse", Lean = 8, Wobble = 8, Twist = 1.1, Collar = 1, Knees = 8,
            Levels = [L(6, 0.45, 60, 0.6, 0.6, -25, 18, 20), L(3, 0.3, 50, 0.5, 0.55, -35, 18, 20)],
            Foliage = "none", BarkColor = "#4a4248", BarkMaterial = "painted", Moss = 1, MossColor = "#6e7a5c", Vines = 10, Budget = 3500, Quality = "low",
        }, "Swamp & marsh"),

        // ---- Giants.
        new("sequoia", "Giant sequoia (realistic)", "A colossal fluted red trunk with a high, narrow crown of short drooping branches.", () => new TreeRecipe
        {
            Name = "Giant sequoia", Archetype = "conifer", Height = 75, TrunkRadius = 3.2, Taper = 0.9, CrownStart = 1, Flare = 0.8, Roots = 8, Lean = 1, Wobble = 1.5,
            Flute = 0.7, FluteLobes = 11, FluteHeight = 0.3, Shape = "conical",
            Levels = [L(55, 0.45, 80, 0.2, 0.22, -20, 8), L(7, 0.15, 50, 0.55, 0.5, 10, 8)],
            LeafCluster = "spray", LeafShape = "needle", Arrangement = "fan", LeafSize = 2.6, LeafDensity = 0.8, LeafColor = "#2c4a26", LeafColor2 = "#55702f", BarkColor = "#8a4a2c", BarkTile = 3, Budget = 20000,
        }, "Giants"),
        new("stylized-sequoia", "Stylized sequoia", "A towering chunky red trunk, ribbed, under tiered tufts.", () => new TreeRecipe
        {
            Name = "Stylized sequoia", Archetype = "conifer", Style = "stylized", Height = 30, TrunkRadius = 1.6, Taper = 0.85, CrownStart = 1, Flare = 0.9, Roots = 6, Collar = 0.9,
            Flute = 0.9, FluteLobes = 8, FluteHeight = 0.35, Shape = "conical", Wobble = 2,
            Levels = [L(24, 0.45, 80, 0.2, 0.35, -15, 4, 8, 4, 40)],
            Foliage = "tufts", LeafShape = "needle", LeafSize = 2.4, LeafDensity = 0.75, LeafColor = "#245a3a", LeafColor2 = "#6fae4f", BarkColor = "#a0502e", BarkMaterial = "painted", Budget = 5000, Quality = "low",
        }, "Giants"),

        // ---- Tropical.
        new("palm", "Palm (realistic)", "A slim, curving trunk crowned with drooping fronds.", () => new TreeRecipe
        {
            Name = "Palm", Archetype = "broadleaf", Height = 9, TrunkRadius = 0.18, Taper = 0.3, CrownStart = 1, RootStyle = "compact", Lean = 8, SCurve = 0.05, Wobble = 1,
            Levels = [L(14, 0.97, 70, 0.3, 0.25, -60, 3, 20)],
            LeafShape = "frond", Arrangement = "fronds", LeafSize = 1.4, LeafColor = "#3c6a24", LeafColor2 = "#7fa83a", BarkColor = "#7a6a58",
        }, "Tropical"),
        new("stylized-palm", "Stylized palm", "A bent, chunky palm with big, bright fronds.", () => new TreeRecipe
        {
            Name = "Stylized palm", Archetype = "broadleaf", Style = "stylized", Height = 7, TrunkRadius = 0.28, Taper = 0.4, CrownStart = 1, RootStyle = "compact", Lean = 14, SCurve = 0.08, Collar = 0.9,
            Levels = [L(10, 0.97, 65, 0.4, 0.3, -55, 3, 20)],
            LeafShape = "frond", Arrangement = "fronds", LeafSize = 1.8, LeafColor = "#2f7a2a", LeafColor2 = "#a8d84a", BarkColor = "#8a6a4a", BarkMaterial = "painted", Budget = 3000, Quality = "low",
        }, "Tropical"),
        new("tree-fern", "Tree fern (realistic)", "A short furry trunk with a crown of arching fern fronds.", () => new TreeRecipe
        {
            Name = "Tree fern", Archetype = "broadleaf", Height = 4, TrunkRadius = 0.15, Taper = 0.2, CrownStart = 1, RootStyle = "compact", Lean = 4,
            Levels = [L(16, 0.97, 75, 0.55, 0.2, -50, 4, 15)],
            LeafShape = "frond", Arrangement = "fronds", LeafSize = 1.2, LeafColor = "#3a6a2a", LeafColor2 = "#82b042", BarkColor = "#4e3e30",
        }, "Tropical"),
        new("baobab", "Baobab (realistic)", "A swollen bottle trunk with a small, flat crown of stubby branches.", () => new TreeRecipe
        {
            Name = "Baobab", Archetype = "broadleaf", Height = 12, TrunkRadius = 0.9, Taper = 0.6, CrownStart = 0.75, RootStyle = "compact", Bulge = 1, BulgeAt = 0.35, Shape = "umbrella",
            Levels = [L(8, 0.4, 70, 0.4, 0.45, 20, 12, 15), L(4, 0.3, 45, 0.45, 0.5, 10, 12)],
            LeafCluster = "cluster", LeafShape = "round", Arrangement = "dome", LeafSize = 0.8, LeafDensity = 0.55, LeafColor = "#4a6a2a", LeafColor2 = "#8aa840", BarkColor = "#8a7a6a",
        }, "Tropical"),
        new("stylized-baobab", "Stylized baobab", "A comically fat bottle trunk with a tiny tufted crown.", () => new TreeRecipe
        {
            Name = "Stylized baobab", Archetype = "broadleaf", Style = "stylized", Height = 9, TrunkRadius = 1.0, Taper = 0.55, CrownStart = 0.75, RootStyle = "compact", Bulge = 1.3, BulgeAt = 0.3, Shape = "umbrella", Twist = 0.2,
            Levels = [L(6, 0.45, 70, 0.45, 0.5, 25, 10, 15), L(3, 0.3, 45, 0.45, 0.5, 15, 10)],
            Foliage = "tufts", LeafShape = "round", LeafSize = 1.1, LeafDensity = 0.55, LeafColor = "#4a7a2a", LeafColor2 = "#b8d050", BarkColor = "#a08870", BarkMaterial = "painted", Budget = 3000, Quality = "low",
        }, "Tropical"),

        // ---- Dry and windswept.
        new("juniper", "Windswept juniper (realistic)", "A low, gnarled tree bent by a constant wind off the cliffs.", () => new TreeRecipe
        {
            Name = "Windswept juniper", Archetype = "broadleaf", Height = 4, TrunkRadius = 0.22, Taper = 0.7, CrownStart = 0.3, Flare = 0.6, Windswept = 0.85, Twist = 0.5, Wobble = 10, Shape = "hemispherical",
            Levels = [L(8, 0.3, 50, 0.6, 0.55, 0, 14, 15), L(6, 0.2, 45, 0.5, 0.5, -5, 14)],
            LeafCluster = "spray", LeafShape = "needle", Arrangement = "fan", LeafSize = 0.5, LeafDensity = 0.7, LeafColor = "#2f4a2a", LeafColor2 = "#5a7040", BarkColor = "#7a6a5c",
        }, "Dry & windswept"),
        new("stylized-juniper", "Stylized windswept pine", "A cliff-top pine swept flat by the wind, chunky and twisted.", () => new TreeRecipe
        {
            Name = "Stylized windswept pine", Archetype = "broadleaf", Style = "stylized", Height = 5, TrunkRadius = 0.32, Taper = 0.65, CrownStart = 0.35, Flare = 0.9, Windswept = 0.9, Twist = 0.7, Collar = 0.9, Shape = "hemispherical",
            Levels = [L(5, 0.35, 55, 0.65, 0.6, 5, 10, 15), L(3, 0.3, 45, 0.5, 0.55, 0, 10)],
            Foliage = "tufts", LeafShape = "needle", LeafSize = 1, LeafDensity = 0.75, LeafColor = "#245a3a", LeafColor2 = "#7ab44f", BarkColor = "#7a5a42", BarkMaterial = "painted", Budget = 3000, Quality = "low",
        }, "Dry & windswept"),
        new("acacia", "Acacia (realistic)", "A flat-topped umbrella crown on a leaning savanna trunk.", () => new TreeRecipe
        {
            Name = "Acacia", Archetype = "broadleaf", Height = 7, TrunkRadius = 0.28, Taper = 0.6, CrownStart = 0.45, Flare = 0.4, Lean = 6, Shape = "umbrella",
            Levels = [L(6, 0.4, 68, 0.95, 0.6, -5, 8, 12), L(7, 0.3, 60, 0.55, 0.5, -10, 8)],
            LeafCluster = "cluster", LeafShape = "round", Arrangement = "fan", LeafSize = 0.8, LeafDensity = 0.55, LeafColor = "#556a2a", LeafColor2 = "#a0a840", BarkColor = "#6a5a4a",
        }, "Dry & windswept"),
        new("stylized-acacia", "Stylized acacia", "A chunky umbrella tree with a flat, layered crown.", () => new TreeRecipe
        {
            Name = "Stylized acacia", Archetype = "broadleaf", Style = "stylized", Height = 6, TrunkRadius = 0.35, Taper = 0.55, CrownStart = 0.5, Flare = 0.8, Lean = 8, Twist = 0.3, Collar = 0.9, Shape = "umbrella",
            Levels = [L(5, 0.45, 68, 0.95, 0.6, -5, 8, 12), L(4, 0.35, 60, 0.55, 0.55, -10, 8)],
            Foliage = "tufts", LeafShape = "round", LeafSize = 1.1, LeafDensity = 0.65, LeafColor = "#6a7a2a", LeafColor2 = "#d0cc5a", BarkColor = "#7a5a40", BarkMaterial = "painted", Budget = 3000, Quality = "low",
        }, "Dry & windswept"),

        // ---- Fantasy.
        new("moonlit-elder", "Moonlit elder", "A twisted violet tree with silver bark: the enchanted grove.", () => new TreeRecipe
        {
            Name = "Moonlit elder", Archetype = "broadleaf", Style = "stylized", Height = 9, TrunkRadius = 0.6, Taper = 0.7, CrownStart = 0.4, Flare = 1, Roots = 6, Twist = 1.2, Collar = 1, Shape = "spherical", Lean = 6,
            Levels = [L(5, 0.45, 55, 0.6, 0.6, 25, 10, 15), L(4, 0.3, 45, 0.5, 0.55, 15, 10)],
            Foliage = "tufts", LeafSize = 1.3, LeafDensity = 0.7, LeafColor = "#4a2a7a", LeafColor2 = "#c08ae8", BarkColor = "#8a8098", BarkMaterial = "painted", Budget = 3500, Quality = "low",
        }, "Fantasy"),
        new("ember-oak", "Ember oak", "A fiery autumn oak, flame-red leaves on a dark, twisted trunk.", () => new TreeRecipe
        {
            Name = "Ember oak", Archetype = "broadleaf", Style = "stylized", Height = 8, TrunkRadius = 0.55, Taper = 0.6, CrownStart = 0.4, Flare = 0.9, Roots = 5, Twist = 0.6, Collar = 0.9, Shape = "spherical",
            Levels = [L(5, 0.45, 50, 0.6, 0.65, 25, 10, 12), L(4, 0.3, 40, 0.5, 0.55, 20, 10)],
            Foliage = "tufts", LeafShape = "maple", LeafSize = 1.3, LeafDensity = 0.7, LeafColor = "#8a1a10", LeafColor2 = "#ffb030", BarkColor = "#3e2e28", BarkMaterial = "painted", Budget = 3500, Quality = "low",
        }, "Fantasy"),
        new("spirit-willow", "Spirit willow", "Pale bark and glowing teal curtains: the ghostly marsh willow.", () => new TreeRecipe
        {
            Name = "Spirit willow", Archetype = "broadleaf", Style = "stylized", Height = 9, TrunkRadius = 0.5, Taper = 0.65, CrownStart = 0.4, RootStyle = "surface", Roots = 6, Twist = 0.8, Collar = 0.9, Shape = "hemispherical",
            Levels = [L(6, 0.4, 50, 0.6, 0.6, 25, 8), L(6, 0.25, 40, 0.5, 0.55, -45, 8)],
            LeafShape = "slender", Arrangement = "hanging", HangLength = 5, LeafSize = 0.9, LeafDensity = 0.75, LeafColor = "#1f7a7a", LeafColor2 = "#a8f0dc", BarkColor = "#c8c4b8", BarkMaterial = "painted",
            Moss = 0.3, MossColor = "#8ab8a8", Budget = 3500, Quality = "low",
        }, "Fantasy"),
        new("fly-agaric", "Fly agaric tree", "A giant red toadstool with white spots on a pale, swollen stem.", () => new TreeRecipe
        {
            Name = "Fly agaric tree", Archetype = "broadleaf", Style = "stylized", Height = 6, TrunkRadius = 0.45, Taper = 0.25, CrownStart = 1, RootStyle = "compact", Bulge = 0.45, BulgeAt = 0.05,
            SCurve = 0.05, Lean = 6, Collar = 0.9, Levels = [], Foliage = "none",
            CapWidth = 3.2, CapColor = "#c0281a", Spots = 0.75, SpotColor = "#f4ecd8", BarkColor = "#ece4d0", BarkMaterial = "painted", Budget = 2500, Quality = "low",
        }, "Fantasy"),
        new("glowcap", "Glowcap swamp tree", "A crooked mushroom tree whose teal caps glow in the marsh at night.", () => new TreeRecipe
        {
            Name = "Glowcap swamp tree", Archetype = "broadleaf", Style = "stylized", Height = 7, TrunkRadius = 0.4, Taper = 0.45, CrownStart = 1, RootStyle = "surface", Roots = 5, RootLength = 0.8,
            SCurve = 0.08, Lean = 8, Twist = 0.4, Collar = 0.9,
            Levels = [L(5, 0.5, 60, 0.32, 0.5, 35, 10, 15)], Foliage = "none",
            CapWidth = 2.6, BranchCaps = 0.45, CapColor = "#1f6a78", Spots = 0.5, SpotColor = "#a8f4e4", Glow = 0.6,
            Moss = 0.35, MossColor = "#7a9a84", BarkColor = "#8a7a68", BarkMaterial = "painted", Budget = 3000, Quality = "low",
        }, "Fantasy"),
        new("toadstool", "Giant toadstool (realistic)", "A tall brown-capped mushroom, the size of a small tree.", () => new TreeRecipe
        {
            Name = "Giant toadstool", Archetype = "broadleaf", Height = 4, TrunkRadius = 0.32, Taper = 0.2, CrownStart = 1, RootStyle = "compact", Bulge = 0.3, BulgeAt = 0.05, Lean = 4, SCurve = 0.03,
            Levels = [], Foliage = "none", CapWidth = 2.4, CapColor = "#7a4a28", Spots = 0.1, SpotColor = "#d8c8a8", BarkColor = "#ddd2bc", BarkMaterial = "",
        }, "Fantasy"),
        new("crystal-tree", "Crystal tree", "A faceted tree of grey stone, its branches tipped with glowing cyan crystals.", () => new TreeRecipe
        {
            Name = "Crystal tree", Archetype = "broadleaf", Style = "stylized", Height = 7, TrunkRadius = 0.4, Taper = 0.7, CrownStart = 0.4, Flare = 0.8, Roots = 5, Twist = 0.8, Collar = 0.8, Shape = "spherical",
            Levels = [L(5, 0.4, 50, 0.6, 0.6, 20, 8, 12), L(3, 0.3, 45, 0.5, 0.55, 15, 8)],
            Foliage = "crystals", LeafSize = 0.9, LeafDensity = 0.7, LeafColor = "#3fb8d8", LeafColor2 = "#9ff0ff", Glow = 0.7,
            BarkColor = "#6a6a80", BarkMaterial = "painted", FlatShading = true, Budget = 2500, Quality = "low",
        }, "Fantasy"),
        new("amethyst-tree", "Amethyst tree", "Dark, twisted wood bearing clusters of glowing violet crystals.", () => new TreeRecipe
        {
            Name = "Amethyst tree", Archetype = "dead", Style = "stylized", Height = 6, TrunkRadius = 0.45, Taper = 0.75, CrownStart = 0.45, Flare = 1, Roots = 6, Twist = 1.2, Collar = 1, Shape = "inverse", Lean = 6,
            Levels = [L(5, 0.45, 55, 0.6, 0.6, 10, 15, 20), L(3, 0.3, 50, 0.5, 0.55, 5, 15, 20)],
            Foliage = "crystals", LeafSize = 0.8, LeafDensity = 0.8, LeafColor = "#7a3ad8", LeafColor2 = "#d8a8ff", Glow = 0.55,
            BarkColor = "#3a2e4a", BarkMaterial = "painted", Budget = 3000, Quality = "low",
        }, "Fantasy"),
    ];

    public static TreeRecipe Make(string id) => (All.FirstOrDefault(p => p.Id == id) ?? All[0]).Make().Clamped();
}

/// <summary>Variety packs: many trees of one kind, each from its own seed and a little bigger or smaller.</summary>
public static class TreeVariants
{
    public const int MaxCount = 50;

    /// <summary>
    /// <paramref name="count"/> recipes from one: consecutive seeds, sizes spread by up to ± <paramref name="spread"/>
    /// (0–0.5; the trunk thickens with the height, a little less than in proportion, as real trees do), numbered names.
    /// The first keeps the recipe's own seed and size, so a pack always contains the tree that was on screen.
    /// </summary>
    public static List<TreeRecipe> Make(TreeRecipe recipe, int count, double spread)
    {
        count = Math.Clamp(count, 1, MaxCount);
        spread = double.IsFinite(spread) ? Math.Clamp(spread, 0, 0.5) : 0;
        var list = new List<TreeRecipe>();
        for (var i = 0; i < count; i++)
        {
            var r = recipe.Clone();
            if (count > 1)
            {
                r.Name = $"{recipe.Name} {i + 1:00}";
                if (i > 0)
                {
                    r.Seed = (int)((recipe.Seed + 7919L * i) % int.MaxValue);
                    var scale = 1 + spread * (new Random(r.Seed).NextDouble() * 2 - 1);
                    r.Height = recipe.Height * scale;
                    r.TrunkRadius = recipe.TrunkRadius * Math.Pow(scale, 0.8);
                }
            }
            list.Add(r.Clamped());
        }
        return list;
    }
}
