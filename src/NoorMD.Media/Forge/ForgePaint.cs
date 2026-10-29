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
    /// <summary>The brush's tip: "" for round (its hardness), a NoorForge tip's id, or a picture's id in the recipe.</summary>
    public string Tip { get; set; } = "";
    /// <summary>The tip's turn in degrees (clockwise, as seen from the painter), and how much each dab turns at random (0–1: up to a whole turn).</summary>
    public double Angle { get; set; }
    public double Jitter { get; set; }
    /// <summary>Picks each dab's random turn (the same every time the stroke is painted).</summary>
    public int Seed { get; set; }
    /// <summary>A picture laid over the view while painting: paint gets through where it is white.</summary>
    public ForgeStencil? Stencil { get; set; }

    public int DabCount => Dabs.Length / 5;

    public ForgeStroke Clamped()
    {
        Radius = ForgeMask.C(Radius, 0.0001, 100); Hardness = ForgeMask.C(Hardness, 0, 1); Flow = ForgeMask.C(Flow, 0, 1);
        View = View is { Length: 3 } v && v.All(float.IsFinite) && v.Any(x => x != 0) ? v : [0, 0, -1];
        var dabs = Dabs ?? [];
        var count = Math.Min(dabs.Length / 5, MaxDabs);
        Dabs = dabs.Take(count * 5).Select((x, i) => float.IsFinite(x) ? (i % 5 >= 3 ? Math.Clamp(x, 0, 1) : x) : 0).ToArray();
        Part = Math.Clamp(Part, -1, 4095);
        Tip = Tip is { Length: <= 40 } t && t.All(c => char.IsLetterOrDigit(c) || c is '-' or '_') ? t : "";
        Angle = double.IsFinite(Angle) ? Angle % 360 : 0; Jitter = ForgeMask.C(Jitter, 0, 1);
        Stencil = Stencil?.Clamped();
        return this;
    }
}

/// <summary>
/// Where a stencil was on the screen when a stroke was painted: three rows that take a point on the model (x, y, z, 1)
/// to the stencil's u·w, v·w and w (the camera's perspective folded in), so it lands on the model as it was seen.
/// </summary>
public sealed class ForgeStencil
{
    public string Picture { get; set; } = "";
    public float[] Rows { get; set; } = [];
    /// <summary>Repeats beyond its edges (else nothing gets through there).</summary>
    public bool Tile { get; set; }
    /// <summary>Black lets paint through instead of white.</summary>
    public bool Invert { get; set; }

    public ForgeStencil? Clamped()
    {
        if (Rows is not { Length: 12 } || !Rows.All(float.IsFinite)) return null;
        if (string.IsNullOrEmpty(Picture) || Picture.Length > 40) return null;
        return this;
    }

    /// <summary>How much gets through at a point (0–1).</summary>
    public float At(ForgePicture picture, Vector3 p)
    {
        var r = Rows;
        var w = r[8] * p.X + r[9] * p.Y + r[10] * p.Z + r[11];
        if (w <= 1e-6f) return 0; // behind the camera
        var u = (r[0] * p.X + r[1] * p.Y + r[2] * p.Z + r[3]) / w;
        var v = (r[4] * p.X + r[5] * p.Y + r[6] * p.Z + r[7]) / w;
        var value = picture.Sample(u, v, Tile);
        return Invert ? (Tile || (u >= 0 && v >= 0 && u <= 1 && v <= 1) ? 1 - value : 0) : value;
    }
}

/// <summary>Strokes into a layer's mask: its smart mask first, then each stroke adding or taking away, in order.</summary>
public static class ForgePaint
{
    /// <summary>The layer's mask with its strokes, 0–1 a texel (before the layer's opacity).</summary>
    public static float[] LayerMask(ForgeBake bake, ForgeLayer layer, int setIndex, Func<string, ForgePicture?>? pictures = null)
    {
        var n = bake.Size * bake.Size;
        var v = new float[n];
        var span = bake.BoundsMax - bake.BoundsMin;
        Parallel.For(0, n, i => { if (bake.Covered[i] != 0) v[i] = ForgeCompositor.MaskAt(layer.Mask, bake, i, setIndex, span); });
        foreach (var stroke in layer.Strokes) Apply(bake, stroke, v, pictures);
        return v;
    }

    /// <summary>One stroke onto a mask: its coverage (dabs building up by their flow) added, or taken away.</summary>
    public static void Apply(ForgeBake bake, ForgeStroke stroke, float[] v, Func<string, ForgePicture?>? pictures = null)
    {
        var cover = Coverage(bake, stroke, pictures);
        foreach (var (i, a) in cover)
            v[i] = stroke.Erase ? v[i] * (1 - a) : v[i] + (1 - v[i]) * a;
    }

    /// <summary>The texels a stroke reaches and how much (0–1).</summary>
    internal static Dictionary<int, float> Coverage(ForgeBake bake, ForgeStroke stroke, Func<string, ForgePicture?>? pictures = null)
    {
        ForgePicture? Find(string id) => id.Length == 0 ? null : ForgeTips.Get(id) ?? pictures?.Invoke(id);
        var tip = Find(stroke.Tip);
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
            var (right, up) = ScreenAxes(view);
            for (var d = 0; d < stroke.DabCount; d++)
            {
                var at = new Vector3(stroke.Dabs[d * 5], stroke.Dabs[d * 5 + 1], stroke.Dabs[d * 5 + 2]);
                var r = (float)stroke.Radius * MathF.Max(0.02f, stroke.Dabs[d * 5 + 3]);
                var flow = (float)stroke.Flow * stroke.Dabs[d * 5 + 4];
                if (flow <= 0) continue;
                var angle = (float)((stroke.Angle + stroke.Jitter * 360 * (Hash(d, stroke.Seed) - 0.5)) * Math.PI / 180);
                float ca = MathF.Cos(angle), sa = MathF.Sin(angle);
                grid.Near(at, r, i =>
                {
                    var off = bake.Position[i] - at;
                    var t = off.Length() / r;
                    if (t >= 1.415f) return;
                    // Only what faces the painter (fading at the silhouette), as a brush on the screen would reach.
                    var facing = Smooth(-0.05f, 0.25f, -Vector3.Dot(bake.Normal[i], view));
                    if (facing <= 0) return;
                    float f;
                    if (tip == null)
                    {
                        if (t >= 1) return;
                        f = t <= hard ? 1 : Smooth(0, 1, (1 - t) / MathF.Max(1e-4f, 1 - hard));
                    }
                    else
                    {
                        // The tip faces the painter: the point's place across the screen, turned by the dab's angle.
                        if (MathF.Abs(Vector3.Dot(off, view)) > r) return;
                        float a = Vector3.Dot(off, right) / r, b = Vector3.Dot(off, up) / r;
                        float tu = ca * a - sa * b, tv = sa * a + ca * b; // turned clockwise by the angle
                        if (MathF.Abs(tu) > 1 || MathF.Abs(tv) > 1) return;
                        f = tip.Sample((tu + 1) * 0.5f, (1 - tv) * 0.5f);
                        if (f <= 0) return;
                    }
                    var k = keep.TryGetValue(i, out var have) ? have : 1;
                    keep[i] = k * (1 - flow * f * facing);
                });
            }
        }
        var stencil = stroke.Stencil;
        var stencilPicture = stencil != null ? Find(stencil.Picture) : null;
        var cover = new Dictionary<int, float>(keep.Count);
        foreach (var (i, k) in keep)
        {
            if (k >= 1) continue;
            var a = 1 - k;
            // The stencil: as much gets through as it lets at this point, as it lay over the view.
            if (stencil != null) a *= stencilPicture != null ? stencil.At(stencilPicture, bake.Position[i]) : 0;
            if (a > 0) cover[i] = a;
        }
        return cover;
    }

    /// <summary>Across and up the screen, for a view direction (as the page works them out).</summary>
    public static (Vector3 Right, Vector3 Up) ScreenAxes(Vector3 view)
    {
        var right = Vector3.Cross(view, Vector3.UnitY);
        right = right.LengthSquared() < 1e-8f ? Vector3.UnitX : Vector3.Normalize(right);
        return (right, Vector3.Cross(right, view));
    }

    /// <summary>A dab's random number, 0–1 (the page has the same).</summary>
    public static float Hash(int i, int seed)
    {
        var x = unchecked((uint)i * 0x9E3779B1u + (uint)seed * 0x85EBCA77u);
        x ^= x >> 15; x = unchecked(x * 0x2C1B3C6Du); x ^= x >> 12;
        return x / 4294967296f;
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
