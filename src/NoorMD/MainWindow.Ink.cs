using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using NoorMD.Core.Bridge;
using NoorMD.Core.Ink;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// NoorInk: the page draws (shapes, paths, text, the SVG itself) and makes its own PNG and PDF exports; the app opens
/// and saves files. An SVG opened here is made safe first (InkSvg.Sanitize: no scripts, no links to other files), since
/// it goes into the page's DOM. Only files you choose, or opened here before (File › Open recent), are read.
/// </summary>
public partial class MainWindow
{
    private const long InkMaxPicture = 32L * 1024 * 1024;
    private static string InkFolder => Path.Combine(App.Paths.Local, "Ink");
    private static readonly string[] InkPictureKinds = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

    /// <summary>An SVG as NoorInk opens it: the picture made safe, and what was taken out of it.</summary>
    private static object InkOpenPath(string path)
    {
        if (!path.EndsWith(".svg", StringComparison.OrdinalIgnoreCase)) throw new BridgeError("NoorInk opens SVG pictures (.svg).");
        try
        {
            if (new FileInfo(path).Length > InkSvg.MaxBytes) throw new BridgeError($"That SVG is too large to open here (it can be up to {InkSvg.MaxBytes / 1024 / 1024} MB).");
            var svg = InkSvg.Sanitize(InkSvg.Read(File.ReadAllBytes(path)), out var notes);
            AddInkRecent(path);
            return new { svg, path, name = Path.GetFileName(path), notes };
        }
        catch (InvalidDataException ex) { throw new BridgeError(ex.Message); }
    }

    /// <summary>A picture to place in the drawing: its bytes, kind and size in pixels.</summary>
    private static object InkPicture(string path)
    {
        var info = new FileInfo(path);
        var ext = info.Extension.ToLowerInvariant();
        if (!InkPictureKinds.Contains(ext)) throw new BridgeError("NoorInk places PNG, JPEG, GIF and WebP pictures.");
        if (info.Length > InkMaxPicture) throw new BridgeError($"That picture is too large to place (it can be up to {InkMaxPicture / 1024 / 1024} MB).");
        var bytes = File.ReadAllBytes(path);
        int w, h;
        try
        {
            var frame = BitmapDecoder.Create(new MemoryStream(bytes), BitmapCreateOptions.None, BitmapCacheOption.None).Frames[0];
            (w, h) = (frame.PixelWidth, frame.PixelHeight);
        }
        catch (Exception ex) when (ex is NotSupportedException or FileFormatException or ArgumentException or OverflowException or InvalidOperationException or IOException)
        {
            // Windows reads WebP only with its WebP codec installed; the size is in the file's header all the same.
            if (ext != ".webp" || WebPSize(bytes) is not { } size) throw new BridgeError("That picture can't be read.");
            (w, h) = size;
        }
        if (w <= 0 || h <= 0) throw new BridgeError("That picture can't be read.");
        var mime = ext switch { ".png" => "image/png", ".gif" => "image/gif", ".webp" => "image/webp", _ => "image/jpeg" };
        return new { data = Convert.ToBase64String(bytes), mime, name = Path.GetFileNameWithoutExtension(path), width = w, height = h };
    }

    /// <summary>A WebP's size from its header (VP8, VP8L or VP8X); null when it isn't one.</summary>
    private static (int, int)? WebPSize(byte[] b)
    {
        if (b.Length < 30 || Encoding.ASCII.GetString(b, 0, 4) != "RIFF" || Encoding.ASCII.GetString(b, 8, 4) != "WEBP") return null;
        switch (Encoding.ASCII.GetString(b, 12, 4))
        {
            case "VP8 " when b[23] == 0x9D && b[24] == 0x01 && b[25] == 0x2A:
                return ((b[26] | b[27] << 8) & 0x3FFF, (b[28] | b[29] << 8) & 0x3FFF);
            case "VP8L" when b[20] == 0x2F:
            {
                var bits = b[21] | b[22] << 8 | b[23] << 16 | b[24] << 24;
                return ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1);
            }
            case "VP8X":
                return ((b[24] | b[25] << 8 | b[26] << 16) + 1, (b[27] | b[28] << 8 | b[29] << 16) + 1);
            default:
                return null;
        }
    }

    /// <summary>Base64 bytes the page sent (an export, a PNG); a clear refusal when they aren't.</summary>
    private static byte[] InkBytes(BridgeRequest req, string name, string missing)
    {
        try { return Convert.FromBase64String(req.GetString(name, 1_400_000_000) ?? throw new BridgeError(missing)); }
        catch (FormatException) { throw new BridgeError(missing); }
    }

    /// <summary>The drawing the page sent, as SVG text; refused when missing or too large.</summary>
    private static string InkSvgFrom(JsonElement p)
    {
        if (p.ValueKind != JsonValueKind.Object || !p.TryGetProperty("svg", out var s) || s.ValueKind != JsonValueKind.String || s.GetString() is not { Length: > 0 } svg) throw new BridgeError("Missing the drawing.");
        if (svg.Length > InkSvg.MaxBytes || Encoding.UTF8.GetByteCount(svg) > InkSvg.MaxBytes) throw new BridgeError($"That drawing is too large to save (it can be up to {InkSvg.MaxBytes / 1024 / 1024} MB).");
        return svg;
    }

    /// <summary>Drawings opened or saved here, newest first: File › Open recent (only these are opened by path).</summary>
    private static string InkRecentFile => Path.Combine(InkFolder, "recent.json");
    private static List<string> InkRecent()
    {
        try { return JsonSerializer.Deserialize<List<string>>(File.ReadAllText(InkRecentFile)) ?? []; }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { return []; }
    }
    private static void AddInkRecent(string path)
    {
        try
        {
            var full = Path.GetFullPath(path);
            var list = InkRecent().Where(x => !string.Equals(x, full, StringComparison.OrdinalIgnoreCase)).Prepend(full).Take(15).ToList();
            Directory.CreateDirectory(InkFolder);
            NoorMD.Core.Documents.AtomicFile.WriteAllText(InkRecentFile, JsonSerializer.Serialize(list));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* the list is a convenience */ }
    }

    private async Task<object?> DispatchInkAsync(BridgeRequest req)
    {
        var p = req.Payload;
        switch (req.Type)
        {
            case "ink.open":
            {
                var dlg = new OpenFileDialog { Title = Tr.T("Open a drawing"), Filter = Tr.T("SVG pictures (*.svg)|*.svg"), CheckFileExists = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var path = dlg.FileName;
                return await Task.Run(() => InkOpenPath(path));
            }
            case "ink.recent":
                return new { files = InkRecent().Where(File.Exists).Select(f => new { path = f, name = Path.GetFileName(f) }).ToList() };
            case "ink.openRecent":
            {
                var path = req.GetString("path", 2000);
                if (string.IsNullOrEmpty(path) || !InkRecent().Contains(Path.GetFullPath(path), StringComparer.OrdinalIgnoreCase)) throw new BridgeError("That drawing isn't one opened here before.");
                if (!File.Exists(path)) throw new BridgeError("That drawing is gone (moved or deleted).");
                return await Task.Run(() => InkOpenPath(path));
            }
            case "ink.save":
            {
                var svg = InkSvgFrom(p);
                var path = req.GetString("path", 2000);
                if (!string.IsNullOrEmpty(path) && !path.EndsWith(".svg", StringComparison.OrdinalIgnoreCase)) path = null;
                if (string.IsNullOrEmpty(path))
                {
                    var stem = Path.GetFileNameWithoutExtension(req.GetString("name", 200) ?? "drawing");
                    var dlg = new SaveFileDialog { Title = Tr.T("Save the drawing"), FileName = string.IsNullOrWhiteSpace(stem) ? "drawing" : stem, Filter = Tr.T("SVG pictures (*.svg)|*.svg"), DefaultExt = ".svg", AddExtension = true };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    path = dlg.FileName;
                }
                await Task.Run(() => NoorMD.Core.Documents.AtomicFile.WriteAllText(path, svg));
                AddInkRecent(path);
                return new { path, name = Path.GetFileName(path) };
            }
            case "ink.export":
            {
                // The page makes the PNG or PDF; the app only asks where it goes.
                var format = req.GetString("format", 10) ?? "png";
                var (filter, ext) = format switch
                {
                    "pdf" => (Tr.T("PDF (*.pdf)|*.pdf"), ".pdf"),
                    "png" => (Tr.T("PNG (*.png)|*.png"), ".png"),
                    _ => throw new BridgeError("NoorInk exports PNG or PDF."),
                };
                var data = InkBytes(req, "data", "Nothing to export.");
                if (data.Length == 0) throw new BridgeError("Nothing to export.");
                var stem = Path.GetFileNameWithoutExtension(req.GetString("name", 200) ?? "drawing");
                var dlg = new SaveFileDialog { Title = Tr.T("Export the drawing"), FileName = (string.IsNullOrWhiteSpace(stem) ? "drawing" : stem) + ext, Filter = filter, DefaultExt = ext, AddExtension = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var path = dlg.FileName;
                await Task.Run(() => NoorMD.Core.Documents.AtomicFile.WriteAllBytes(path, data));
                return new { path, name = Path.GetFileName(path) };
            }
            case "ink.place":
            {
                var dlg = new OpenFileDialog { Title = Tr.T("A picture to place in the drawing"), Filter = Tr.T("Pictures (*.png;*.jpg;*.jpeg;*.gif;*.webp)|*.png;*.jpg;*.jpeg;*.gif;*.webp"), CheckFileExists = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var path = dlg.FileName;
                return await Task.Run(() => InkPicture(path));
            }
            case "ink.toPhoto":
            {
                // The drawing as a PNG for NoorPhoto, in the app's own folder; put on NoorPhoto's recent list so it opens there by path.
                var png = InkBytes(req, "png", "No picture.");
                if (png.Length < 8 || png[0] != 0x89 || png[1] != (byte)'P' || png[2] != (byte)'N' || png[3] != (byte)'G') throw new BridgeError("That isn't a PNG picture.");
                var name = NoorMD.Core.Documents.DocumentFile.SafeFileName(req.GetString("name", 120) is { Length: > 0 } n ? Path.GetFileNameWithoutExtension(n) : "drawing", "");
                var folder = Path.Combine(InkFolder, "ToPhoto");
                Directory.CreateDirectory(folder);
                var file = Path.GetFullPath(Path.Combine(folder, $"{name}-{DateTime.UtcNow:yyyyMMddHHmmssfff}.png"));
                await Task.Run(() => NoorMD.Core.Documents.AtomicFile.WriteAllBytes(file, png));
                AddPhotoRecent(file);
                return new { path = file, name = Path.GetFileName(file) };
            }
            case "ink.draft.save":
            {
                // The drawing open now, kept in the app's own folder now and then, to bring back after a crash.
                var svg = InkSvgFrom(p);
                Directory.CreateDirectory(InkFolder);
                await Task.Run(() => NoorMD.Core.Documents.AtomicFile.WriteAllText(Path.Combine(InkFolder, "draft.svg"), svg));
                await File.WriteAllTextAsync(Path.Combine(InkFolder, "draft.json"), JsonSerializer.Serialize(new { name = req.GetString("name", 200) ?? "", path = req.GetString("path", 2000) ?? "", savedUtc = DateTime.UtcNow }));
                return new { ok = true };
            }
            case "ink.draft.load":
            {
                var file = Path.Combine(InkFolder, "draft.svg");
                if (!File.Exists(file)) return new { none = true };
                try
                {
                    var info = File.Exists(Path.Combine(InkFolder, "draft.json")) ? JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(InkFolder, "draft.json"))).RootElement.Clone() : default;
                    string? Field(string k) => info.ValueKind == JsonValueKind.Object && info.TryGetProperty(k, out var v) ? v.GetString() : "";
                    // Made safe again: it goes back into the page's DOM just as an opened file does.
                    var svg = await Task.Run(() => InkSvg.Sanitize(InkSvg.Read(File.ReadAllBytes(file)), out _));
                    return new { svg, name = Field("name"), path = Field("path"), savedUtc = File.GetLastWriteTimeUtc(file) };
                }
                catch (Exception ex) when (ex is InvalidDataException or JsonException or IOException) { return new { none = true, broken = ex.Message }; }
            }
            case "ink.draft.clear":
            {
                foreach (var f in new[] { "draft.svg", "draft.json" }) { var path = Path.Combine(InkFolder, f); if (File.Exists(path)) File.Delete(path); }
                return new { ok = true };
            }
            default:
                throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }
}
