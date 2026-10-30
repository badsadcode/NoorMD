using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Core.Photo;

/// <summary>
/// A NoorPhoto picture: its size, guides and layers (bottom first). The page does the editing; this is the shape the
/// page and the app pass between them. A layer's picture travels as a base64 PNG (8-bit RGBA, straight alpha) in
/// <see cref="PhotoLayer.Png"/>. A group's layers come before it in the list (below it); the group's own entry is where
/// the folder sits, at the top of what is in it.
/// </summary>
public sealed class PhotoDoc
{
    public const int MaxSide = 8192;
    public const int MaxLayers = 500;
    /// <summary>A layer's picture can be larger than the canvas (moved partly off it), up to this a side.</summary>
    public const int MaxLayerSide = 16384;
    /// <summary>How far off the canvas a layer may sit.</summary>
    public const int MaxOffset = 32768;

    public static readonly string[] Kinds = ["pixel", "group", "fill", "adjust", "text", "shape"];

    public static readonly string[] Blends =
    [
        "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light",
        "difference", "exclusion", "hue", "saturation", "color", "luminosity", "linear-dodge", "linear-burn", "vivid-light",
        "linear-light", "pin-light", "hard-mix", "subtract", "divide", "darker-color", "lighter-color", "dissolve",
    ];

    public int Version { get; set; } = 1;
    public int Width { get; set; } = 1200;
    public int Height { get; set; } = 800;
    public List<PhotoGuide>? Guides { get; set; }
    /// <summary>Bottom first.</summary>
    public List<PhotoLayer> Layers { get; set; } = [];
    /// <summary>The whole picture flattened (base64 PNG), sent by the page when saving: the PSD's merged picture and the file's preview.</summary>
    public string? Composite { get; set; }

    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, WriteIndented = false,
        Converters = { new LenientInt() },
    };

    public static PhotoDoc FromJson(string json)
    {
        PhotoDoc? doc;
        try { doc = JsonSerializer.Deserialize<PhotoDoc>(json, Json); }
        catch (JsonException ex) { throw new InvalidDataException("That photo couldn't be read (" + ex.Message + ")."); }
        return (doc ?? throw new InvalidDataException("Not a photo.")).Checked();
    }

    public string ToJson() => JsonSerializer.Serialize(this, Json);

    /// <summary>Makes sure the photo is sound (sizes, ids, groups); mends what it can and throws on what it can't.</summary>
    public PhotoDoc Checked()
    {
        if (Width < 1 || Height < 1 || Width > MaxSide || Height > MaxSide) throw new InvalidDataException($"A photo is 1 to {MaxSide} pixels a side.");
        Version = Math.Max(Version, 1);
        Layers = (Layers ?? []).Where(l => l != null).ToList();
        if (Layers.Count > MaxLayers) throw new InvalidDataException($"A photo has at most {MaxLayers} layers.");
        Guides = Guides?.Where(g => g != null && (g.Axis is "x" or "y") && double.IsFinite(g.At) && Math.Abs(g.At) <= MaxOffset).Take(1000).ToList();
        if (string.IsNullOrEmpty(Composite)) Composite = null;

        var ids = new HashSet<string>();
        foreach (var l in Layers)
        {
            if (string.IsNullOrEmpty(l.Id) || l.Id.Length > 64 || !ids.Add(l.Id)) throw new InvalidDataException("Every layer needs an id of its own (1 to 64 characters).");
            l.Name = string.IsNullOrWhiteSpace(l.Name) ? "Layer" : l.Name.Trim()[..Math.Min(l.Name.Trim().Length, 255)];
            l.Kind = Kinds.Contains(l.Kind) ? l.Kind : "pixel";
            l.Blend = Blends.Contains(l.Blend) ? l.Blend : "normal";
            l.Opacity = double.IsNaN(l.Opacity) ? 1 : Math.Clamp(l.Opacity, 0, 1);
            l.FillOpacity = double.IsNaN(l.FillOpacity) ? 1 : Math.Clamp(l.FillOpacity, 0, 1);
            l.X = Math.Clamp(l.X, -MaxOffset, MaxOffset); l.Y = Math.Clamp(l.Y, -MaxOffset, MaxOffset);
            if (l.Width is < 0 or > MaxLayerSide || l.Height is < 0 or > MaxLayerSide) throw new InvalidDataException($"A layer's picture is 0 to {MaxLayerSide} pixels a side.");
            if (string.IsNullOrEmpty(l.Png) || l.Width == 0 || l.Height == 0) l.Png = null;
            if (l.Mask != null)
            {
                var m = l.Mask;
                m.X = Math.Clamp(m.X, -MaxOffset, MaxOffset); m.Y = Math.Clamp(m.Y, -MaxOffset, MaxOffset);
                if (m.Width is < 0 or > MaxLayerSide || m.Height is < 0 or > MaxLayerSide) throw new InvalidDataException($"A layer mask is 0 to {MaxLayerSide} pixels a side.");
                m.Background = m.Background >= 128 ? 255 : 0;
                if (string.IsNullOrEmpty(m.Png) || m.Width == 0 || m.Height == 0) m.Png = null;
            }
        }

        // A layer's group must be a group in the photo; a chain of groups that goes round in a circle is broken where it closes.
        var byId = Layers.ToDictionary(l => l.Id);
        foreach (var l in Layers)
            if (l.Parent != null && (l.Parent == l.Id || !byId.TryGetValue(l.Parent, out var p) || p.Kind != "group")) l.Parent = null;
        foreach (var l in Layers)
        {
            var seen = new HashSet<string> { l.Id };
            for (var at = l; at.Parent != null; at = byId[at.Parent])
                if (!seen.Add(at.Parent)) { at.Parent = null; break; }
        }
        return this;
    }

    /// <summary>The bytes of a base64 PNG (a "data:" URL is taken too); a readable error when it isn't base64.</summary>
    public static byte[] PngBytes(string base64)
    {
        var comma = base64.StartsWith("data:", StringComparison.Ordinal) ? base64.IndexOf(',') : -1;
        try { return Convert.FromBase64String(comma >= 0 ? base64[(comma + 1)..] : base64); }
        catch (FormatException) { throw new InvalidDataException("A layer's picture isn't a valid PNG."); }
    }

    /// <summary>Whole numbers in the page's JSON may arrive as 10.0 or 10.5; they are rounded rather than refused.</summary>
    private sealed class LenientInt : JsonConverter<int>
    {
        public override int Read(ref Utf8JsonReader r, Type t, JsonSerializerOptions o)
        {
            if (r.TokenType != JsonTokenType.Number) throw new JsonException("A number was expected.");
            if (r.TryGetInt32(out var i)) return i;
            var d = r.GetDouble();
            return double.IsFinite(d) ? (int)Math.Clamp(Math.Round(d), int.MinValue, int.MaxValue) : 0;
        }

        public override void Write(Utf8JsonWriter w, int v, JsonSerializerOptions o) => w.WriteNumberValue(v);
    }
}

/// <summary>A guide line: axis "x" is a vertical line at x = At, "y" a horizontal one.</summary>
public sealed class PhotoGuide
{
    public string Axis { get; set; } = "x";
    public double At { get; set; }
}

public sealed class PhotoLayer
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "Layer";
    /// <summary>"pixel", "group", "fill", "adjust", "text" or "shape".</summary>
    public string Kind { get; set; } = "pixel";
    /// <summary>The group the layer is in (a group layer's id), or none.</summary>
    public string? Parent { get; set; }
    public bool Visible { get; set; } = true;
    public bool Locked { get; set; }
    /// <summary>Painting keeps the layer's see-through parts as they are.</summary>
    public bool LockAlpha { get; set; }
    /// <summary>0–1.</summary>
    public double Opacity { get; set; } = 1;
    public string Blend { get; set; } = "normal";
    /// <summary>Clipped to the layer below (shows only where that one has pixels).</summary>
    public bool Clip { get; set; }
    /// <summary>Where the picture sits on the canvas; it may be partly outside.</summary>
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    /// <summary>The layer's picture as a base64 PNG; for fill and text layers, how they look.</summary>
    public string? Png { get; set; }
    /// <summary>In a .noorphoto file's photo.json only: where the picture is in the ZIP. Never on the page's wire.</summary>
    public string? Image { get; set; }
    public PhotoMask? Mask { get; set; }
    /// <summary>A group shown folded in the layers panel.</summary>
    public bool Collapsed { get; set; }
    /// <summary>The page's own settings for these kinds of layer, kept exactly as they came.</summary>
    public JsonElement? Fill { get; set; }
    public JsonElement? Adjust { get; set; }
    public JsonElement? Text { get; set; }
    /// <summary>Live filters (the page's own settings); the picture in <see cref="Png"/> already has them applied.</summary>
    public JsonElement? Filters { get; set; }
    /// <summary>Layer styles (shadow, glow, stroke, bevel, overlays), page-defined and kept as they are.</summary>
    public JsonElement? Styles { get; set; }
    /// <summary>A shape layer's geometry, fill and stroke (page-defined; its png is the shape drawn).</summary>
    public JsonElement? Shape { get; set; }
    /// <summary>0–1: the layer's own pixels' opacity, its styles' unchanged.</summary>
    public double FillOpacity { get; set; } = 1;

    internal PhotoLayer Copy()
    {
        var c = (PhotoLayer)MemberwiseClone();
        c.Mask = Mask?.Copy();
        return c;
    }
}

/// <summary>A layer mask: a grey picture (its R channel: 0 hides, 255 shows) and the grey everywhere outside it.</summary>
public sealed class PhotoMask
{
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public string? Png { get; set; }
    /// <summary>In a .noorphoto file's photo.json only (see <see cref="PhotoLayer.Image"/>).</summary>
    public string? Image { get; set; }
    public bool Enabled { get; set; } = true;
    /// <summary>0 or 255: the mask's value outside its picture.</summary>
    public int Background { get; set; }

    internal PhotoMask Copy() => (PhotoMask)MemberwiseClone();
}
