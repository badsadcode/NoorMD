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
    /// <summary>Named rectangles on the sprite (a 9-slice centre, a pivot): for UI panels, hit boxes, origins.</summary>
    public List<SpriteSlice> Slices { get; set; } = [];
    /// <summary>Tilesets the tilemap layers draw from.</summary>
    public List<SpriteTileset> Tilesets { get; set; } = [];
    /// <summary>"rgba", or "indexed": every pixel is one of the palette's colours (changing a colour changes them).</summary>
    public string ColorMode { get; set; } = "rgba";
    /// <summary>Colour cycling: palette entries From…To turn round, Fps steps a second (indexed sprites).</summary>
    public SpriteCycle? Cycle { get; set; }
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
        ColorMode = ColorMode == "indexed" ? "indexed" : "rgba";
        if (Cycle != null)
        {
            Cycle.From = Math.Clamp(Cycle.From, 0, 255); Cycle.To = Math.Clamp(Cycle.To, Cycle.From, 255); Cycle.Fps = Math.Clamp(Cycle.Fps, 1, 60);
            if (Cycle.To == Cycle.From) Cycle = null;
        }
        var ids = new HashSet<string>();
        foreach (var l in Layers)
        {
            l.Name = string.IsNullOrWhiteSpace(l.Name) ? "Layer" : l.Name.Trim()[..Math.Min(l.Name.Trim().Length, 64)];
            if (string.IsNullOrEmpty(l.Id) || l.Id.Length > 40 || !l.Id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_') || !ids.Add(l.Id))
                throw new InvalidDataException("Every layer needs an id of its own (letters, digits, '-' and '_').");
            l.Opacity = Math.Clamp(l.Opacity, 0, 255);
            l.Blend = SpriteLayer.Blends.Contains(l.Blend) ? l.Blend : "normal";
        }
        foreach (var f in Frames)
        {
            f.Duration = Math.Clamp(f.Duration, 1, 65535);
            if (f.Sound != null && (string.IsNullOrWhiteSpace(f.Sound.Path) || f.Sound.Path.Length > 2000)) f.Sound = null;
            if (f.Sound != null) f.Sound.Name = string.IsNullOrWhiteSpace(f.Sound.Name) ? System.IO.Path.GetFileName(f.Sound.Path) : f.Sound.Name[..Math.Min(f.Sound.Name.Length, 120)];
        }
        var seen = new HashSet<(string, int)>();
        Tilesets = (Tilesets ?? []).Where(t => t != null).Take(64).Select(t => t.Checked()).ToList();
        var groups = new HashSet<string>();
        foreach (var l in Layers)
        {
            l.Kind = l.Kind == "group" ? "group" : l.Kind == "tilemap" && l.Tileset >= 0 && l.Tileset < Tilesets.Count ? "tilemap" : "image";
            if (l.Kind != "tilemap") l.Tileset = 0;
            // A layer in a group comes after the group (the group first, then what is in it, bottom first).
            if (l.Parent != null && !groups.Contains(l.Parent)) l.Parent = null;
            if (l.Kind == "group") groups.Add(l.Id);
        }
        Cels.RemoveAll(c => c != null && groups.Contains(c.Layer)); // a group has no pictures of its own
        var kinds = Layers.ToDictionary(l => l.Id);
        Cels = Cels.Where(c => c != null && ids.Contains(c.Layer) && c.Frame >= 0 && c.Frame < Frames.Count && c.Width > 0 && c.Height > 0
            && c.Width <= MaxSide && c.Height <= MaxSide && seen.Add((c.Layer, c.Frame))).ToList();
        foreach (var c in Cels)
        {
            c.Opacity = Math.Clamp(c.Opacity, 0, 255);
            if (c.Link != null && (c.Link.Length is 0 or > 40 || !c.Link.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_'))) c.Link = null;
            var cl = kinds[c.Layer];
            if (cl.Kind == "tilemap")
            {
                // A tilemap cel: Width × Height tiles, each a tile's number in the layer's tileset (0: none).
                var ts = Tilesets[cl.Tileset];
                if (c.Tiles == null || c.Tiles.Length != c.Width * c.Height) throw new InvalidDataException("A tilemap's tiles don't match its size.");
                for (var t = 0; t < c.Tiles.Length; t++) if ((c.Tiles[t] & SpriteTilemap.TileId) > ts.Count || (c.Tiles[t] & SpriteTilemap.TileId) == 0) c.Tiles[t] = 0;
                c.Data = null;
                continue;
            }
            c.Tiles = null;
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
        Slices = (Slices ?? []).Where(s => s != null).Take(256).Select(s => s.Checked(Width, Height)).ToList();
        return this;
    }

    public static bool IsColour(string? c) => c is { Length: 9 } && c[0] == '#' && c[1..].All(Uri.IsHexDigit);

    public SpriteCel? Cel(string layer, int frame) => Cels.FirstOrDefault(c => c.Layer == layer && c.Frame == frame);
}

public sealed class SpriteLayer
{
    public static readonly string[] Blends = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "add", "difference"];
    public string Id { get; set; } = "";
    /// <summary>The group the layer is in (a group layer's id), or none.</summary>
    public string? Parent { get; set; }
    /// <summary>A group shown folded in the timeline.</summary>
    public bool Collapsed { get; set; }
    public string Name { get; set; } = "Layer";
    public bool Visible { get; set; } = true;
    public bool Locked { get; set; }
    /// <summary>0–255.</summary>
    public int Opacity { get; set; } = 255;
    public string Blend { get; set; } = "normal";
    /// <summary>A picture to draw over or trace: shown, never exported.</summary>
    public bool Reference { get; set; }
    /// <summary>"image", "tilemap" (its cels are tiles of a tileset) or "group" (layers in it, no pictures of its own).</summary>
    public string Kind { get; set; } = "image";
    public int Tileset { get; set; }
}

public sealed class SpriteSlice
{
    public string Name { get; set; } = "Slice";
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; } = 1;
    public int Height { get; set; } = 1;
    public string Color { get; set; } = "#0000ffff";
    /// <summary>A 9-slice: the centre (stretched) inside the slice, relative to it; the rest are the corners and sides.</summary>
    public bool Nine { get; set; }
    public int CenterX { get; set; }
    public int CenterY { get; set; }
    public int CenterWidth { get; set; }
    public int CenterHeight { get; set; }
    /// <summary>A pivot (origin), relative to the slice.</summary>
    public bool HasPivot { get; set; }
    public int PivotX { get; set; }
    public int PivotY { get; set; }
    /// <summary>A slice that moves with the frames (a hitbox): from each key's frame on, it is at the key's place.</summary>
    public List<SpriteSliceKey> Keys { get; set; } = [];

    /// <summary>Where the slice is on frame f.</summary>
    public (int X, int Y, int Width, int Height) At(int f)
    {
        var k = Keys.LastOrDefault(k => k.Frame <= f);
        return k == null ? (X, Y, Width, Height) : (k.X, k.Y, k.Width, k.Height);
    }

    public SpriteSlice Checked(int spriteW, int spriteH)
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "Slice" : Name.Trim()[..Math.Min(Name.Trim().Length, 64)];
        Width = Math.Clamp(Width, 1, SpriteDoc.MaxSide * 2); Height = Math.Clamp(Height, 1, SpriteDoc.MaxSide * 2);
        X = Math.Clamp(X, -SpriteDoc.MaxSide, spriteW); Y = Math.Clamp(Y, -SpriteDoc.MaxSide, spriteH);
        Color = SpriteDoc.IsColour(Color) ? Color : "#0000ffff";
        CenterX = Math.Clamp(CenterX, 0, Width - 1); CenterY = Math.Clamp(CenterY, 0, Height - 1);
        CenterWidth = Math.Clamp(CenterWidth, 1, Width - CenterX); CenterHeight = Math.Clamp(CenterHeight, 1, Height - CenterY);
        PivotX = Math.Clamp(PivotX, -SpriteDoc.MaxSide, SpriteDoc.MaxSide); PivotY = Math.Clamp(PivotY, -SpriteDoc.MaxSide, SpriteDoc.MaxSide);
        Keys = (Keys ?? []).Where(k => k != null && k.Frame is >= 0 and < SpriteDoc.MaxFrames).GroupBy(k => k.Frame).Select(g => g.Last()).OrderBy(k => k.Frame).Take(SpriteDoc.MaxFrames).Select(k =>
        {
            k.Width = Math.Clamp(k.Width, 1, SpriteDoc.MaxSide * 2); k.Height = Math.Clamp(k.Height, 1, SpriteDoc.MaxSide * 2);
            k.X = Math.Clamp(k.X, -SpriteDoc.MaxSide, spriteW); k.Y = Math.Clamp(k.Y, -SpriteDoc.MaxSide, spriteH);
            return k;
        }).ToList();
        return this;
    }
}

public sealed class SpriteFrame
{
    /// <summary>How long it shows, in milliseconds.</summary>
    public int Duration { get; set; } = 100;
    /// <summary>A sound the frame plays when it comes (a file the user chose), for engine exports.</summary>
    public SpriteSound? Sound { get; set; }
}

public sealed class SpriteSound
{
    public string Path { get; set; } = "";
    public string Name { get; set; } = "";
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
    /// <summary>Cels of a layer with the same link are one picture on several frames (drawn on one, changed on all).</summary>
    public string? Link { get; set; }
    /// <summary>
    /// A tilemap cel's tiles (row by row, Width × Height), each a tile's number (0: none) in the low 29 bits, then
    /// flipped across (bit 29), flipped down (30) and turned on its diagonal (31), as Aseprite keeps them.
    /// </summary>
    public int[]? Tiles { get; set; }

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

/// <summary>
/// Tiles of one size; a tilemap layer's cels are grids of their numbers. Tile 0 is no tile; tiles 1…Count are in
/// <see cref="Data"/>, one under the other (a strip TileWidth wide, Count × TileHeight high), RGBA as base64.
/// </summary>
public sealed class SpriteTileset
{
    public const int MaxTiles = 4096;
    public string Name { get; set; } = "Tiles";
    public int TileWidth { get; set; } = 16;
    public int TileHeight { get; set; } = 16;
    public int Count { get; set; }
    public string? Data { get; set; }
    /// <summary>Autotiling: each terrain names the tile for every way its neighbours join it.</summary>
    public List<SpriteTerrain> Terrains { get; set; } = [];

    private byte[]? _pixels;
    public byte[] Pixels() => _pixels ??= Data == null ? new byte[TileWidth * TileHeight * 4 * Count] : Convert.FromBase64String(Data);
    public SpriteTileset WithPixels(byte[] rgba) { _pixels = rgba; Data = Convert.ToBase64String(rgba); return this; }

    /// <summary>Tile n (1…Count) as RGBA.</summary>
    public byte[] Tile(int n)
    {
        var size = TileWidth * TileHeight * 4;
        return n < 1 || n > Count ? new byte[size] : Pixels().AsSpan((n - 1) * size, size).ToArray();
    }

    public SpriteTileset Checked()
    {
        Name = string.IsNullOrWhiteSpace(Name) ? "Tiles" : Name.Trim()[..Math.Min(Name.Trim().Length, 64)];
        if (TileWidth is < 1 or > 512 || TileHeight is < 1 or > 512) throw new InvalidDataException("Tiles are 1 to 512 pixels a side.");
        if (Count is < 0 or > MaxTiles) throw new InvalidDataException($"A tileset holds up to {MaxTiles} tiles.");
        if (Pixels().Length != TileWidth * TileHeight * 4 * Count) throw new InvalidDataException("A tileset's pixels don't match its tiles.");
        Terrains = (Terrains ?? []).Where(t => t != null).Take(16).Select(t =>
        {
            t.Name = string.IsNullOrWhiteSpace(t.Name) ? "Terrain" : t.Name.Trim()[..Math.Min(t.Name.Trim().Length, 64)];
            t.Color = SpriteDoc.IsColour(t.Color) ? t.Color : "#4caf50ff";
            var tiles = new int[16];
            for (var i = 0; i < 16 && t.Tiles != null && i < t.Tiles.Length; i++) tiles[i] = t.Tiles[i] >= 1 && t.Tiles[i] <= Count ? t.Tiles[i] : 0;
            t.Tiles = tiles;
            return t;
        }).ToList();
        return this;
    }
}

public static class SpriteTilemap
{
    public const int TileId = 0x1fffffff, FlipX = 0x20000000, FlipY = 0x40000000, FlipD = unchecked((int)0x80000000);

    /// <summary>Tile v (a number with its bits) as RGBA: on the diagonal first (square tiles), then flipped.</summary>
    public static byte[] Turned(SpriteTileset ts, int v)
    {
        var tile = ts.Tile(v & TileId);
        if ((v & ~TileId) == 0) return tile;
        int w = ts.TileWidth, h = ts.TileHeight;
        var d = (v & FlipD) != 0 && w == h;
        var o = new byte[tile.Length];
        for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++)
            {
                int sx = x, sy = y;
                if ((v & FlipX) != 0) sx = w - 1 - sx;
                if ((v & FlipY) != 0) sy = h - 1 - sy;
                if (d) (sx, sy) = (sy, sx);
                Array.Copy(tile, (sy * w + sx) * 4, o, (y * w + x) * 4, 4);
            }
        return o;
    }

    /// <summary>A tilemap cel drawn as pixels (Width × Height tiles), cut to the sprite's size.</summary>
    public static byte[] Render(SpriteCel cel, SpriteTileset ts, int width, int height)
    {
        var px = new byte[width * height * 4];
        int tw = ts.TileWidth, th = ts.TileHeight;
        for (var ty = 0; ty < cel.Height; ty++)
            for (var tx = 0; tx < cel.Width; tx++)
            {
                var n = cel.Tiles![ty * cel.Width + tx];
                if ((n & TileId) == 0) continue;
                var tile = Turned(ts, n);
                for (var y = 0; y < th; y++)
                {
                    var py = cel.Y + ty * th + y;
                    if (py < 0 || py >= height) continue;
                    for (var x = 0; x < tw; x++)
                    {
                        var pxx = cel.X + tx * tw + x;
                        if (pxx < 0 || pxx >= width) continue;
                        Array.Copy(tile, (y * tw + x) * 4, px, (py * width + pxx) * 4, 4);
                    }
                }
            }
        return px;
    }
}

public sealed class SpriteCycle
{
    public int From { get; set; }
    public int To { get; set; }
    public int Fps { get; set; } = 8;
}

/// <summary>
/// A terrain for autotiling by sides: Tiles[mask] is the tile drawn where the neighbours joining it are mask's bits —
/// 1 above, 2 right, 4 below, 8 left (0: none of that shape).
/// </summary>
public sealed class SpriteTerrain
{
    public const int Up = 1, Right = 2, Down = 4, Left = 8;
    public string Name { get; set; } = "Terrain";
    public string Color { get; set; } = "#4caf50ff";
    public int[] Tiles { get; set; } = new int[16];
}

public sealed class SpriteSliceKey
{
    public int Frame { get; set; }
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; } = 1;
    public int Height { get; set; } = 1;
}
