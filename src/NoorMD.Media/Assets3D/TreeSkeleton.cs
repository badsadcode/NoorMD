using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>A branch of the skeleton: a curve of points with a radius at each, growing from a point on its parent.</summary>
public sealed class TreeBranch
{
    public int Id { get; init; }
    /// <summary>The branch it grows from (-1 for the trunk), and where along it (0–1).</summary>
    public int Parent { get; init; } = -1;
    public float ParentT { get; init; }
    /// <summary>0 the trunk and roots, 1 limbs on the trunk, 2 branches on those, ...</summary>
    public int Level { get; init; }
    /// <summary>What it is: "trunk", "branch", "root", "prop" (a mangrove stilt), "ridge" (a flute ridge up the trunk),
    /// "knee" (a cypress knee) or "vine" (hanging, bare).</summary>
    public string Kind { get; init; } = "branch";
    /// <summary>Part of the trunk's base (roots, stilts, ridges, knees): welded to the trunk, never leafy.</summary>
    public bool Root => Kind is "root" or "prop" or "ridge" or "knee";
    /// <summary>No leaves and no branches on it (vines).</summary>
    public bool Bare => Kind == "vine";
    public List<Vector3> Points { get; } = [];
    public List<float> Radii { get; } = [];
    /// <summary>A direction across the branch at each point, carried along without twisting (for UVs and cards).</summary>
    public List<Vector3> Normals { get; } = [];
    /// <summary>Distance along the branch at each point.</summary>
    public List<float> Distance { get; } = [];
    /// <summary>Wind phase (0–1), shared by a limb and everything growing on it.</summary>
    public float Phase { get; set; }
    /// <summary>How much the wind bends this branch where it starts (0 on the trunk, rising outwards).</summary>
    public float BendAtBase { get; set; }
    public List<int> Children { get; } = [];

    public float Length => Distance.Count > 0 ? Distance[^1] : 0;
    public float BaseRadius => Radii.Count > 0 ? Radii[0] : 0;

    /// <summary>Position, radius and direction at a share t (0–1) of the length.</summary>
    public (Vector3 P, float R, Vector3 Dir) At(float t)
    {
        var d = Math.Clamp(t, 0, 1) * Length;
        for (var i = 0; i + 1 < Points.Count; i++)
        {
            if (d > Distance[i + 1] && i + 2 < Points.Count) continue;
            var seg = Distance[i + 1] - Distance[i];
            var f = seg > 1e-6f ? Math.Clamp((d - Distance[i]) / seg, 0, 1) : 0;
            var dir = Points[i + 1] - Points[i];
            return (Vector3.Lerp(Points[i], Points[i + 1], f), Radii[i] + (Radii[i + 1] - Radii[i]) * f, dir.LengthSquared() > 1e-12f ? Vector3.Normalize(dir) : Vector3.UnitY);
        }
        return (Points[0], Radii[0], Vector3.UnitY);
    }

    internal void Finish()
    {
        Distance.Clear();
        Normals.Clear();
        float d = 0;
        for (var i = 0; i < Points.Count; i++)
        {
            if (i > 0) d += Vector3.Distance(Points[i - 1], Points[i]);
            Distance.Add(d);
        }
        // Parallel transport: start with any direction across the branch, then turn it only as much as the branch turns.
        var t0 = Tangent(0);
        var n = Vector3.Cross(t0, MathF.Abs(t0.Y) < 0.9f ? Vector3.UnitY : Vector3.UnitX);
        n = Vector3.Normalize(n);
        for (var i = 0; i < Points.Count; i++)
        {
            var t = Tangent(i);
            n = Vector3.Normalize(n - t * Vector3.Dot(n, t));
            Normals.Add(n);
        }
    }

    public Vector3 Tangent(int i)
    {
        var a = Points[Math.Max(0, i - 1)];
        var b = Points[Math.Min(Points.Count - 1, i + 1)];
        var d = b - a;
        return d.LengthSquared() > 1e-12f ? Vector3.Normalize(d) : Vector3.UnitY;
    }
}

/// <summary>
/// The branch graph of a tree, grown from a recipe: a trunk (with roots), then each level of branches on the one
/// below, placed and shaped by the level's settings and the crown shape. Everything else (the surface, UVs, leaves,
/// wind data, levels of detail) is made from it.
/// </summary>
public sealed class TreeSkeleton
{
    public List<TreeBranch> Branches { get; } = [];
    public float Height { get; private set; }
    /// <summary>The middle of the crown (for leaf normals that point out of it) and its rough radius.</summary>
    public Vector3 CrownCentre { get; private set; }
    public float CrownRadius { get; private set; }

    public TreeBranch Trunk => Branches[0];

    public static TreeSkeleton Grow(TreeRecipe recipe)
    {
        recipe = recipe.Clone();
        var sk = new TreeSkeleton();
        var rng = new Random(recipe.Seed);
        var stylized = recipe.Style == "stylized";
        var dead = recipe.Archetype == "dead";
        var cactus = recipe.Archetype == "cactus";
        var leader = recipe.CrownStart >= 0.999 || recipe.Archetype is "conifer" or "birch";

        // Trunk. A tree with a crown that splits stops its trunk a little above where the limbs begin.
        var trunkLength = (float)(leader ? recipe.Height : recipe.Height * Math.Min(1, recipe.CrownStart + 0.3));
        var trunkTip = (float)(leader ? Math.Max(0.02, 1 - recipe.Taper) : Math.Max(0.15, 1 - recipe.Taper));
        var trunk = new TreeBranch { Id = 0, Level = 0, Kind = "trunk" };
        var leanAxis = Vector3.Transform(Vector3.UnitX, Quaternion.CreateFromAxisAngle(Vector3.UnitY, (float)(rng.NextDouble() * Math.Tau)));
        // The prevailing wind of a windswept tree: the trunk leans with it and the branches stream after it.
        var windDir = Vector3.Normalize(Vector3.Cross(Vector3.UnitY, leanAxis));
        var lean = (float)Math.Max(recipe.Lean, recipe.Windswept * 22);
        var trunkSegments = stylized ? 14 : 18;
        GrowCurve(trunk, Vector3.Zero, Vector3.UnitY, trunkLength, (float)recipe.TrunkRadius, trunkTip, trunkSegments,
            bendDegrees: 0, wobbleDegrees: (float)recipe.Wobble, rng,
            lean: (lean, Vector3.Normalize(Vector3.Cross(Vector3.UnitY, windDir))), twistTurns: (float)recipe.Twist, twistRadius: (float)recipe.TrunkRadius * 1.2f,
            taperPower: stylized ? 1.5f : 1f);
        ShapeTrunk(trunk, recipe, rng);
        sk.Branches.Add(trunk);

        if (recipe.Flute > 0) AddFluteRidges(sk, trunk, recipe);
        if (recipe.RootStyle == "surface" && recipe.Roots > 0) AddSurfaceRoots(sk, trunk, recipe, rng);
        if (recipe.RootStyle == "prop" && recipe.Roots > 0) AddPropRoots(sk, trunk, recipe, rng);
        if (recipe.Knees > 0) AddKnees(sk, recipe, rng);

        // Roots: short, thick and sinking, melted into the base for the flare.
        if (recipe.RootStyle == "flare" && recipe.Flare > 0 && recipe.Roots > 0)
        {
            var start = (float)(rng.NextDouble() * Math.Tau);
            for (var r = 0; r < recipe.Roots; r++)
            {
                var az = start + r * MathF.Tau / recipe.Roots + (float)(rng.NextDouble() - 0.5) * 0.6f;
                var outward = new Vector3(MathF.Cos(az), 0, MathF.Sin(az));
                var dir = Vector3.Normalize(outward * 0.85f - Vector3.UnitY * 0.5f);
                var root = new TreeBranch { Id = sk.Branches.Count, Parent = 0, ParentT = 0, Level = 0, Kind = "root" };
                var len = (float)(recipe.TrunkRadius * (1.6 + 2.2 * recipe.Flare) * (0.75 + 0.5 * rng.NextDouble()));
                var baseR = (float)(recipe.TrunkRadius * (0.38 + 0.25 * recipe.Flare));
                // From where the trunk is at that height (an S-curve or lean moves it off the origin).
                var (at, _, _) = trunk.At(MathF.Min(0.2f, (float)(recipe.TrunkRadius * 0.9 / recipe.Height)));
                GrowCurve(root, at + outward * (float)recipe.TrunkRadius * 0.3f, dir, len, baseR, 0.25f, 5,
                    bendDegrees: -15, wobbleDegrees: 10, rng);
                sk.Branches.Add(root);
                trunk.Children.Add(root.Id);
            }
        }

        // Branch levels.
        var parents = new List<int> { 0 };
        for (var level = 1; level <= recipe.Levels.Count; level++)
        {
            var L = recipe.Levels[level - 1];
            var next = new List<int>();
            foreach (var pid in parents)
            {
                var parent = sk.Branches[pid];
                if (parent.Length < 1e-3f || L.Count == 0) continue;
                // Fewer children on short parents (deeper levels), at least one where there is room.
                var count = level == 1 ? L.Count : Math.Max(1, (int)Math.Round(L.Count * Math.Clamp(parent.Length / Math.Max(1e-3f, sk.Trunk.Length * (float)recipe.Levels[0].Length), 0.3f, 1.2f)));
                var whorl = Math.Max(1, L.Whorl);
                var rings = Math.Max(1, (int)Math.Ceiling(count / (double)whorl));
                var azimuth = (float)(rng.NextDouble() * 360);
                var made = 0;
                for (var ring = 0; ring < rings && made < count; ring++)
                {
                    // A cactus's arms keep below its crown, so its top stands clear.
                    var armsTop = cactus && level == 1 ? MathF.Max((float)L.Start + 0.05f, 0.75f) : 1f;
                    var tRing = (float)(L.Start + (armsTop - L.Start) * (ring + 0.5 + (rng.NextDouble() - 0.5) * 0.6) / rings);
                    // Leave the very tip of the trunk alone on a single-leader tree.
                    tRing = Math.Clamp(tRing, (float)L.Start, MathF.Max((float)L.Start, level == 1 && leader ? 0.95f : 0.97f));
                    for (var w = 0; w < whorl && made < count; w++, made++)
                    {
                        var t = tRing;
                        var (p, pr, pdir) = parent.At(t);
                        azimuth += whorl > 1 ? 360f / whorl : (float)L.Spiral;
                        var az = (azimuth + (float)((rng.NextDouble() - 0.5) * 20)) * MathF.PI / 180;
                        // A direction across the parent at this azimuth.
                        var across = Vector3.Cross(pdir, MathF.Abs(pdir.Y) < 0.95f ? Vector3.UnitY : Vector3.UnitX);
                        across = Vector3.Normalize(Vector3.Transform(Vector3.Normalize(across), Quaternion.CreateFromAxisAngle(pdir, az + (float)recipe.Twist * t * MathF.Tau)));
                        var angle = (float)((L.Angle + (rng.NextDouble() * 2 - 1) * L.AngleSpread) * Math.PI / 180);
                        // Limbs near the top of a crown point more upwards.
                        if (level == 1 && !leader && recipe.Shape != "umbrella") angle *= 1 - 0.35f * t;
                        var dir = Vector3.Normalize(pdir * MathF.Cos(angle) + across * MathF.Sin(angle));
                        // Windswept: every branch streams the same way.
                        if (recipe.Windswept > 0)
                            dir = Vector3.Normalize(Vector3.Lerp(dir, Vector3.Normalize(windDir + Vector3.UnitY * 0.2f), (float)recipe.Windswept * 0.75f));

                        // Where in the crown (0 its bottom … 1 its top); a crown all at the very top (palms) counts as its middle.
                        var crownT = 1 - L.Start < 0.1 ? 0.5f : Math.Clamp((t - (float)L.Start) / (1 - (float)L.Start), 0, 1);
                        var shape = level == 1 ? ShapeRatio(recipe.Shape, crownT) : 1 - 0.5f * t;
                        var length = parent.Length * (float)L.Length * shape * (float)(1 + (rng.NextDouble() * 2 - 1) * L.LengthSpread);
                        if (level == 1 && leader) length = Math.Min(length, (float)recipe.Height * 0.6f);
                        if (dead && rng.NextDouble() < 0.35) length *= 0.4f + 0.4f * (float)rng.NextDouble();     // broken off
                        if (length < 0.02f) continue;
                        var baseR = Math.Min(pr * (float)L.Radius, pr * 0.85f);
                        // Thin branches are proportionally thinner the shorter they are.
                        baseR = Math.Min(baseR, length * (cactus ? 0.35f : 0.12f) + 0.004f);
                        if (baseR < 0.002f) continue;
                        // Cactus arms stay nearly as thick as they start.
                        var tip = cactus ? 0.85f : dead ? 0.45f : level == recipe.Levels.Count ? 0.18f : 0.3f;
                        var segs = Math.Clamp((int)MathF.Round(length / Math.Max(0.12f, (float)recipe.Height / 40)), 3, 12);
                        var b = new TreeBranch { Id = sk.Branches.Count, Parent = pid, ParentT = t, Level = level };
                        GrowCurve(b, p, dir, length, baseR, tip, segs, (float)L.Bend, (float)L.Wobble, rng,
                            twistTurns: (float)recipe.Twist * 0.5f, twistRadius: baseR * 1.5f, taperPower: stylized ? 1.3f : 1f);
                        // Keep branches above the ground.
                        for (var i = 1; i < b.Points.Count; i++) if (b.Points[i].Y < 0.1f) b.Points[i] = b.Points[i] with { Y = 0.1f + 0.02f * i };
                        b.Phase = level == 1 ? (float)rng.NextDouble() : parent.Phase;
                        b.BendAtBase = level == 1 ? 0 : parent.BendAtBase + (1 - parent.BendAtBase) * MathF.Pow(t, 1.5f) * 0.6f;
                        b.Finish();
                        sk.Branches.Add(b);
                        parent.Children.Add(b.Id);
                        next.Add(b.Id);
                    }
                }
            }
            parents = next;
        }

        if (recipe.Vines > 0) AddVines(sk, recipe, rng);

        // Exactly the asked height: scale the shape (not the thickness) to fit.
        var top = sk.Branches.SelectMany(b => b.Points).Max(p => p.Y);
        var scale = top > 1e-3f ? (float)recipe.Height / top : 1;
        if (MathF.Abs(scale - 1) > 1e-3f)
            foreach (var b in sk.Branches)
            {
                for (var i = 0; i < b.Points.Count; i++) b.Points[i] = b.Points[i] with { X = b.Points[i].X * scale, Y = b.Points[i].Y * scale, Z = b.Points[i].Z * scale };
                b.Finish();
            }
        sk.Height = (float)recipe.Height;
        var crown = sk.Branches.Where(b => b.Level >= 1).SelectMany(b => b.Points).ToList();
        if (crown.Count == 0) crown = [.. sk.Trunk.Points];
        sk.CrownCentre = crown.Aggregate(Vector3.Zero, (a, p) => a + p) / crown.Count;
        sk.CrownRadius = crown.Max(p => Vector3.Distance(p, sk.CrownCentre));
        return sk;
    }

    /// <summary>The crown shape: how long level-1 limbs are at a height in the crown (0 its bottom … 1 its top).</summary>
    public static float ShapeRatio(string shape, float t)
    {
        var x = Math.Clamp(1 - t, 0, 1);     // 1 at the bottom of the crown, 0 at the top
        return shape switch
        {
            "conical" => 0.2f + 0.8f * x,
            "spherical" => 0.2f + 0.8f * MathF.Sin(MathF.PI * x),
            "hemispherical" => 0.2f + 0.8f * MathF.Sin(MathF.PI / 2 * x),
            "cylindrical" => 1,
            "tapered" => 0.5f + 0.5f * x,
            "flame" => x <= 0.7f ? 0.15f + 0.85f * x / 0.7f : 0.15f + 0.85f * (1 - x) / 0.3f,
            "inverse" => 1 - 0.8f * x,
            "umbrella" => 0.3f + 0.7f * MathF.Pow(1 - x, 0.8f),
            _ => 1,
        };
    }

    /// <summary>
    /// Grows one branch as a smooth curve: it bends towards the light (or droops), wobbles at random, may lean and
    /// twist in a spiral, and tapers from its base radius to tipRatio of it.
    /// </summary>
    private static void GrowCurve(TreeBranch b, Vector3 start, Vector3 dir, float length, float baseR, float tipRatio, int segments,
        float bendDegrees, float wobbleDegrees, Random rng, (float Degrees, Vector3 Axis)? lean = null, float twistTurns = 0, float twistRadius = 0, float taperPower = 1)
    {
        var p = start;
        var d = Vector3.Normalize(dir);
        var step = length / segments;
        var spin = Vector3.Zero;      // the wobble changes smoothly: a random walk of the turning, not of the direction
        // The same total wiggle however finely the branch is divided.
        var wobbleStep = wobbleDegrees * MathF.Sqrt(4f / segments);
        var centreLine = new List<Vector3> { p };
        for (var i = 1; i <= segments; i++)
        {
            // Bend: turn towards straight up (or away from it when drooping), evenly over the length.
            var side = Vector3.Cross(d, Vector3.UnitY);
            if (side.LengthSquared() > 1e-6f && bendDegrees != 0)
                d = Vector3.Transform(d, Quaternion.CreateFromAxisAngle(Vector3.Normalize(side), bendDegrees / segments * MathF.PI / 180));
            if (lean is { } l && l.Degrees > 0)
                d = Vector3.Transform(d, Quaternion.CreateFromAxisAngle(l.Axis, l.Degrees / segments * MathF.PI / 180 * (i < segments / 2 ? 1.5f : 0.5f)));
            if (wobbleDegrees > 0)
            {
                spin = spin * 0.3f + new Vector3((float)rng.NextDouble() - 0.5f, (float)rng.NextDouble() - 0.5f, (float)rng.NextDouble() - 0.5f) * 0.8f;
                var axis = spin - d * Vector3.Dot(spin, d);
                if (axis.LengthSquared() > 1e-8f)
                    d = Vector3.Transform(d, Quaternion.CreateFromAxisAngle(Vector3.Normalize(axis), wobbleStep * MathF.PI / 180 * MathF.Min(1, axis.Length() * 2)));
            }
            d = Vector3.Normalize(d);
            p += d * step;
            centreLine.Add(p);
        }
        // Spiral twist: the curve winds around its own centre line, most in the middle of the branch.
        for (var i = 0; i <= segments; i++)
        {
            var s = i / (float)segments;
            var pos = centreLine[i];
            if (twistTurns != 0 && twistRadius > 0 && i > 0)
            {
                var t = i == segments ? centreLine[i] - centreLine[i - 1] : centreLine[i + 1] - centreLine[i - 1];
                t = Vector3.Normalize(t);
                var u = Vector3.Normalize(Vector3.Cross(t, MathF.Abs(t.Y) < 0.9f ? Vector3.UnitY : Vector3.UnitX));
                var v = Vector3.Cross(t, u);
                var a = s * twistTurns * MathF.Tau;
                var amp = twistRadius * MathF.Sin(MathF.PI * s) * 0.6f;
                pos += (u * MathF.Cos(a) + v * MathF.Sin(a)) * amp;
            }
            b.Points.Add(pos);
            b.Radii.Add(baseR * (1 - (1 - tipRatio) * MathF.Pow(s, taperPower)));
        }
        b.Finish();
    }

    /// <summary>The trunk's own shape: a swelling (baobab), an S-curve, and a little extra girth at the very base.</summary>
    private static void ShapeTrunk(TreeBranch trunk, TreeRecipe recipe, Random rng)
    {
        var n = trunk.Points.Count;
        var a = Vector3.Transform(Vector3.UnitX, Quaternion.CreateFromAxisAngle(Vector3.UnitY, (float)(rng.NextDouble() * Math.Tau)));
        var b = Vector3.Cross(Vector3.UnitY, a);
        var h = (float)recipe.Height;
        for (var i = 0; i < n; i++)
        {
            var s = i / (float)(n - 1);
            if (recipe.Bulge > 0) trunk.Radii[i] *= 1 + (float)recipe.Bulge * 1.3f * MathF.Exp(-MathF.Pow((s - (float)recipe.BulgeAt) / 0.28f, 2));
            if (recipe.SCurve > 0) trunk.Points[i] += (a * MathF.Sin(MathF.PI * s) + b * 0.6f * MathF.Sin(MathF.Tau * s)) * (float)recipe.SCurve * h;
            var cactus = recipe.Archetype == "cactus";
            if (recipe.RootStyle == "compact" && s < 0.08f && !cactus) trunk.Radii[i] *= 1 + 0.25f * (1 - s / 0.08f);
            // Fluting: the core thins where the ridges stand proud of it (a cactus's ribs: all the way up).
            if (recipe.Flute > 0 && s < recipe.FluteHeight)
                trunk.Radii[i] *= 1 - 0.3f * (float)recipe.Flute * (cactus ? 1 - MathF.Pow(s, 6) : MathF.Pow(1 - s / (float)recipe.FluteHeight, 0.6f));
        }
        trunk.Finish();
    }

    /// <summary>Flute ridges: thick welded strands up the lower trunk, so it reads ribbed and grooved (sequoia, cypress).</summary>
    private static void AddFluteRidges(TreeSkeleton sk, TreeBranch trunk, TreeRecipe recipe)
    {
        var lobes = recipe.FluteLobes;
        var f = (float)recipe.Flute;
        for (var k = 0; k < lobes; k++)
        {
            var ridge = new TreeBranch { Id = sk.Branches.Count, Parent = 0, Level = 0, Kind = "ridge" };
            const int steps = 9;
            for (var j = 0; j <= steps; j++)
            {
                var s = (float)recipe.FluteHeight * j / steps;
                var (p, r, dir) = trunk.At(s);
                var core = r;
                var full = core / (1 - 0.3f * f * MathF.Pow(1 - j / (float)steps, 0.6f));     // the trunk's radius before thinning
                var n0 = trunk.Normals[Math.Min(trunk.Normals.Count - 1, (int)(s * (trunk.Points.Count - 1)))];
                var angle = MathF.Tau * k / lobes + (float)recipe.Twist * s * MathF.Tau;
                var radial = Vector3.Normalize(Vector3.Transform(n0, Quaternion.CreateFromAxisAngle(dir, angle)));
                var fade = MathF.Pow(1 - j / (float)steps, 0.6f);
                ridge.Points.Add(p + radial * full * 0.58f * MathF.Max(0.2f, fade) - (j == 0 ? Vector3.UnitY * full * 0.15f : Vector3.Zero));
                ridge.Radii.Add(MathF.Max(full * 0.06f, full * (0.3f + 0.16f * f) * fade));
            }
            ridge.Finish();
            sk.Branches.Add(ridge);
            trunk.Children.Add(ridge.Id);
        }
    }

    /// <summary>Surface roots: long, curling over the ground, forking, flattening, their tips sinking into it.</summary>
    private static void AddSurfaceRoots(TreeSkeleton sk, TreeBranch trunk, TreeRecipe recipe, Random rng)
    {
        var R = (float)recipe.TrunkRadius;
        var start = (float)(rng.NextDouble() * Math.Tau);
        void Strand(Vector3 origin, float az, float length, float thick, float curl)
        {
            var b = new TreeBranch { Id = sk.Branches.Count, Parent = 0, Level = 0, Kind = "root" };
            const int steps = 10;
            for (var j = 0; j <= steps; j++)
            {
                var t = j / (float)steps;
                var a = az + curl * t;
                var r = thick * MathF.Pow(1 - t, 1.2f) + thick * 0.08f;
                var p = origin + new Vector3(MathF.Cos(a), 0, MathF.Sin(a)) * length * t;
                // Down from the trunk, along the ground half sunk in it (so it reads flat), the tip under the ground.
                p.Y = origin.Y * MathF.Pow(1 - t, 3) + r * 0.25f * (1 - MathF.Pow(1 - t, 3)) - (float)recipe.RootBurial * r * 1.6f * t * t;
                b.Points.Add(p);
                b.Radii.Add(r);
            }
            b.Finish();
            sk.Branches.Add(b);
            trunk.Children.Add(b.Id);
        }
        for (var i = 0; i < recipe.Roots; i++)
        {
            var az = start + i * MathF.Tau / recipe.Roots + (float)(rng.NextDouble() - 0.5) * 0.45f;
            var outward = new Vector3(MathF.Cos(az), 0, MathF.Sin(az));
            var (centre, _, _) = trunk.At(MathF.Min(R * 1.3f, (float)recipe.Height * 0.12f) / (float)recipe.Height);
            var origin = centre + outward * R * 0.35f;
            var length = R * 3.5f * (float)recipe.RootLength * (0.8f + 0.4f * (float)rng.NextDouble());
            var thick = R * 0.45f;
            var curl = (float)(rng.NextDouble() * 2 - 1) * 0.5f;
            Strand(origin, az, length, thick, curl);
            var main = sk.Branches[^1];
            for (var f = 0; f < recipe.RootForks; f++)
            {
                var at = Math.Min(main.Points.Count - 2, 3 + f * 2);
                Strand(main.Points[at] + Vector3.UnitY * main.Radii[at] * 0.2f, az + curl * at / 10f + ((f + i) % 2 == 0 ? 0.6f : -0.6f), length * (0.5f - f * 0.1f), main.Radii[at] * 0.8f, (float)(rng.NextDouble() - 0.5) * 0.6f);
            }
        }
    }

    /// <summary>Mangrove stilts: roots arching out of the trunk and down into the ground (or water) around it.</summary>
    private static void AddPropRoots(TreeSkeleton sk, TreeBranch trunk, TreeRecipe recipe, Random rng)
    {
        var R = (float)recipe.TrunkRadius;
        var start = (float)(rng.NextDouble() * Math.Tau);
        for (var i = 0; i < recipe.Roots; i++)
        {
            var az = start + i * MathF.Tau / recipe.Roots + (float)(rng.NextDouble() - 0.5) * 0.5f;
            var outward = new Vector3(MathF.Cos(az), 0, MathF.Sin(az));
            var (origin, _, _) = trunk.At(0.12f + 0.25f * (float)rng.NextDouble());
            var reach = R * 5.5f * (float)recipe.RootLength * (0.75f + 0.5f * (float)rng.NextDouble());
            var b = new TreeBranch { Id = sk.Branches.Count, Parent = 0, Level = 0, Kind = "prop" };
            const int steps = 9;
            for (var j = 0; j <= steps; j++)
            {
                var t = j / (float)steps;
                var p = origin + outward * reach * (0.6f * t + 0.4f * MathF.Sin(t * MathF.PI / 2));
                p.Y = origin.Y * (1 - MathF.Pow(t, 1.7f)) - 0.08f * R * t;
                b.Points.Add(p);
                b.Radii.Add(R * (0.36f - 0.18f * t));
            }
            b.Finish();
            sk.Branches.Add(b);
            trunk.Children.Add(b.Id);
        }
    }

    /// <summary>Cypress knees: woody cones standing up out of the ground or water around the trunk.</summary>
    private static void AddKnees(TreeSkeleton sk, TreeRecipe recipe, Random rng)
    {
        var R = (float)recipe.TrunkRadius;
        for (var i = 0; i < recipe.Knees; i++)
        {
            var az = (float)(rng.NextDouble() * Math.Tau);
            var dist = R * (1.8f + 4.5f * (float)Math.Sqrt(rng.NextDouble())) * (float)recipe.RootLength;
            var at = new Vector3(MathF.Cos(az), 0, MathF.Sin(az)) * dist;
            var h = R * (0.35f + 0.9f * (float)rng.NextDouble());
            var r = R * (0.12f + 0.1f * (float)rng.NextDouble());
            var tilt = new Vector3((float)rng.NextDouble() - 0.5f, 0, (float)rng.NextDouble() - 0.5f) * h * 0.3f;
            var b = new TreeBranch { Id = sk.Branches.Count, Parent = 0, Level = 0, Kind = "knee" };
            b.Points.AddRange([at - Vector3.UnitY * r, at + Vector3.UnitY * h * 0.5f + tilt * 0.5f, at + Vector3.UnitY * h + tilt]);
            b.Radii.AddRange([r * 1.3f, r * 0.85f, r * 0.45f]);
            b.Finish();
            sk.Branches.Add(b);
            sk.Trunk.Children.Add(b.Id);
        }
    }

    /// <summary>Vines hanging from the branches, swaying a little, ending above the ground.</summary>
    private static void AddVines(TreeSkeleton sk, TreeRecipe recipe, Random rng)
    {
        var hosts = sk.Branches.Where(b => b.Kind == "branch" && b.Level is 1 or 2 && b.Length > 0.3f).ToList();
        if (hosts.Count == 0) return;
        var thick = Math.Clamp((float)recipe.Height / 400, 0.008f, 0.05f);
        for (var i = 0; i < recipe.Vines; i++)
        {
            var host = hosts[rng.Next(hosts.Count)];
            var t = 0.3f + 0.6f * (float)rng.NextDouble();
            var (p, r, _) = host.At(t);
            if (p.Y < 1) continue;
            var length = MathF.Max(0.3f, (p.Y - 0.3f) * (0.35f + 0.6f * (float)rng.NextDouble()));
            var sway = new Vector3((float)rng.NextDouble() - 0.5f, 0, (float)rng.NextDouble() - 0.5f) * 0.6f;
            var v = new TreeBranch { Id = sk.Branches.Count, Parent = host.Id, ParentT = t, Level = host.Level + 1, Kind = "vine" };
            const int steps = 8;
            for (var j = 0; j <= steps; j++)
            {
                var s = j / (float)steps;
                v.Points.Add(p - Vector3.UnitY * length * s + sway * MathF.Sin(s * MathF.PI) * length * 0.15f + (j == 0 ? Vector3.UnitY * r * 0.5f : Vector3.Zero));
                v.Radii.Add(thick * (1 - 0.4f * s));
            }
            v.Phase = host.Phase;
            v.BendAtBase = host.BendAtBase;
            v.Finish();
            sk.Branches.Add(v);
            host.Children.Add(v.Id);
        }
    }

    /// <summary>All points of all branches (for bounds and tests).</summary>
    public IEnumerable<Vector3> AllPoints => Branches.SelectMany(b => b.Points);
}
