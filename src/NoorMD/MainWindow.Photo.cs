using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using NoorMD.Core.Bridge;
using NoorMD.Core.Photo;
using NoorMD.Core.Sprite;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// NoorPhoto (docs/NOORPHOTO_PLAN.md): the page edits the picture (layers, painting, filters); the app opens and saves
/// files: .noorphoto (everything kept), PSD (layers and masks, for other programs), pictures (PNG, JPEG, WebP, BMP, GIF,
/// TIFF) and the exports the page flattens. Only files you choose, or opened here before (File › Open recent), are read.
/// </summary>
public partial class MainWindow
{
    private const long PhotoMaxPicture = 512L * 1024 * 1024;
    private static string PhotoFolder => Path.Combine(App.Paths.Local, "Photo");
    private static readonly string[] PhotoPictureKinds = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"];

    private static object PhotoWire(PhotoDoc doc) => JsonDocument.Parse(doc.ToJson()).RootElement.Clone();

    /// <summary>A .noorphoto, a PSD or a picture as NoorPhoto opens it: the photo (layers), or the picture's bytes for the page to decode.</summary>
    private static object PhotoOpenPath(string path)
    {
        var name = Path.GetFileName(path);
        var ext = Path.GetExtension(path).ToLowerInvariant();
        try
        {
            if (ext == PhotoFile.Extension)
            {
                var doc = PhotoFile.Load(path);
                AddPhotoRecent(path);
                return new { photo = PhotoWire(doc), path, name, notes = Array.Empty<string>() };
            }
            if (ext == ".psd")
            {
                if (new FileInfo(path).Length > PhotoMaxPicture * 2) throw new BridgeError("That PSD is too large to open here.");
                var (doc, notes) = PsdFile.Read(File.ReadAllBytes(path));
                AddPhotoRecent(path);
                return new { photo = PhotoWire(doc), path, name, notes };
            }
            if (!PhotoPictureKinds.Contains(ext)) throw new BridgeError("NoorPhoto opens .noorphoto, PSD and pictures (PNG, JPEG, WebP, BMP, GIF, TIFF).");
            var picture = PhotoPicture(path);
            AddPhotoRecent(path);
            return new { picture, path, name, notes = Array.Empty<string>() };
        }
        catch (InvalidDataException ex) { throw new BridgeError(ex.Message); }
    }

    /// <summary>
    /// A picture for the page: the file itself for the kinds the page decodes (exactly, turned by its EXIF), a PNG
    /// made here for TIFF.
    /// </summary>
    private static object PhotoPicture(string path)
    {
        var info = new FileInfo(path);
        if (info.Length > PhotoMaxPicture) throw new BridgeError("That picture is too large.");
        var ext = info.Extension.ToLowerInvariant();
        if (ext is ".tif" or ".tiff")
        {
            try
            {
                var frame = BitmapDecoder.Create(new Uri(info.FullName), BitmapCreateOptions.PreservePixelFormat | BitmapCreateOptions.IgnoreColorProfile, BitmapCacheOption.OnLoad).Frames[0];
                var conv = new FormatConvertedBitmap(frame, PixelFormats.Bgra32, null, 0);
                int w = conv.PixelWidth, h = conv.PixelHeight;
                if (w > PhotoDoc.MaxSide || h > PhotoDoc.MaxSide) throw new BridgeError($"A picture is at most {PhotoDoc.MaxSide} pixels a side; that one is {w} × {h}.");
                var px = new byte[w * h * 4];
                conv.CopyPixels(px, w * 4, 0);
                for (var i = 0; i < w * h; i++) (px[i * 4], px[i * 4 + 2]) = (px[i * 4 + 2], px[i * 4]);
                return new { png = Convert.ToBase64String(SpritePng.Encode(w, h, px, System.IO.Compression.CompressionLevel.Fastest)) };
            }
            catch (Exception ex) when (ex is NotSupportedException or FileFormatException or ArgumentException or OverflowException) { throw new BridgeError("That TIFF can't be read."); }
        }
        var mime = ext switch { ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".webp" => "image/webp", ".bmp" => "image/bmp", ".gif" => "image/gif", _ => "application/octet-stream" };
        return new { data = Convert.ToBase64String(File.ReadAllBytes(path)), mime };
    }

    /// <summary>Pictures opened or saved here, newest first: File › Open recent (only these are opened by path).</summary>
    private static string PhotoRecentFile => Path.Combine(PhotoFolder, "recent.json");
    private static List<string> PhotoRecent()
    {
        try { return JsonSerializer.Deserialize<List<string>>(File.ReadAllText(PhotoRecentFile)) ?? []; }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { return []; }
    }
    private static void AddPhotoRecent(string path)
    {
        try
        {
            var full = Path.GetFullPath(path);
            var list = PhotoRecent().Where(x => !string.Equals(x, full, StringComparison.OrdinalIgnoreCase)).Prepend(full).Take(15).ToList();
            Directory.CreateDirectory(PhotoFolder);
            NoorMD.Core.Documents.AtomicFile.WriteAllText(PhotoRecentFile, JsonSerializer.Serialize(list));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* the list is a convenience */ }
    }

    /// <summary>The photo the page sent; for a PSD, each layer's picture with its live filters applied (the page sends those as "baked").</summary>
    private static PhotoDoc PhotoFrom(JsonElement p, bool baked)
    {
        if (!p.TryGetProperty("photo", out var s) || s.ValueKind != JsonValueKind.Object) throw new BridgeError("Missing the picture.");
        try
        {
            var json = s.GetRawText();
            if (baked)
            {
                var node = JsonNode.Parse(json)!.AsObject();
                if (node["layers"] is JsonArray layers)
                    foreach (var l in layers.OfType<JsonObject>())
                    {
                        if (l["baked"] is not JsonValue b) continue;
                        l["png"] = b.GetValue<string>(); l.Remove("baked");
                        // Styles drawn round the layer: the picture is the document's size, with its mask in it.
                        if (l["bakedWidth"] is JsonValue bw)
                        {
                            l["x"] = l["bakedX"]?.DeepClone() ?? 0; l["y"] = l["bakedY"]?.DeepClone() ?? 0; l["width"] = bw.DeepClone(); l["height"] = l["bakedHeight"]?.DeepClone();
                            l.Remove("mask"); l["kind"] = "pixel"; l["fillOpacity"] = 1;
                            foreach (var k in new[] { "bakedX", "bakedY", "bakedWidth", "bakedHeight" }) l.Remove(k);
                        }
                    }
                json = node.ToJsonString();
            }
            return PhotoDoc.FromJson(json).Checked();
        }
        catch (Exception ex) when (ex is JsonException or InvalidDataException or FormatException or InvalidOperationException) { throw new BridgeError("The picture can't be saved: " + ex.Message); }
    }

    private async Task<object?> DispatchPhotoAsync(BridgeRequest req)
    {
        var p = req.Payload;
        switch (req.Type)
        {
            case "photo.open":
            {
                var dlg = new OpenFileDialog { Title = Tr.T("Open a picture"), Filter = Tr.T("Pictures and photos (*.noorphoto;*.psd;*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff)|*.noorphoto;*.psd;*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff|NoorPhoto (*.noorphoto)|*.noorphoto|Photoshop (*.psd)|*.psd|Pictures (*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff)|*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff"), CheckFileExists = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var path = dlg.FileName;
                return await Task.Run(() => PhotoOpenPath(path));
            }
            case "photo.recent":
                return new { files = PhotoRecent().Where(File.Exists).Select(f => new { path = f, name = Path.GetFileName(f) }).ToList() };
            case "photo.openRecent":
            {
                var path = req.GetString("path", 2000);
                if (string.IsNullOrEmpty(path) || !PhotoRecent().Contains(Path.GetFullPath(path), StringComparer.OrdinalIgnoreCase)) throw new BridgeError("That picture isn't one opened here before.");
                if (!File.Exists(path)) throw new BridgeError("That picture is gone (moved or deleted).");
                return await Task.Run(() => PhotoOpenPath(path));
            }
            case "photo.openGallery":
            {
                // A picture from NoorGallery, by its id there (the Gallery's own list says where it is).
                if (!p.TryGetProperty("id", out var idEl) || !idEl.TryGetInt64(out var id)) throw new BridgeError("Which picture?");
                var img = Gallery.Get(id);
                if (img == null || !File.Exists(img.Path)) throw new BridgeError("That picture is not there any more.");
                var path = img.Path;
                return await Task.Run(() => PhotoOpenPath(path));
            }
            case "photo.place":
            {
                var dlg = new OpenFileDialog { Title = Tr.T("A picture to place as a layer"), Filter = Tr.T("Pictures (*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff)|*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff"), CheckFileExists = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var path = dlg.FileName;
                return new { picture = await Task.Run(() => PhotoPicture(path)), name = Path.GetFileNameWithoutExtension(path) };
            }
            case "photo.save":
            {
                var path = req.GetString("path", 2000);
                if (!string.IsNullOrEmpty(path) && Path.GetExtension(path).ToLowerInvariant() is not (".noorphoto" or ".psd")) path = null;
                if (string.IsNullOrEmpty(path))
                {
                    var stem = Path.GetFileNameWithoutExtension(req.GetString("name", 200) ?? "picture");
                    var dlg = new SaveFileDialog { Title = Tr.T("Save the picture"), FileName = string.IsNullOrWhiteSpace(stem) ? "picture" : stem, Filter = Tr.T("NoorPhoto: everything kept (*.noorphoto)|*.noorphoto|Photoshop (*.psd)|*.psd"), AddExtension = true };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    path = dlg.FileName;
                }
                var psd = path.EndsWith(".psd", StringComparison.OrdinalIgnoreCase);
                var doc = PhotoFrom(p, psd);
                var notes = new List<string>();
                await Task.Run(() =>
                {
                    if (psd) NoorMD.Core.Documents.AtomicFile.WriteAllBytes(path, PsdFile.Write(doc, out notes));
                    else PhotoFile.Save(path, doc);
                });
                AddPhotoRecent(path);
                return new { path, name = Path.GetFileName(path), notes };
            }
            case "photo.export":
            {
                var format = req.GetString("format", 10) ?? "png";
                var (filter, ext) = format switch
                {
                    "jpeg" => (Tr.T("JPEG (*.jpg)|*.jpg"), ".jpg"),
                    "webp" => (Tr.T("WebP (*.webp)|*.webp"), ".webp"),
                    "tiff" => (Tr.T("TIFF (*.tif)|*.tif"), ".tif"),
                    _ => (Tr.T("PNG (*.png)|*.png"), ".png"),
                };
                var data = Convert.FromBase64String(req.GetString("data", 1_400_000_000) ?? throw new BridgeError("Nothing to export."));
                var stem = Path.GetFileNameWithoutExtension(req.GetString("name", 200) ?? "picture");
                var dlg = new SaveFileDialog { Title = Tr.T("Export the picture"), FileName = (string.IsNullOrWhiteSpace(stem) ? "picture" : stem) + ext, Filter = filter, AddExtension = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var path = dlg.FileName;
                await Task.Run(() =>
                {
                    if (format != "tiff") { NoorMD.Core.Documents.AtomicFile.WriteAllBytes(path, data); return; }
                    // TIFF: the page sends a PNG; Windows writes it as TIFF (lossless, with its transparency).
                    var frame = BitmapDecoder.Create(new MemoryStream(data), BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad).Frames[0];
                    var enc = new TiffBitmapEncoder { Compression = TiffCompressOption.Zip };
                    enc.Frames.Add(BitmapFrame.Create(frame));
                    using var ms = new MemoryStream();
                    enc.Save(ms);
                    NoorMD.Core.Documents.AtomicFile.WriteAllBytes(path, ms.ToArray());
                });
                return new { path, name = Path.GetFileName(path) };
            }
            case "photo.toTexture":
            {
                // The picture for NoorMaterial: a PNG of the app's own, allowed for it (as NoorSprite does).
                var png = Convert.FromBase64String(req.GetString("png", 1_400_000_000) ?? throw new BridgeError("No picture."));
                var (w, h) = (0, 0);
                try { var d = BitmapDecoder.Create(new MemoryStream(png), BitmapCreateOptions.None, BitmapCacheOption.None).Frames[0]; w = d.PixelWidth; h = d.PixelHeight; }
                catch (Exception ex) when (ex is NotSupportedException or FileFormatException or ArgumentException) { throw new BridgeError("That isn't a picture."); }
                var name = NoorMD.Core.Documents.DocumentFile.SafeFileName(req.GetString("name", 120) is { Length: > 0 } n ? n : "picture", "");
                var folder = Path.Combine(PhotoFolder, "ToTexture");
                Directory.CreateDirectory(folder);
                var file = Path.Combine(folder, $"{name}-{DateTime.UtcNow:yyyyMMddHHmmssfff}.png");
                await File.WriteAllBytesAsync(file, png);
                _textureImageFiles.Add(Path.GetFullPath(file));
                return new { path = Path.GetFullPath(file), name = name + ".png", width = w, height = h };
            }
            case "photo.draft.save":
            {
                // The picture open now, kept in the app's own folder now and then, to bring back after a crash.
                var doc = PhotoFrom(p, false);
                Directory.CreateDirectory(PhotoFolder);
                await Task.Run(() => PhotoFile.Save(Path.Combine(PhotoFolder, "draft.noorphoto"), doc));
                await File.WriteAllTextAsync(Path.Combine(PhotoFolder, "draft.json"), JsonSerializer.Serialize(new { name = req.GetString("name", 200) ?? "", path = req.GetString("path", 2000) ?? "", savedUtc = DateTime.UtcNow }));
                return new { ok = true };
            }
            case "photo.draft.load":
            {
                var file = Path.Combine(PhotoFolder, "draft.noorphoto");
                if (!File.Exists(file)) return new { none = true };
                try
                {
                    var info = File.Exists(Path.Combine(PhotoFolder, "draft.json")) ? JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(PhotoFolder, "draft.json"))).RootElement.Clone() : default;
                    string? Field(string k) => info.ValueKind == JsonValueKind.Object && info.TryGetProperty(k, out var v) ? v.GetString() : "";
                    return new { photo = PhotoWire(await Task.Run(() => PhotoFile.Load(file))), name = Field("name"), path = Field("path"), savedUtc = File.GetLastWriteTimeUtc(file) };
                }
                catch (Exception ex) when (ex is InvalidDataException or JsonException or IOException) { return new { none = true, broken = ex.Message }; }
            }
            case "photo.draft.clear":
            {
                foreach (var f in new[] { "draft.noorphoto", "draft.json" }) { var path = Path.Combine(PhotoFolder, f); if (File.Exists(path)) File.Delete(path); }
                return new { ok = true };
            }
            default:
                throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }
}
