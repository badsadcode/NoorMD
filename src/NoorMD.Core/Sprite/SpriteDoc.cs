using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Core.Sprite;

/// <summary>
/// A NoorSprite sprite: its size, palette, layers, frames (each with a duration), the cels (a layer's pixels on a
/// frame) and tags (named frame ranges). Pixels are 8-bit RGBA, straight alpha, rows from the top. Between the page
/// and the app a cel's pixels travel as base64 in <see cref="SpriteCel.Data"/>.
/// </summary>
public sealed class SpriteDoc
{
    public const int MaxSide = 2048;
    public const int MaxFrames = 1024;
    public const int MaxLayers = 256;
    public const int MaxPalette = 256;

    public int Version { get; set; } = 1;
    public int Width { get; set; } = 32;
    public int Height { get; set; } = 32;
    /// <summary>Colours as #rrggbbaa.</summary>
    public List<string> Palette { get; set; } = [];
    /// <summary>Bottom first.</summary>
    public List<SpriteLayer> Layers { get; set; } = [];
    public List<SpriteFrame> Frames { get; set; } = [];
    public List<SpriteCel> Cels { get; set; } = [];
    public List<SpriteTag> Tags { get; set; } = [];
    /// <summary>The grid drawn over the sprite (tiles), in pixels.</summary>
    public int GridWidth { get; set; } = 16;
    public int GridHeight { get; set; } = 16;

    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, WriteIndented = false,
    };

    public static SpriteDoc FromJson(string json) => (JsonSerializer.Deserialize<SpriteDoc>(json, Json) ?? throw new InvalidDataException("Not a sprite.")).Checked();
    public string ToJson() => JsonSerializer.Serialize(this, Json);

    /// <summary>Makes sure the sprite is sound (sizes, references, pixels' lengths); throws on what can't be mended.</summary>
    public SpriteDoc Checked()
    {
        if (Width < 1 || Height < 1 || Width > MaxSide || Height > MaxSide) throw new InvalidDataException($"A sprite is 1 to {MaxSide} pixels a side.");
        Layers ??= []; Frames ??= []; Cels ??= []; Tags ??= []; Palette ??= [];
        if (Layers.Count is 0 or > MaxLayers) throw new InvalidDataException($"A sprite has 1 to {MaxLayers} layers.");
        if (Frames.Count is 0 or > MaxFrames) throw new InvalidDataException($"A sprite has 1 to {MaxFrames} frames.");
        Palette = Palette.Where(IsColour).Take(MaxPalette).ToList();
        var ids = new HashSet<string>();
        foreach (var l in Layers)
        {
            l.Name = string.IsNullOrWhiteSpace(l.Name) ? "Layer" : l.Name.Trim()[..Math.Min(l.Name.Trim().Length, 64)];
            if (string.IsNullOrEmpty(l.Id) || l.Id.Length > 40 || !l.Id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_') || !ids.Add(l.Id))
                throw new InvalidDataException("Every layer needs an id of its own (letters, digits, '-' and '_').");
            l.Opacity = Math.Clamp(l.Opacity, 0, 255);
            l.Blend = SpriteLayer.Blends.Contains(l.Blend) ? l.Blend : "normal";
        }
        foreach (var f in Frames) f.Duration = Math.Clamp(f.Duration, 1, 65535);
        var seen = new HashSet<(string, int)>();
        Cels = Cels.Where(c => c != null && ids.Contains(c.Layer) && c.Frame >= 0 && c.Frame < Frames.Count && c.Width > 0 && c.Height > 0
            && c.Width <= MaxSide && c.Height <= MaxSide && seen.Add((c.Layer, c.Frame))).ToList();
        foreach (var c in Cels)
        {
            c.Opacity = Math.Clamp(c.Opacity, 0, 255);
            if (c.Data != null && c.Pixels().Length != c.Width * c.Height * 4) throw new InvalidDataException("A cel's pixels don't match its size.");
        }
        Tags = Tags.Where(t => t != null).Take(256).Select(t =>
        {
            t.Name = string.IsNullOrWhiteSpace(t.Name) ? "Tag" : t.Name.Trim()[..Math.Min(t.Name.Trim().Length, 64)];
            t.From = Math.Clamp(t.From, 0, Frames.Count - 1); t.To = Math.Clamp(t.To, t.From, Frames.Count - 1);
            t.Direction = SpriteTag.Directions.Contains(t.Direction) ? t.Direction : "forward";
            t.Color = IsColour(t.Color) ? t.Color : "#3c6ad4ff";
            return t;
        }).ToList();
        GridWidth = Math.Clamp(GridWidth, 1, MaxSide); GridHeight = Math.Clamp(GridHeight, 1, MaxSide);
        return this;
    }

    public static bool IsColour(string? c) => c is { Length: 9 } && c[0] == '#' && c[1..].All(Uri.IsHexDigit);

    public SpriteCel? Cel(string layer, int frame) => Cels.FirstOrDefault(c => c.Layer == layer && c.Frame == frame);
}

public sealed class SpriteLayer
{
    public static readonly string[] Blends = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "add", "difference"];
    public string Id { get; set; } = "";
    public string Name { get; set; } = "Layer";
    public bool Visible { get; set; } = true;
    public bool Locked { get; set; }
    /// <summary>0–255.</summary>
    public int Opacity { get; set; } = 255;
    public string Blend { get; set; } = "normal";
}

public sealed class SpriteFrame
{
    /// <summary>How long it shows, in milliseconds.</summary>
    public int Duration { get; set; } = 100;
}

public sealed class SpriteCel
{
    public string Layer { get; set; } = "";
    public int Frame { get; set; }
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    /// <summary>0–255.</summary>
    public int Opacity { get; set; } = 255;
    /// <summary>RGBA, 4 bytes a pixel, as base64 (between the page and the app; files keep it as a PNG).</summary>
    public string? Data { get; set; }

    private byte[]? _pixels;
    public byte[] Pixels() => _pixels ??= Data == null ? new byte[Width * Height * 4] : Convert.FromBase64String(Data);
    public SpriteCel WithPixels(byte[] rgba) { _pixels = rgba; Data = Convert.ToBase64String(rgba); return this; }
}

public sealed class SpriteTag
{
    public static readonly string[] Directions = ["forward", "reverse", "pingpong"];
    public string Name { get; set; } = "Tag";
    public int From { get; set; }
    public int To { get; set; }
    public string Direction { get; set; } = "forward";
    public string Color { get; set; } = "#3c6ad4ff";
}
