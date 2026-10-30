using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using NoorMD.Core.Documents;

namespace NoorMD.Core.Photo;

/// <summary>
/// The NoorPhoto file (.noorphoto): a ZIP with photo.json (the photo without its pictures; each layer names its PNG
/// instead), layers/{i}.png and masks/{i}.png (i: the layer's place in the list), and preview.png (the flattened
/// picture, for thumbnails and quick looks). Written atomically; anything that doesn't look like one is refused.
/// </summary>
public static class PhotoFile
{
    public const string Extension = ".noorphoto";
    public const long MaxFileBytes = 2L * 1024 * 1024 * 1024;
    private const long MaxEntryBytes = 1L * 1024 * 1024 * 1024;

    public static void Save(string path, PhotoDoc doc) => AtomicFile.WriteAllBytes(path, ToBytes(doc));

    public static byte[] ToBytes(PhotoDoc doc)
    {
        doc.Checked();
        var manifest = new PhotoDoc { Version = doc.Version, Width = doc.Width, Height = doc.Height, Guides = doc.Guides, Layers = doc.Layers.Select(l => l.Copy()).ToList() };
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            for (var i = 0; i < doc.Layers.Count; i++)
            {
                var l = doc.Layers[i]; var m = manifest.Layers[i];
                m.Png = null; m.Image = null;
                if (l.Png != null)
                {
                    var png = PhotoDoc.PngBytes(l.Png);
                    if (PngSize(png) != (l.Width, l.Height)) throw new InvalidDataException($"A layer's picture doesn't match its size ({l.Name}).");
                    m.Image = $"layers/{i}.png";
                    Put(zip, m.Image, png);
                }
                if (l.Mask != null)
                {
                    m.Mask!.Png = null; m.Mask.Image = null;
                    if (l.Mask.Png != null)
                    {
                        var png = PhotoDoc.PngBytes(l.Mask.Png);
                        if (PngSize(png) != (l.Mask.Width, l.Mask.Height)) throw new InvalidDataException($"A layer mask doesn't match its size ({l.Name}).");
                        m.Mask.Image = $"masks/{i}.png";
                        Put(zip, m.Mask.Image, png);
                    }
                }
            }
            if (doc.Composite != null)
            {
                var png = PhotoDoc.PngBytes(doc.Composite);
                PngSize(png);
                Put(zip, "preview.png", png);
            }
            var e = zip.CreateEntry("photo.json", CompressionLevel.Optimal);
            using var s = e.Open();
            s.Write(Encoding.UTF8.GetBytes(manifest.ToJson()));
        }
        return ms.ToArray();
    }

    public static PhotoDoc Load(string path)
    {
        if (new FileInfo(path).Length > MaxFileBytes) throw new InvalidDataException("The file is too large to be a NoorPhoto photo.");
        return FromBytes(File.ReadAllBytes(path));
    }

    public static PhotoDoc FromBytes(byte[] bytes)
    {
        ZipArchive zip;
        try { zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read); }
        catch (InvalidDataException) { throw new InvalidDataException("This is not a NoorPhoto photo."); }
        using (zip)
        {
            foreach (var e in zip.Entries)
            {
                var n = e.FullName;
                if (n.StartsWith('/') || n.Contains('\\') || n.Contains(':') || n.Split('/').Any(p => p == ".."))
                    throw new InvalidDataException("This photo file has a strange entry in it and wasn't opened.");
                if (e.Length > MaxEntryBytes) throw new InvalidDataException("A part of this photo file is too large.");
            }
            var me = zip.GetEntry("photo.json") ?? throw new InvalidDataException("This is not a NoorPhoto photo (photo.json is missing).");
            if (me.Length > 256 * 1024 * 1024) throw new InvalidDataException("photo.json is too large.");
            var doc = PhotoDoc.FromJson(Encoding.UTF8.GetString(Read(me)));
            for (var i = 0; i < doc.Layers.Count; i++)
            {
                var l = doc.Layers[i];
                l.Png = null;
                if (l.Image != null)
                {
                    if (l.Image != $"layers/{i}.png") throw new InvalidDataException("This photo file names a picture where it shouldn't.");
                    var png = Read(zip.GetEntry(l.Image) ?? throw new InvalidDataException($"A layer's picture is missing ({l.Name})."));
                    if (PngSize(png) != (l.Width, l.Height)) throw new InvalidDataException($"A layer's picture doesn't match its size ({l.Name}).");
                    l.Png = Convert.ToBase64String(png);
                    l.Image = null;
                }
                if (l.Mask == null) continue;
                l.Mask.Png = null;
                if (l.Mask.Image != null)
                {
                    if (l.Mask.Image != $"masks/{i}.png") throw new InvalidDataException("This photo file names a picture where it shouldn't.");
                    var png = Read(zip.GetEntry(l.Mask.Image) ?? throw new InvalidDataException($"A layer mask is missing ({l.Name})."));
                    if (PngSize(png) != (l.Mask.Width, l.Mask.Height)) throw new InvalidDataException($"A layer mask doesn't match its size ({l.Name}).");
                    l.Mask.Png = Convert.ToBase64String(png);
                    l.Mask.Image = null;
                }
            }
            doc.Composite = null;
            if (zip.GetEntry("preview.png") is { } pe)
            {
                var png = Read(pe);
                PngSize(png);
                doc.Composite = Convert.ToBase64String(png);
            }
            return doc.Checked();
        }
    }

    /// <summary>A PNG's size from its header, without decoding it; throws when it isn't a PNG.</summary>
    internal static (int Width, int Height) PngSize(byte[] png)
    {
        ReadOnlySpan<byte> sig = [137, 80, 78, 71, 13, 10, 26, 10];
        if (png.Length < 33 || !png.AsSpan(0, 8).SequenceEqual(sig) || !png.AsSpan(12, 4).SequenceEqual("IHDR"u8)) throw new InvalidDataException("A picture in the photo isn't a PNG.");
        return (BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(16)), BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(20)));
    }

    private static void Put(ZipArchive zip, string name, byte[] data)
    {
        var e = zip.CreateEntry(name, CompressionLevel.NoCompression); // PNG is already compressed
        using var s = e.Open();
        s.Write(data);
    }

    private static byte[] Read(ZipArchiveEntry e)
    {
        if (e.Length > MaxEntryBytes) throw new InvalidDataException("A part of this photo file is too large.");
        var buf = new byte[e.Length];
        try
        {
            using var s = e.Open();
            s.ReadExactly(buf);
        }
        catch (EndOfStreamException) { throw new InvalidDataException("A part of this photo file is cut short."); }
        return buf;
    }
}
