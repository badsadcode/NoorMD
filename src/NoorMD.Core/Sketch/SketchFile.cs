using System.Buffers.Binary;
using System.IO.Compression;
using System.Text.Json;
using NoorMD.Core.Documents;

namespace NoorMD.Core.Sketch;

public sealed record SketchManifest(string Format, int Version, int Width, int Height, string Background, DateTime ModifiedUtc, string App);

/// <summary>
/// The editable NoorSketch project format (.noorsketch): an ordinary ZIP with manifest.json and image.png. The PNG
/// holds the exact pixels (8-bit RGBA, straight alpha), so saving and reopening is pixel-identical. Files are
/// written atomically, and anything that doesn't look like a NoorSketch project is refused rather than guessed at.
/// </summary>
public static class SketchFile
{
    public const string Format = "noorsketch";
    public const int Version = 1;
    public const int MaxSide = 8192;
    public const long MaxPixels = 4096L * 4096;
    public const int MaxFileBytes = 256 * 1024 * 1024;

    private static readonly byte[] PngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

    /// <summary>Width and height from a PNG's IHDR chunk; throws if the bytes are not a PNG.</summary>
    public static (int Width, int Height) PngSize(byte[] png)
    {
        if (png.Length < 33 || !png.AsSpan(0, 8).SequenceEqual(PngSignature) || png[12] != 'I' || png[13] != 'H' || png[14] != 'D' || png[15] != 'R')
            throw new InvalidDataException("Not a PNG image.");
        return ((int)BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(16)), (int)BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(20)));
    }

    public static string? SizeProblem(int width, int height) =>
        width < 1 || height < 1 ? "The canvas must be at least 1×1 pixel."
        : width > MaxSide || height > MaxSide ? $"Each side can be at most {MaxSide} pixels."
        : (long)width * height > MaxPixels ? "The canvas is too large (at most 4096×4096 pixels in total)."
        : null;

    public static void Save(string path, byte[] png, string background)
    {
        var (w, h) = PngSize(png);
        if (SizeProblem(w, h) is { } problem) throw new InvalidDataException(problem);
        var manifest = new SketchManifest(Format, Version, w, h, background == "transparent" ? "transparent" : "white", DateTime.UtcNow, "NoorMD");
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            var m = zip.CreateEntry("manifest.json", CompressionLevel.Optimal);
            using (var s = m.Open()) JsonSerializer.Serialize(s, manifest, Settings.SettingsStore.Json);
            var img = zip.CreateEntry("image.png", CompressionLevel.NoCompression); // PNG is already compressed
            using (var s = img.Open()) s.Write(png);
        }
        AtomicFile.WriteAllBytes(path, ms.ToArray());
    }

    public static (byte[] Png, SketchManifest Manifest) Load(string path)
    {
        var info = new FileInfo(path);
        if (info.Length > MaxFileBytes) throw new InvalidDataException("The file is too large to be a NoorSketch project.");
        using var zip = ZipFile.OpenRead(path);
        var me = zip.GetEntry("manifest.json") ?? throw new InvalidDataException("This is not a NoorSketch project (manifest.json is missing).");
        var ie = zip.GetEntry("image.png") ?? throw new InvalidDataException("This NoorSketch project has no image.");
        if (me.Length > 64 * 1024 || ie.Length > MaxFileBytes) throw new InvalidDataException("This NoorSketch project is damaged.");
        SketchManifest manifest;
        using (var s = me.Open()) manifest = JsonSerializer.Deserialize<SketchManifest>(s, Settings.SettingsStore.Json) ?? throw new InvalidDataException("The project's manifest is empty.");
        if (manifest.Format != Format) throw new InvalidDataException("This is not a NoorSketch project.");
        if (manifest.Version > Version) throw new InvalidDataException($"This sketch was made by a newer NoorMD (format {manifest.Version}). Update NoorMD to open it.");
        byte[] png;
        using (var s = ie.Open())
        using (var buf = new MemoryStream())
        {
            s.CopyTo(buf);
            png = buf.ToArray();
        }
        var (w, h) = PngSize(png);
        if (w != manifest.Width || h != manifest.Height) throw new InvalidDataException("The project's image does not match its manifest.");
        if (SizeProblem(w, h) is { } problem) throw new InvalidDataException(problem);
        return (png, manifest);
    }
}
