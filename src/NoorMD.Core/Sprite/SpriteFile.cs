using System.IO.Compression;
using System.Text;
using NoorMD.Core.Documents;

namespace NoorMD.Core.Sprite;

/// <summary>
/// The NoorSprite file (.noorsprite): a ZIP with sprite.json (the sprite without its pixels) and a PNG per cel
/// (cels/{layer}-{frame}.png), written atomically; reopening gives the same pixels. Anything that doesn't look like
/// one is refused rather than guessed at.
/// </summary>
public static class SpriteFile
{
    public const string Extension = ".noorsprite";
    public const long MaxFileBytes = 512L * 1024 * 1024;

    public static void Save(string path, SpriteDoc doc) => AtomicFile.WriteAllBytes(path, ToBytes(doc));

    public static byte[] ToBytes(SpriteDoc doc)
    {
        doc.Checked();
        var manifest = new SpriteDoc
        {
            Version = doc.Version, Width = doc.Width, Height = doc.Height, Palette = doc.Palette, Layers = doc.Layers, Frames = doc.Frames, Tags = doc.Tags, Slices = doc.Slices,
            Tilesets = doc.Tilesets.Select(t => new SpriteTileset { Name = t.Name, TileWidth = t.TileWidth, TileHeight = t.TileHeight, Count = t.Count, Terrains = t.Terrains }).ToList(),
            GridWidth = doc.GridWidth, GridHeight = doc.GridHeight, ColorMode = doc.ColorMode, Cycle = doc.Cycle,
            Cels = doc.Cels.Select(c => new SpriteCel { Layer = c.Layer, Frame = c.Frame, X = c.X, Y = c.Y, Width = c.Width, Height = c.Height, Opacity = c.Opacity, Link = c.Link, Tiles = c.Tiles }).ToList(),
        };
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            var m = zip.CreateEntry("sprite.json", CompressionLevel.Optimal);
            using (var s = m.Open()) s.Write(Encoding.UTF8.GetBytes(manifest.ToJson()));
            for (var t = 0; t < doc.Tilesets.Count; t++)
            {
                var ts = doc.Tilesets[t];
                if (ts.Count == 0) continue;
                var e = zip.CreateEntry($"tilesets/{t}.png", CompressionLevel.NoCompression);
                using var s = e.Open();
                s.Write(SpritePng.Encode(ts.TileWidth, ts.TileHeight * ts.Count, ts.Pixels()));
            }
            foreach (var c in doc.Cels.Where(c => c.Tiles == null))
            {
                var e = zip.CreateEntry($"cels/{c.Layer}-{c.Frame}.png", CompressionLevel.NoCompression); // PNG is already compressed
                using var s = e.Open();
                s.Write(SpritePng.Encode(c.Width, c.Height, c.Pixels()));
            }
        }
        return ms.ToArray();
    }

    public static SpriteDoc Load(string path)
    {
        if (new FileInfo(path).Length > MaxFileBytes) throw new InvalidDataException("The file is too large to be a NoorSprite sprite.");
        return FromBytes(File.ReadAllBytes(path));
    }

    public static SpriteDoc FromBytes(byte[] bytes)
    {
        using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        var me = zip.GetEntry("sprite.json") ?? throw new InvalidDataException("This is not a NoorSprite sprite (sprite.json is missing).");
        if (me.Length > 64 * 1024 * 1024) throw new InvalidDataException("sprite.json is too large.");
        string json;
        using (var s = me.Open()) using (var r = new StreamReader(s, Encoding.UTF8)) json = r.ReadToEnd();
        var doc = SpriteDoc.FromJson(json);
        for (var t = 0; t < doc.Tilesets.Count; t++)
        {
            var ts = doc.Tilesets[t];
            if (ts.Count == 0) continue;
            var e = zip.GetEntry($"tilesets/{t}.png") ?? throw new InvalidDataException($"A tileset's picture is missing ({ts.Name}).");
            using var s = e.Open(); using var buf = new MemoryStream(); s.CopyTo(buf);
            var (w, h, rgba) = SpritePng.Decode(buf.ToArray());
            if (w != ts.TileWidth || h != ts.TileHeight * ts.Count) throw new InvalidDataException("A tileset's picture doesn't match its tiles.");
            ts.WithPixels(rgba);
        }
        foreach (var c in doc.Cels.Where(c => c.Tiles == null))
        {
            var e = zip.GetEntry($"cels/{c.Layer}-{c.Frame}.png") ?? throw new InvalidDataException($"A cel's picture is missing ({c.Layer}, frame {c.Frame + 1}).");
            if (e.Length > 64 * 1024 * 1024) throw new InvalidDataException("A cel's picture is too large.");
            using var s = e.Open();
            using var buf = new MemoryStream();
            s.CopyTo(buf);
            var (w, h, rgba) = SpritePng.Decode(buf.ToArray());
            if (w != c.Width || h != c.Height) throw new InvalidDataException("A cel's picture doesn't match its size.");
            c.WithPixels(rgba);
        }
        return doc.Checked();
    }
}
