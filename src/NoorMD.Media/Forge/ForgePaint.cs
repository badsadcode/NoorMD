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
    /// <summary>
    /// The colour it was painted with ("#rrggbb"), on a paint layer: what it painted keeps that colour when the layer's
    /// colour changes later (as in a painting program). Null: the layer's colour (strokes from before this existed).
    /// </summary>
    public string? Color { get; set; }
    /// <summary>
    /// How it goes onto what a painting already has (as a painting program's brush blend): mix (null), multiply, screen,
    /// overlay, softlight, add, subtract, darken, lighten, hue, saturation, color, value. Only paintings use it.
    /// </summary>
    public string? Blend { get; set; }
    /// <summary>
    /// The maps it paints and their values (as a painting program's brush): its colour (Color, or the layer's), and a
    /// roughness, metal or height of its own. Null: the layer's maps and values (strokes from before preview.141).
    /// Erasing, it takes away only these maps (null: all of them).
    /// </summary>
    public ForgeStrokeMaps? Maps { get; set; }
    public static readonly string[] Blends = ["mix", "multiply", "screen", "overlay", "softlight", "add", "subtract", "darken", "lighten", "hue", "saturation", "color", "value"];

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
        Blend = Blend is { } bl && Blends.Contains(bl) && bl != "mix" ? bl : null;
        Maps = Maps?.Clamped();
        Color = Color is { Length: 7 } c && c[0] == '#' && c[1..].All(Uri.IsHexDigit) ? c.ToLowerInvariant() : null;
        return this;
    }
}

/// <summary>The maps a stroke paints (see <see cref="ForgeStroke.Maps"/>): each on or off, with its value.</summary>
public sealed class ForgeStrokeMaps
{
    public bool Color { get; set; }
    public double? Roughness { get; set; }
    public double? Metallic { get; set; }
    public double? Height { get; set; }

    public bool Any => Color || Roughness != null || Metallic != null || Height != null;

    public ForgeStrokeMaps? Clamped()
    {
        static double? C(double? v) => v is { } x ? ForgeMask.C(x, 0, 1) : null;
        Roughness = C(Roughness); Metallic = C(Metallic); Height = C(Height);
        return Any ? this : null;
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
    /// <param name="layers">The masks of the layers below, by id (for masks that follow one).</param>
    public static float[] LayerMask(ForgeBake bake, ForgeLayer layer, int setIndex, Func<string, ForgePicture?>? pictures = null, Func<string, float[]?>? layers = null) =>
        LayerMask(bake, layer, setIndex, pictures, layers, out _);

    /// <summary>
    /// The layer's mask, and (for a plain layer with strokes that keep their own colour) the colour of each texel: the
    /// layer's colour, then each stroke's own over it where it painted (by how much it covered), in order.
    /// </summary>
    public static float[] LayerMask(ForgeBake bake, ForgeLayer layer, int setIndex, Func<string, ForgePicture?>? pictures, Func<string, float[]?>? layers, out Vector3[]? colors)
    {
        var v = LayerMaskRaw(bake, layer, setIndex, pictures, layers, out colors);
        if (layer.Mask.Filters.Count > 0) ForgeFilters.Apply(bake, v, layer.Mask.Filters);
        return v;
    }

    private static float[] LayerMaskRaw(ForgeBake bake, ForgeLayer layer, int setIndex, Func<string, ForgePicture?>? pictures, Func<string, float[]?>? layers, out Vector3[]? colors)
    {
        var n = bake.Size * bake.Size;
        var v = new float[n];
        var span = bake.BoundsMax - bake.BoundsMin;
        var mask = layer.Mask;
        var anchor = mask.Layer.Length > 0 ? layers?.Invoke(mask.Layer) : null;
        var given = mask.Kind switch
        {
            "layer" => anchor != null ? ForgeMasks.Follow(bake, anchor, mask) : null,
            "drips" => ForgeMasks.Drips(bake, anchor, mask),
            _ => null,
        };
        Parallel.For(0, n, i => { if (bake.Covered[i] != 0) v[i] = ForgeCompositor.MaskAt(mask, bake, i, setIndex, span, given); });
        colors = null;
        // Strokes that paint maps of their own are worked out by Channels (a layer's mask is its smart mask then).
        if (HasChannels(layer)) return v;
        if (layer.Material.Length == 0 && layer.Strokes.Any(st => st.Color != null))
        {
            var own = ForgeCompositor.Hex(layer.Color);
            colors = new Vector3[n];
            Array.Fill(colors, own);
        }
        foreach (var stroke in layer.Strokes)
        {
            if (colors == null) { Apply(bake, stroke, v, pictures); continue; }
            var cover = Coverage(bake, stroke, pictures);
            var col = stroke.Color != null ? ForgeCompositor.Hex(stroke.Color) : ForgeCompositor.Hex(layer.Color);
            foreach (var (i, a) in cover)
            {
                if (stroke.Erase) { v[i] *= 1 - a; continue; }
                // The new paint over what was there, as much as it covers (a soft edge blends the two colours).
                var before = v[i];
                v[i] = before + (1 - before) * a;
                var share = v[i] > 1e-6f ? (v[i] - before + before * a) / v[i] : 1;
                colors[i] = Vector3.Lerp(colors[i], col, Math.Clamp(share, 0, 1));
            }
        }
        return v;
    }

    /// <summary>Whether a layer's strokes paint maps of their own (a paint layer or a painting, preview.141 on).</summary>
    public static bool HasChannels(ForgeLayer layer) => layer.Material.Length == 0 && layer.Strokes.Any(st => st.Maps != null);

    /// <summary>Each map's coverage and value from a layer's strokes (see <see cref="ForgeStroke.Maps"/>).</summary>
    public sealed class ChannelPaint
    {
        public required float[] ColorCover, RoughCover, MetalCover, HeightCover;
        public required Vector3[] Color;
        public required float[] Rough, Metal, Height;
    }

    /// <summary>
    /// A layer whose strokes paint their own maps: each map starts as the layer's own value where its smart mask shows
    /// (if the layer paints that map), then each stroke's value over it where it painted, in order; erasing takes away
    /// its maps. A painting (pixels) keeps its colour in its picture: only the other maps come from here.
    /// </summary>
    public static ChannelPaint Channels(ForgeBake bake, ForgeLayer layer, float[] smart, Func<string, ForgePicture?>? pictures = null)
    {
        var n = bake.Size * bake.Size;
        var picture = layer.Image != null;
        var p = new ChannelPaint
        {
            ColorCover = new float[n], RoughCover = new float[n], MetalCover = new float[n], HeightCover = new float[n],
            Color = new Vector3[n], Rough = new float[n], Metal = new float[n], Height = new float[n],
        };
        var own = ForgeCompositor.Hex(layer.Color);
        for (var i = 0; i < n; i++)
        {
            p.Color[i] = own; p.Rough[i] = (float)layer.Roughness; p.Metal[i] = (float)layer.Metallic; p.Height[i] = (float)layer.Height;
            if (picture) continue; // a painting's own maps are its picture's colour only
            if (layer.UseColor) p.ColorCover[i] = smart[i];
            if (layer.UseRoughness) p.RoughCover[i] = smart[i];
            if (layer.UseMetallic) p.MetalCover[i] = smart[i];
            if (layer.UseHeight) p.HeightCover[i] = smart[i];
        }
        static void Over(float[] cover, int i, float a, Action<float> mix)
        {
            var before = cover[i];
            cover[i] = before + (1 - before) * a;
            var share = cover[i] > 1e-6f ? (cover[i] - before + before * a) / cover[i] : 1;
            mix(Math.Clamp(share, 0, 1));
        }
        foreach (var stroke in layer.Strokes)
        {
            if (picture && stroke.Maps == null) continue; // a painting's colour strokes are in its pixels
            // Before preview.141 a stroke painted the layer's maps with its values.
            var m = stroke.Maps ?? new ForgeStrokeMaps
            {
                Color = layer.UseColor, Roughness = layer.UseRoughness ? layer.Roughness : null,
                Metallic = layer.UseMetallic ? layer.Metallic : null, Height = layer.UseHeight ? layer.Height : null,
            };
            var paintsColor = m.Color && !picture;
            var col = stroke.Color != null ? ForgeCompositor.Hex(stroke.Color) : own;
            foreach (var (i, a) in Coverage(bake, stroke, pictures))
            {
                if (stroke.Erase)
                {
                    var all = stroke.Maps == null;
                    if (all || m.Color) p.ColorCover[i] *= 1 - a;
                    if (all || m.Roughness != null) p.RoughCover[i] *= 1 - a;
                    if (all || m.Metallic != null) p.MetalCover[i] *= 1 - a;
                    if (all || m.Height != null) p.HeightCover[i] *= 1 - a;
                    continue;
                }
                if (paintsColor) Over(p.ColorCover, i, a, s => p.Color[i] = Vector3.Lerp(p.Color[i], col, s));
                if (m.Roughness is { } r) Over(p.RoughCover, i, a, s => p.Rough[i] += ((float)r - p.Rough[i]) * s);
                if (m.Metallic is { } mt) Over(p.MetalCover, i, a, s => p.Metal[i] += ((float)mt - p.Metal[i]) * s);
                if (m.Height is { } h) Over(p.HeightCover, i, a, s => p.Height[i] += ((float)h - p.Height[i]) * s);
            }
        }
        return p;
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
            // A tip keeps its picture's proportions: the radius is half its height, its width follows.
            var aspect = tip == null ? 1 : (float)tip.Width / Math.Max(1, tip.Height);
            var reach = tip == null ? 1 : 1.415f * MathF.Max(1, aspect);
            for (var d = 0; d < stroke.DabCount; d++)
            {
                var at = new Vector3(stroke.Dabs[d * 5], stroke.Dabs[d * 5 + 1], stroke.Dabs[d * 5 + 2]);
                var r = (float)stroke.Radius * MathF.Max(0.02f, stroke.Dabs[d * 5 + 3]);
                var flow = (float)stroke.Flow * stroke.Dabs[d * 5 + 4];
                if (flow <= 0) continue;
                var angle = (float)((stroke.Angle + stroke.Jitter * 360 * (Hash(d, stroke.Seed) - 0.5)) * Math.PI / 180);
                float ca = MathF.Cos(angle), sa = MathF.Sin(angle);
                grid.Near(at, r * reach, i =>
                {
                    var off = bake.Position[i] - at;
                    var t = off.Length() / r;
                    if (t >= reach) return;
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
                        if (MathF.Abs(tu) > aspect || MathF.Abs(tv) > 1) return;
                        f = tip.Sample((tu / aspect + 1) * 0.5f, (1 - tv) * 0.5f);
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
