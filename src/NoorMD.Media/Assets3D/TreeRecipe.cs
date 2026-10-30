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
    public static readonly string[] Archetypes = ["broadleaf", "conifer", "birch", "dead", "cactus"];
    public static readonly string[] Styles = ["realistic", "stylized"];
    public static readonly string[] Shapes = ["spherical", "hemispherical", "conical", "cylindrical", "flame", "inverse", "tapered", "umbrella"];
    public static readonly string[] RootStyles = ["flare", "surface", "prop", "compact"];
    public static readonly string[] Arrangements = ["scatter", "single", "cross", "star", "fan", "dome", "hanging", "fronds", "boughs"];
    public static readonly string[] BranchModes = ["merged", "separate", "mixed"];
    public static readonly string[] FoliageKinds = ["cards", "masses", "tufts", "clumps", "both", "crystals", "none"];
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
    /// outer branch, palm and fern) or "boughs" (a folded needle frond along every limb off the trunk: the tiers of a
    /// low-poly conifer).
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
    /// <summary>
    /// What one card shows: a twig, a spray of three twigs, a dense cluster, or a whole branch (a main stem with side
    /// twigs and many small leaves, darker at the back: the baked branch card of game foliage) (LeafAtlas.Clusters).
    /// </summary>
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
    /// <summary>Cards cut to the outline of their leaves (six corners) instead of rectangles: the same triangles, far fewer see-through pixels to draw.</summary>
    public bool TrimCards { get; set; } = true;
    /// <summary>
    /// How full the crown should look (0–0.98; 0 off): the crown is looked at from its sides and where the sky shows
    /// through, more cards go on the nearest branches, until it is this full or the leaf budget is spent.
    /// </summary>
    public double CanopyFullness { get; set; } = 0.85;
    /// <summary>
    /// Triangles for the whole finest level (0: the wood and leaf budgets as set). A quarter goes to the wood (its finest
    /// twigs, hidden in the leaves anyway, are left out when that is little), the rest to the leaves; each farther level
    /// about half. A forest of hundreds of thousands of trees wants a few thousand; a hero tree tens of thousands.
    /// </summary>
    public int TriangleTarget { get; set; }

    /// <summary>
    /// The least sides the trunk has on the closest level when it is low-poly tubes (0: as round as its thickness asks,
    /// 10 or more). Farther levels, where the leaves hide it, have a simple 6- then 5-sided trunk.
    /// </summary>
    public int TrunkSides { get; set; }

    /// <summary>
    /// Triangles for each level of detail, closest first (empty: the triangle target, or the budgets, each farther level
    /// about half). A game that knows what each distance can afford sets them all, e.g. 2,800 / 1,100 / 220; levels past
    /// the list are half the one before. Each is shared out like the triangle target: a quarter to the wood.
    /// </summary>
    public List<int> LodTriangles { get; set; } = [];

    /// <summary>
    /// Small textures (0 off, or 32, 64 or 128): every map (colour, normal, ORM) this many pixels across, leaves cut
    /// out hard, sampled nearest (crisp pixels, no blur) in every engine: a game drawing its trees with tiny textures.
    /// Small doesn't mean flat: the maps keep all their colours and the full PBR set.
    /// </summary>
    public int Pixels { get; set; }
    /// <summary>With small textures: the colours reduced to this many (a pixel-art palette), or 0 to keep them all.</summary>
    public int PixelColours { get; set; }
    public static readonly int[] PixelSizes = [0, 32, 64, 128];
    /// <summary>Sharp pixels: every texture sampled nearest (no blur between pixels), whatever its size. Pixel art always is.</summary>
    public bool SharpPixels { get; set; }

    /// <summary>The game this tree is made for (GameProfiles: its manifest names and hand-off note), or empty for any.</summary>
    public string Profile { get; set; } = "";

    /// <summary>The wood and leaf budgets this recipe builds with (from the triangle target when there is one).</summary>
    public (int Wood, int Leaves) Budgets()
    {
        var target = LodTriangles.Count > 0 ? LodTriangles[0] : TriangleTarget;
        if (target <= 0) return (Budget, LeafBudget);
        var leafy = Foliage != "none" && Archetype is not ("dead" or "cactus");
        var wood = Math.Max(200, (int)(target * (leafy ? 0.25 : 1)));
        return (wood, Math.Max(500, target - wood));
    }

    /// <summary>
    /// The wood and leaf triangles of one level (0 closest). With triangles set per level, from those (no floor: a far
    /// level of 200 triangles is a trunk and a few big cards); otherwise half the level before.
    /// </summary>
    public (int Wood, int Leaves) LevelBudgets(int lod)
    {
        var (wood, leaves) = Budgets();
        if (LodTriangles.Count == 0 || lod == 0) return (wood >> lod, leaves >> lod);
        var total = lod < LodTriangles.Count ? LodTriangles[lod] : LodTriangles[^1] >> (lod - LodTriangles.Count + 1);
        var leafy = Foliage != "none" && Archetype is not ("dead" or "cactus");
        var w = leafy ? Math.Max(30, total / 4) : total;
        return (w, Math.Max(leafy ? 40 : 0, total - w));
    }

    // Bark.
    public string BarkColor { get; set; } = "#5a4636";
    /// <summary>
    /// The bark: "bark" (realistic furrows in the bark colour), "painted" (hand-painted grooves, the stylized look),
    /// "birch" (pale with dark marks), any NoorMaterial preset id, or empty for a plain colour.
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
        CanopyFullness = C(CanopyFullness, 0, 0.98, 0.85);
        TriangleTarget = TriangleTarget <= 0 ? 0 : Math.Clamp(TriangleTarget, 1000, 200_000);
        TrunkSides = TrunkSides <= 0 ? 0 : Math.Clamp(TrunkSides, 3, 32);
        LodTriangles = (LodTriangles ?? []).Take(6).Select(t => Math.Clamp(t, 60, 200_000)).ToList();
        Pixels = PixelSizes.Contains(Pixels) ? Pixels : 0;
        PixelColours = PixelColours <= 0 ? 0 : Math.Clamp(PixelColours, 4, 64);
        Profile = GameProfiles.Find(Profile) != null ? Profile : "";
        BarkColor = Hex(BarkColor, "#5a4636");
        BarkMaterial = BarkMaterial is { Length: <= 60 } && BarkMaterial.All(c => char.IsAsciiLetterOrDigit(c) || c == '-') ? BarkMaterial : "";
        BarkTile = C(BarkTile, 0.05, 20, 1);
        return this;
    }
}

/// <summary>Ready-made starting points: the four archetypes in both looks.</summary>
public static class TreePresets
{
    /// <param name="Group">Where it grows, for the list: Forest, Swamp &amp; marsh, Giants, Tropical, Dry &amp; windswept, Desert, Fantasy.</param>
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
            Foliage = "masses", LeafCluster = "cluster", LeafShape = "broad", LeafSize = 0.9, LeafDensity = 0.65, LeafColor = "#3f6b26", LeafColor2 = "#7a9a33",
        }),
        new("pine", "Pine (realistic)", "A tall conifer with whorls of near-level branches and needle cards.", () => new TreeRecipe
        {
            Name = "Pine", Archetype = "conifer", Height = 16, TrunkRadius = 0.25, Taper = 0.95, CrownStart = 1, Flare = 0.35, Roots = 4, Shape = "conical", Lean = 1, Wobble = 2,
            Levels = [new() { Count = 42, Start = 0.25, Angle = 85, AngleSpread = 8, Length = 0.16, Radius = 0.35, Bend = -10, Wobble = 5, Whorl = 6, Spiral = 36 },
                      new() { Count = 10, Start = 0.1, Angle = 55, Length = 0.45, Radius = 0.5, Bend = 5, Wobble = 6 }],
            LeafCluster = "spray", LeafShape = "needle", LeafSize = 0.7, LeafDensity = 0.85, LeafColor = "#2c4a26", LeafColor2 = "#4d6b30", BarkColor = "#5b4130",
        }),
        new("birch", "Birch (realistic)", "A slender white trunk and fine, drooping branches.", () => new TreeRecipe
        {
            Name = "Birch", Archetype = "birch", Height = 11, TrunkRadius = 0.16, Taper = 0.9, CrownStart = 0.9, Flare = 0.25, Roots = 4, Shape = "flame", Lean = 4,
            Levels = [new() { Count = 22, Start = 0.3, Angle = 40, Length = 0.38, Radius = 0.45, Bend = -25, Wobble = 8 },
                      new() { Count = 10, Start = 0.15, Angle = 35, Length = 0.5, Radius = 0.5, Bend = -40, Wobble = 10 }],
            Foliage = "masses", LeafCluster = "cluster", LeafShape = "round", LeafSize = 0.5, LeafDensity = 0.55, LeafColor = "#5d8a2e", LeafColor2 = "#a6b83d", BarkColor = "#e2ddd2", BarkMaterial = "birch",
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
            Levels = [new() { Count = 42, Start = 0.22, Angle = 80, Length = 0.25, Radius = 0.4, Bend = -15, Wobble = 4, Whorl = 6, Spiral = 30 }],
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
            Name = "Spruce", Archetype = "conifer", Height = 18, TrunkRadius = 0.28, Taper = 0.95, CrownStart = 1, Flare = 0.4, Roots = 5, Shape = "conical", Lean = 1, Wobble = 2,
            Levels = [L(50, 0.15, 95, 0.15, 0.32, -20, 4, 8, 5, 45), L(8, 0.15, 55, 0.45, 0.5, 0, 5)],
            LeafCluster = "spray", LeafShape = "needle", Arrangement = "fan", LeafSize = 0.75, LeafDensity = 0.7, LeafColor = "#1f3d24", LeafColor2 = "#3e5f2c", BarkColor = "#4d3a2e",
        }),
        new("maple", "Autumn maple (realistic)", "A round crown of maple leaves in autumn reds and oranges.", () => new TreeRecipe
        {
            Name = "Autumn maple", Archetype = "broadleaf", Height = 11, TrunkRadius = 0.3, Taper = 0.7, CrownStart = 0.35, Flare = 0.45, Shape = "spherical",
            Levels = [L(7, 0.35, 45, 0.6, 0.6, 15, 10), L(8, 0.15, 45, 0.5, 0.5, 5, 10), L(5, 0.2, 50, 0.4, 0.5, 0, 12)],
            Foliage = "masses", LeafCluster = "cluster", LeafShape = "maple", Arrangement = "dome", LeafSize = 0.7, LeafDensity = 0.6, LeafColor = "#a3301a", LeafColor2 = "#f0a028", BarkColor = "#5a4a40",
        }),

        new("italian-cypress", "Italian cypress (realistic)", "A tall, dark, narrow flame of a tree.", () => new TreeRecipe
        {
            Name = "Italian cypress", Archetype = "conifer", Height = 13, TrunkRadius = 0.25, Taper = 0.95, CrownStart = 1, Flare = 0.3, Roots = 4, Shape = "flame", Lean = 1, Wobble = 2,
            Levels = [L(70, 0.05, 18, 0.07, 0.4, 8, 6, 8)],
            LeafCluster = "cluster", LeafShape = "needle", LeafSize = 0.8, LeafDensity = 0.9, LeafColor = "#2b4426", LeafColor2 = "#4c6a32", BarkColor = "#5a4636",
        }),
        new("cherry", "Cherry blossom (realistic)", "A round crown in spring pink.", () => new TreeRecipe
        {
            Name = "Cherry", Archetype = "broadleaf", Height = 7, TrunkRadius = 0.24, Taper = 0.7, CrownStart = 0.35, Flare = 0.45, Shape = "spherical", Lean = 4,
            Levels = [L(7, 0.35, 50, 0.65, 0.6, 12, 12), L(8, 0.15, 45, 0.5, 0.5, 5, 10), L(5, 0.2, 50, 0.4, 0.5, 0, 12)],
            Foliage = "masses", LeafCluster = "cluster", LeafShape = "round", LeafSize = 0.6, LeafDensity = 0.6, LeafColor = "#e7a2bd", LeafColor2 = "#f8d6e4", BarkColor = "#4a3a3a",
        }),

        // ---- Swamp and marsh.
        new("cypress", "Bald cypress (realistic)", "A swamp giant: fluted, flared base, knees rising from the water, a flat crown hung with moss.", () => new TreeRecipe
        {
            Name = "Bald cypress", Archetype = "broadleaf", Height = 18, TrunkRadius = 0.7, Taper = 0.85, CrownStart = 0.5, Flare = 0.9, Roots = 7, Collar = 0.7, Shape = "umbrella",
            Flute = 0.8, FluteLobes = 9, FluteHeight = 0.25, Knees = 14,
            Levels = [L(12, 0.45, 70, 0.45, 0.45, -10, 12, 15), L(7, 0.15, 50, 0.5, 0.5, 0, 10)],
            LeafCluster = "spray", LeafShape = "needle", Arrangement = "fan", LeafSize = 0.8, LeafDensity = 0.55, LeafColor = "#3d5a2a", LeafColor2 = "#6f8a3c", BarkColor = "#6b5848",
            Moss = 0.7, Budget = 12000, TriangleTarget = 8000,
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
            // Limbs arching up and out, twigs drooping from them: the broad dome the curtains fall from.
            Levels = [L(8, 0.4, 50, 0.75, 0.6, -25, 10), L(10, 0.25, 55, 0.45, 0.5, -60, 8, 15)],
            LeafShape = "slender", LeafCluster = "cluster", Arrangement = "hanging", HangLength = 7, LeafSize = 0.7, LeafDensity = 0.5, LeafColor = "#6d8a2c", LeafColor2 = "#b2c24a", BarkColor = "#5a4c3e",
        }, "Swamp & marsh"),
        new("stylized-willow", "Stylized willow", "A chunky twisted willow under swaying curtains.", () => new TreeRecipe
        {
            Name = "Stylized willow", Archetype = "broadleaf", Style = "stylized", Height = 8, TrunkRadius = 0.55, Taper = 0.65, CrownStart = 0.4, RootStyle = "surface", Roots = 5, Shape = "hemispherical", Twist = 0.5, Collar = 0.9,
            Levels = [L(6, 0.4, 50, 0.6, 0.6, 25, 8), L(6, 0.25, 40, 0.5, 0.55, -45, 8)],
            LeafShape = "slender", LeafCluster = "cluster", Arrangement = "hanging", HangLength = 4, LeafSize = 0.9, LeafDensity = 0.75, LeafColor = "#4f8a2a", LeafColor2 = "#c4dc5a", BarkColor = "#6e5440", BarkMaterial = "painted", Budget = 3500, Quality = "low",
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
            Levels = [L(55, 0.45, 80, 0.15, 0.22, -20, 8), L(7, 0.15, 50, 0.55, 0.5, 10, 8)],
            LeafCluster = "spray", LeafShape = "needle", Arrangement = "fan", LeafSize = 2.6, LeafDensity = 0.8, LeafColor = "#2c4a26", LeafColor2 = "#55702f", BarkColor = "#8a4a2c", BarkTile = 3, Budget = 20000, TriangleTarget = 8000,
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

        new("jungle-tree", "Jungle giant (realistic)", "A tall, straight trunk on buttress roots under a wide, flat-topped crown.", () => new TreeRecipe
        {
            Name = "Jungle tree", Archetype = "broadleaf", Height = 20, TrunkRadius = 0.55, Taper = 0.6, CrownStart = 0.7, Shape = "umbrella", Lean = 1, Flare = 1, Roots = 7,
            Flute = 0.6, FluteLobes = 6, FluteHeight = 0.15,
            Levels = [L(8, 0.72, 75, 0.4, 0.55, -5, 6, 8), L(6, 0.3, 60, 0.45, 0.5, 15, 10, 15)],
            Foliage = "masses", LeafCluster = "cluster", LeafShape = "broad", LeafSize = 1.1, LeafDensity = 0.65, LeafColor = "#2f5a22", LeafColor2 = "#5f8a2e", BarkColor = "#7a6e5c",
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

        new("dry-shrub", "Dry shrub (realistic)", "A low, twiggy bush of small grey-olive leaves, for dry ground.", () => new TreeRecipe
        {
            Name = "Dry shrub", Archetype = "broadleaf", Height = 1.6, TrunkRadius = 0.06, Taper = 0.8, CrownStart = 0.05, Shape = "hemispherical", Flare = 0, Roots = 0, Lean = 4,
            Levels = [L(9, 0.02, 38, 0.85, 0.6, 12, 20, 15), L(5, 0.2, 40, 0.5, 0.5, 5, 20, 15)],
            LeafShape = "round", LeafSize = 0.25, LeafDensity = 0.4, LeafColor = "#7a7a52", LeafColor2 = "#a8a070", BarkColor = "#6a5e50", CanopyFullness = 0.5,
        }, "Dry & windswept"),

        // ---- Desert: cactuses (ribbed, no leaves, no wind) and the Joshua tree.
        new("saguaro", "Saguaro cactus", "A tall ribbed column whose arms turn up like a candelabra.", () => new TreeRecipe
        {
            Name = "Saguaro", Archetype = "cactus", Height = 8, TrunkRadius = 0.34, Taper = 0.1, CrownStart = 1, RootStyle = "compact", Roots = 0, Flare = 0, Lean = 1, Wobble = 2, Shape = "cylindrical",
            Flute = 0.8, FluteLobes = 12, FluteHeight = 1,
            Levels = [L(3, 0.3, 90, 0.36, 0.8, 100, 3, 5)],
            Foliage = "none", BarkColor = "#5f7f3a", BarkMaterial = "cactus", BarkTile = 0.6, Wind = false, Shading = 0.3,
        }, "Desert"),
        new("organ-pipe", "Organ pipe cactus", "A clump of ribbed columns rising from a short base.", () => new TreeRecipe
        {
            Name = "Organ pipe", Archetype = "cactus", Height = 5, TrunkRadius = 0.2, Taper = 0.1, CrownStart = 0.05, RootStyle = "compact", Roots = 0, Flare = 0, Lean = 0, Wobble = 3, Shape = "cylindrical",
            Flute = 0.8, FluteLobes = 9, FluteHeight = 1,
            Levels = [L(9, 0.02, 25, 0.9, 0.9, 15, 4, 10)],
            Foliage = "none", BarkColor = "#6a8a40", BarkMaterial = "cactus", BarkTile = 0.6, Wind = false, Shading = 0.3,
        }, "Desert"),
        new("barrel-cactus", "Barrel cactus", "A squat, deeply ribbed barrel.", () => new TreeRecipe
        {
            Name = "Barrel cactus", Archetype = "cactus", Height = 1.1, TrunkRadius = 0.36, Taper = 0.15, Bulge = 0.15, BulgeAt = 0.5, CrownStart = 1, RootStyle = "compact", Roots = 0, Flare = 0, Lean = 4, Wobble = 2,
            Flute = 0.6, FluteLobes = 12, FluteHeight = 1,
            Levels = [],
            Foliage = "none", BarkColor = "#6a8a3a", BarkMaterial = "cactus", BarkTile = 0.4, Wind = false, Shading = 0.3,
        }, "Desert"),
        new("joshua-tree", "Joshua tree", "Forking, shaggy branches tipped with spiky leaf tufts.", () => new TreeRecipe
        {
            Name = "Joshua tree", Archetype = "broadleaf", Height = 6, TrunkRadius = 0.28, Taper = 0.5, CrownStart = 0.4, Flare = 0.4, Shape = "spherical", Lean = 4,
            Levels = [L(5, 0.3, 45, 0.5, 0.65, 15, 18, 15), L(3, 0.4, 40, 0.5, 0.7, 20, 15, 15)],
            Foliage = "tufts", LeafShape = "slender", LeafCluster = "spray", LeafSize = 0.7, LeafDensity = 0.8, OuterLeaves = 1, CanopyFullness = 0,
            LeafColor = "#5e6e3a", LeafColor2 = "#9aa05a", BarkColor = "#6b5e4e",
        }, "Desert"),

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
            LeafShape = "slender", LeafCluster = "cluster", Arrangement = "hanging", HangLength = 5, LeafSize = 0.9, LeafDensity = 0.75, LeafColor = "#1f7a7a", LeafColor2 = "#a8f0dc", BarkColor = "#c8c4b8", BarkMaterial = "painted",
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

    public static TreeRecipe Make(string id) => (All.Concat(Thornwake).FirstOrDefault(p => p.Id == id) ?? All[0]).Make().Clamped();

    /// <summary>
    /// A tree for a game (GameProfiles): another preset grown at the game's size, triangles per level and texture look,
    /// under the name the game's catalogue knows the species by.
    /// </summary>
    private static Preset ForGame(string profile, string id, string from, string name, string description, double height, int[] triangles, Action<TreeRecipe>? change = null) =>
        new($"{profile}-{id}", name.Replace('_', ' '), description, () =>
        {
            var r = All.First(p => p.Id == from).Make();
            var scale = height / r.Height;
            r.Name = name;
            r.Height = height;
            r.TrunkRadius *= Math.Pow(scale, 0.8);
            r.Profile = profile;
            r.LodTriangles = [.. triangles];
            r.Lods = triangles.Length;
            r.TriangleTarget = 0;
            r.Billboard = false;
            r.Pixels = 64;          // the game's texture size, full colour and full PBR, sampled sharp
            r.Quality = "low";
            r.Seed = 101;
            r.Shading = 0.45;       // the pack's trees are lit by the game, not painted dark underneath
            change?.Invoke(r);
            return r;
        }, GameProfiles.Find(profile)!.Group);

    /// <summary>Low-poly conifer tiers: needle boughs on the limbs, no twigs (they would only be dropped at these budgets).</summary>
    private static void Boughs(TreeRecipe r)
    {
        r.Levels = [r.Levels[0]];
        r.Arrangement = "boughs";
        r.CanopyFullness = 0;
        r.LeafSize = 1;
        r.Shading = 0.3;
        r.TrunkRadius = Math.Max(r.TrunkRadius, r.Height * 0.022);
    }

    /// <summary>
    /// Thornwake's woodland (its pack's nine species, at their heights and triangles per level) and the species it draws
    /// as placeholders today (its docs/ASSET_SPEC.md).
    /// </summary>
    public static readonly IReadOnlyList<Preset> Thornwake =
    [
        // The pack's nine species.
        ForGame("thornwake", "pine", "pine", "Pine", "Irregular tiers on an exposed lower trunk, an open top.", 12.5, [2800, 1100, 220], r => { Boughs(r); r.Levels[0].Count = 36; r.Levels[0].Start = 0.3; r.Levels[0].Length = 0.24; }),
        ForGame("thornwake", "spruce", "spruce", "Spruce", "A dense, dark, low-reaching cone of needles.", 12.5, [4000, 1600, 280], r => { Boughs(r); r.Levels[0].Count = 48; r.Levels[0].Start = 0.12; r.Levels[0].Length = 0.26; r.LeafColor = "#28492a"; r.LeafColor2 = "#4b6e34"; }),
        ForGame("thornwake", "birch-green", "birch", "Birch_Green", "A slender pale trunk with small rising branches and loose leaf sprays.", 11.5, [2600, 1300, 500]),
        ForGame("thornwake", "birch-autumn", "birch", "Birch_Autumn", "The birch in yellow and ochre.", 11, [2600, 1300, 500], r => { r.LeafColor = "#c08a1e"; r.LeafColor2 = "#ecc848"; }),
        ForGame("thornwake", "oak", "oak", "Oak", "A broad crown of leaf masses on a heavy trunk with big limbs.", 10.5, [3600, 1800, 600], Puffy),
        ForGame("thornwake", "maple-autumn", "maple", "Maple_Autumn", "A broad, branching crown in copper and orange.", 10.8, [3600, 1800, 600], r => { Puffy(r); r.Levels[0].Length = 0.75; r.Levels[0].Angle = 58; r.Shape = "hemispherical"; }),
        ForGame("thornwake", "sparse", "oak", "Sparse", "A crooked trunk, open branches and grey-green leaf groups.", 8.7, [1500, 800, 300], r =>
        {
            r.Lean = 10; r.Wobble = 12; r.Shape = "spherical"; r.LeafDensity = 0.35; r.CanopyFullness = 0;
            r.LeafColor = "#5c6b4a"; r.LeafColor2 = "#94a07a"; r.BarkColor = "#6a5d50";
        }),
        ForGame("thornwake", "poplar", "birch", "Poplar", "Tall, with a narrow upright crown.", 16.7, [2200, 1100, 450], r =>
        {
            r.Archetype = "broadleaf"; r.Shape = "cylindrical"; r.CrownStart = 0.25; r.Lean = 1; r.BarkMaterial = "bark"; r.BarkColor = "#7a7468";
            r.Levels[0].Angle = 22; r.Levels[0].Bend = 10; r.Levels[0].Length = 0.22; r.Levels[1].Angle = 25; r.Levels[1].Bend = 5;
            r.LeafColor = "#4e7a2a"; r.LeafColor2 = "#90ac3c";
        }),
        ForGame("thornwake", "willow", "willow", "Willow", "A broad arching frame under hanging curtains.", 9, [4500, 2300, 600]),

        // More of the woodland.
        ForGame("thornwake", "larch", "spruce", "Larch", "A conifer gone gold in autumn.", 12, [3600, 1500, 260], r => { Boughs(r); r.Levels[0].Count = 40; r.Levels[0].Start = 0.2; r.Levels[0].Length = 0.26; r.LeafColor = "#b8892a"; r.LeafColor2 = "#e6c24e"; }),
        ForGame("thornwake", "cherry", "cherry", "Cherry", "A round crown in spring pink.", 7, [3200, 1600, 500]),
        ForGame("thornwake", "italian-cypress", "italian-cypress", "Italian_Cypress", "A tall, dark, narrow flame (the game's \"cypress\" placeholder).", 13, [2400, 1100, 300]),

        // The species the game draws as placeholders today, and the desert.
        ForGame("thornwake", "palm", "palm", "Palm", "A slim curving trunk under drooping fronds.", 9, [1600, 800, 250]),
        ForGame("thornwake", "acacia", "acacia", "Acacia", "A flat umbrella crown for the savanna.", 7, [2400, 1200, 400]),
        ForGame("thornwake", "jungle-tree", "jungle-tree", "Jungle_Tree", "A tall trunk on buttress roots under a wide, flat crown.", 20, [4000, 1800, 600]),
        ForGame("thornwake", "baobab", "baobab", "Baobab", "A swollen bottle trunk with a small, flat crown.", 9, [2400, 1200, 400]),
        ForGame("thornwake", "dead", "dead", "Dead_Tree", "Bare and broken.", 7, [900, 450, 150]),
        ForGame("thornwake", "dry-shrub", "dry-shrub", "Dry_Shrub", "A low, faceted bush of grey-olive leaf clumps.", 1.4, [900, 450, 150], r =>
        {
            // Solid leaf clumps: a whole bush in a few hundred triangles.
            r.Foliage = "clumps"; r.LeafSize = 0.35; r.CrownStart = 0.02;
            r.Levels = [L(12, 0, 45, 0.9, 0.7, 15, 20, 15), L(4, 0.3, 40, 0.45, 0.5, 5, 20, 15)];
        }),
        ForGame("thornwake", "bald-cypress", "cypress", "Bald_Cypress", "The swamp tree: fluted base, knees and moss.", 14, [4000, 1800, 500], r => { Puffy(r); r.Knees = 8; r.Budget = 8000; r.LeafSize = 1; r.LeafDensity = 0.7; }),
        ForGame("thornwake", "mangrove", "mangrove", "Mangrove", "Stilt roots arching out of the water under a low dome.", 6, [3000, 1500, 500]),
        ForGame("thornwake", "saguaro", "saguaro", "Saguaro", "A tall ribbed cactus whose arms turn up.", 8, [1500, 700, 250], r => r.FluteLobes = 8),
        ForGame("thornwake", "organ-pipe", "organ-pipe", "Organ_Pipe", "A clump of ribbed cactus columns.", 5, [2200, 900, 300], r => r.FluteLobes = 7),
        ForGame("thornwake", "barrel-cactus", "barrel-cactus", "Barrel_Cactus", "A squat, deeply ribbed barrel.", 1.1, [500, 250, 100], r => r.FluteLobes = 10),
        ForGame("thornwake", "joshua-tree", "joshua-tree", "Joshua_Tree", "Forking branches tipped with spiky leaf tufts.", 6, [2400, 1200, 400]),
    ];

    /// <summary>Broadleaf crowns as leaf masses (cards spread over the crown's shape), full like the pack's oaks.</summary>
    private static void Puffy(TreeRecipe r) => r.Foliage = "masses";

    /// <summary>Every preset: the general ones, then each game's.</summary>
    public static IEnumerable<Preset> Everything => All.Concat(Thornwake);
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
