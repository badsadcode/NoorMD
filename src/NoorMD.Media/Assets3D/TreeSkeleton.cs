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
    public bool Root { get; init; }
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
        var leader = recipe.CrownStart >= 0.999 || recipe.Archetype is "conifer" or "birch";

        // Trunk. A tree with a crown that splits stops its trunk a little above where the limbs begin.
        var trunkLength = (float)(leader ? recipe.Height : recipe.Height * Math.Min(1, recipe.CrownStart + 0.3));
        var trunkTip = (float)(leader ? 0.02 : Math.Max(0.15, 1 - recipe.Taper));
        var trunk = new TreeBranch { Id = 0, Level = 0 };
        var leanAxis = Vector3.Transform(Vector3.UnitX, Quaternion.CreateFromAxisAngle(Vector3.UnitY, (float)(rng.NextDouble() * Math.Tau)));
        var trunkSegments = stylized ? 14 : 18;
        GrowCurve(trunk, Vector3.Zero, Vector3.UnitY, trunkLength, (float)recipe.TrunkRadius, trunkTip, trunkSegments,
            bendDegrees: 0, wobbleDegrees: (float)recipe.Wobble, rng,
            lean: ((float)recipe.Lean, leanAxis), twistTurns: (float)recipe.Twist, twistRadius: (float)recipe.TrunkRadius * 1.2f,
            taperPower: stylized ? 1.5f : 1f);
        sk.Branches.Add(trunk);

        // Roots: short, thick and sinking, melted into the base for the flare.
        if (recipe.Flare > 0 && recipe.Roots > 0)
        {
            var start = (float)(rng.NextDouble() * Math.Tau);
            for (var r = 0; r < recipe.Roots; r++)
            {
                var az = start + r * MathF.Tau / recipe.Roots + (float)(rng.NextDouble() - 0.5) * 0.6f;
                var outward = new Vector3(MathF.Cos(az), 0, MathF.Sin(az));
                var dir = Vector3.Normalize(outward * 0.85f - Vector3.UnitY * 0.5f);
                var root = new TreeBranch { Id = sk.Branches.Count, Parent = 0, ParentT = 0, Level = 0, Root = true };
                var len = (float)(recipe.TrunkRadius * (1.6 + 2.2 * recipe.Flare) * (0.75 + 0.5 * rng.NextDouble()));
                var baseR = (float)(recipe.TrunkRadius * (0.38 + 0.25 * recipe.Flare));
                GrowCurve(root, new Vector3(0, (float)recipe.TrunkRadius * 0.9f, 0) + outward * (float)recipe.TrunkRadius * 0.3f, dir, len, baseR, 0.25f, 5,
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
                    var tRing = (float)(L.Start + (1 - L.Start) * (ring + 0.5 + (rng.NextDouble() - 0.5) * 0.6) / rings);
                    // Leave the very tip of the trunk alone on a single-leader tree.
                    tRing = Math.Clamp(tRing, (float)L.Start, level == 1 && leader ? 0.95f : 0.97f);
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
                        if (level == 1 && !leader) angle *= 1 - 0.35f * t;
                        var dir = Vector3.Normalize(pdir * MathF.Cos(angle) + across * MathF.Sin(angle));

                        var crownT = (t - (float)L.Start) / Math.Max(1e-3f, 1 - (float)L.Start);
                        var shape = level == 1 ? ShapeRatio(recipe.Shape, crownT) : 1 - 0.5f * t;
                        var length = parent.Length * (float)L.Length * shape * (float)(1 + (rng.NextDouble() * 2 - 1) * L.LengthSpread);
                        if (level == 1 && leader) length = Math.Min(length, (float)recipe.Height * 0.6f);
                        if (dead && rng.NextDouble() < 0.35) length *= 0.4f + 0.4f * (float)rng.NextDouble();     // broken off
                        if (length < 0.02f) continue;
                        var baseR = Math.Min(pr * (float)L.Radius, pr * 0.85f);
                        // Thin branches are proportionally thinner the shorter they are.
                        baseR = Math.Min(baseR, length * 0.12f + 0.004f);
                        if (baseR < 0.002f) continue;
                        var tip = dead ? 0.45f : level == recipe.Levels.Count ? 0.18f : 0.3f;
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

    /// <summary>All points of all branches (for bounds and tests).</summary>
    public IEnumerable<Vector3> AllPoints => Branches.SelectMany(b => b.Points);
}
