using System.Numerics;

namespace NoorMD.Media.Forge;

/// <summary>
/// A brush stroke on the model, kept as what was painted rather than pixels: dabs at points on the surface (world
/// space, metres), the brush's size, hardness and flow, and the direction it was painted from. Every texture size is
/// painted again from it, across UV seams, as each texel knows where on the model it is.
/// </summary>
public sealed class ForgeStroke
{
    public const int MaxDabs = 20_000;

    /// <summary>Takes paint away (from the layer's mask, smart or painted) instead of adding it.</summary>
    public bool Erase { get; set; }
    /// <summary>The brush's radius in metres (each dab's size scales it).</summary>
    public double Radius { get; set; } = 0.05;
    /// <summary>0–1: the share of the radius painted fully, the rest fading out.</summary>
    public double Hardness { get; set; } = 0.5;
    /// <summary>0–1: how much each dab adds (dabs over each other build up).</summary>
    public double Flow { get; set; } = 1;
    /// <summary>The direction the stroke was painted from (into the model): what faces away from it isn't painted.</summary>
    public float[] View { get; set; } = [0, 0, -1];
    /// <summary>Five numbers a dab: x, y, z, its size (0–1 of the radius) and its flow (0–1), as a pen's pressure gives.</summary>
    public float[] Dabs { get; set; } = [];
    /// <summary>A fill instead of dabs: the whole of one part (by index); −1 for none.</summary>
    public int Part { get; set; } = -1;

    public int DabCount => Dabs.Length / 5;

    public ForgeStroke Clamped()
    {
        Radius = ForgeMask.C(Radius, 0.0001, 100); Hardness = ForgeMask.C(Hardness, 0, 1); Flow = ForgeMask.C(Flow, 0, 1);
        View = View is { Length: 3 } v && v.All(float.IsFinite) && v.Any(x => x != 0) ? v : [0, 0, -1];
        var dabs = Dabs ?? [];
        var count = Math.Min(dabs.Length / 5, MaxDabs);
        Dabs = dabs.Take(count * 5).Select((x, i) => float.IsFinite(x) ? (i % 5 >= 3 ? Math.Clamp(x, 0, 1) : x) : 0).ToArray();
        Part = Math.Clamp(Part, -1, 4095);
        return this;
    }
}

/// <summary>Strokes into a layer's mask: its smart mask first, then each stroke adding or taking away, in order.</summary>
public static class ForgePaint
{
    /// <summary>The layer's mask with its strokes, 0–1 a texel (before the layer's opacity).</summary>
    public static float[] LayerMask(ForgeBake bake, ForgeLayer layer, int setIndex)
    {
        var n = bake.Size * bake.Size;
        var v = new float[n];
        var span = bake.BoundsMax - bake.BoundsMin;
        Parallel.For(0, n, i => { if (bake.Covered[i] != 0) v[i] = ForgeCompositor.MaskAt(layer.Mask, bake, i, setIndex, span); });
        foreach (var stroke in layer.Strokes) Apply(bake, stroke, v);
        return v;
    }

    /// <summary>One stroke onto a mask: its coverage (dabs building up by their flow) added, or taken away.</summary>
    public static void Apply(ForgeBake bake, ForgeStroke stroke, float[] v)
    {
        var cover = Coverage(bake, stroke);
        foreach (var (i, a) in cover)
            v[i] = stroke.Erase ? v[i] * (1 - a) : v[i] + (1 - v[i]) * a;
    }

    /// <summary>The texels a stroke reaches and how much (0–1).</summary>
    internal static Dictionary<int, float> Coverage(ForgeBake bake, ForgeStroke stroke)
    {
        var keep = new Dictionary<int, float>();
        if (stroke.Part >= 0)
        {
            for (var i = 0; i < bake.Part.Length; i++)
                if (bake.Covered[i] != 0 && bake.Part[i] == stroke.Part) keep[i] = 1 - (float)stroke.Flow;
        }
        else
        {
            var grid = bake.Grid;
            var view = Vector3.Normalize(new Vector3(stroke.View[0], stroke.View[1], stroke.View[2]));
            var hard = (float)stroke.Hardness;
            for (var d = 0; d < stroke.DabCount; d++)
            {
                var at = new Vector3(stroke.Dabs[d * 5], stroke.Dabs[d * 5 + 1], stroke.Dabs[d * 5 + 2]);
                var r = (float)stroke.Radius * MathF.Max(0.02f, stroke.Dabs[d * 5 + 3]);
                var flow = (float)stroke.Flow * stroke.Dabs[d * 5 + 4];
                if (flow <= 0) continue;
                grid.Near(at, r, i =>
                {
                    var t = Vector3.Distance(bake.Position[i], at) / r;
                    if (t >= 1) return;
                    // Only what faces the painter (fading at the silhouette), as a brush on the screen would reach.
                    var facing = Smooth(-0.05f, 0.25f, -Vector3.Dot(bake.Normal[i], view));
                    if (facing <= 0) return;
                    var f = t <= hard ? 1 : Smooth(0, 1, (1 - t) / MathF.Max(1e-4f, 1 - hard));
                    var k = keep.TryGetValue(i, out var have) ? have : 1;
                    keep[i] = k * (1 - flow * f * facing);
                });
            }
        }
        var cover = new Dictionary<int, float>(keep.Count);
        foreach (var (i, k) in keep) if (k < 1) cover[i] = 1 - k;
        return cover;
    }

    private static float Smooth(float e0, float e1, float x) { var t = Math.Clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
}

/// <summary>The covered texels by where they are on the model, in cells, to find those near a point quickly.</summary>
public sealed class ForgeTexelGrid
{
    private readonly Dictionary<(int, int, int), int[]> _cells;
    private readonly Vector3 _min;
    private readonly float _cell;

    public ForgeTexelGrid(ForgeBake bake)
    {
        var span = bake.BoundsMax - bake.BoundsMin;
        _min = bake.BoundsMin;
        _cell = MathF.Max(1e-4f, MathF.Max(span.X, MathF.Max(span.Y, span.Z)) / 96);
        var lists = new Dictionary<(int, int, int), List<int>>();
        for (var i = 0; i < bake.Covered.Length; i++)
        {
            if (bake.Covered[i] == 0) continue;
            var key = Cell(bake.Position[i]);
            if (!lists.TryGetValue(key, out var l)) lists[key] = l = [];
            l.Add(i);
        }
        _cells = lists.ToDictionary(p => p.Key, p => p.Value.ToArray());
    }

    private (int, int, int) Cell(Vector3 p) => ((int)MathF.Floor((p.X - _min.X) / _cell), (int)MathF.Floor((p.Y - _min.Y) / _cell), (int)MathF.Floor((p.Z - _min.Z) / _cell));

    /// <summary>Calls back with every texel in the cells a sphere touches (the caller checks the distance).</summary>
    public void Near(Vector3 at, float radius, Action<int> each)
    {
        var lo = Cell(at - new Vector3(radius)); var hi = Cell(at + new Vector3(radius));
        for (var x = lo.Item1; x <= hi.Item1; x++)
            for (var y = lo.Item2; y <= hi.Item2; y++)
                for (var z = lo.Item3; z <= hi.Item3; z++)
                    if (_cells.TryGetValue((x, y, z), out var list))
                        foreach (var i in list) each(i);
    }
}
