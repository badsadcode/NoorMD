using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Media;

namespace NoorMD;

/// <summary>
/// Gallery: the pictures in folders you add (subfolders are albums), with favourites and slideshows. Pictures are served
/// to the page by id from /_img/{id}; small previews are made once with Windows' image decoders and kept in the local data
/// folder (/_thumb/{id}). The pictures themselves are never changed.
/// </summary>
public partial class MainWindow
{
    private GalleryLibrary? _galleryLib;
    private Task? _galleryScan;
    private static readonly SemaphoreSlim ThumbGate = new(3);
    public const int ThumbSize = 360;

    private GalleryLibrary Gallery => _galleryLib ??= new GalleryLibrary(Path.Combine(App.Paths.Local, "Gallery", "library.db"));
    private static string ThumbFolder => Path.Combine(App.Paths.Local, "Gallery", "thumbs");

    /// <summary>Serves /_img/{id} (the picture) and /_thumb/{id} (a small preview, made on first use).</summary>
    private bool TryServeGallery(Uri uri, CoreWebView2WebResourceRequestedEventArgs e, CoreWebView2Environment env)
    {
        var path = uri.AbsolutePath;
        var thumb = path.StartsWith("/_thumb/", StringComparison.Ordinal);
        if (!thumb && !path.StartsWith("/_img/", StringComparison.Ordinal)) return false;
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2 || !long.TryParse(parts[1], out var id) || Gallery.Get(id) is not { } img || !File.Exists(img.Path))
        {
            e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
            return true;
        }
        if (!thumb)
        {
            var stream = new FileStream(img.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            e.Response = env.CreateWebResourceResponse(stream, 200, "OK", $"Content-Type: {ImageFormats.ContentType(img.Path)}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
            return true;
        }
        // Making a preview can take a moment for a big photo: off the UI thread, a few at a time.
        var deferral = e.GetDeferral();
        _ = ServeThumbAsync(img, e, env, deferral);
        return true;
    }

    private async Task ServeThumbAsync(GalleryImage img, CoreWebView2WebResourceRequestedEventArgs e, CoreWebView2Environment env, CoreWebView2Deferral deferral)
    {
        try
        {
            var file = await Task.Run(async () =>
            {
                await ThumbGate.WaitAsync();
                try { return EnsureThumb(img); } finally { ThumbGate.Release(); }
            });
            e.Response = file != null
                ? env.CreateWebResourceResponse(new MemoryStream(await File.ReadAllBytesAsync(file)), 200, "OK", $"Content-Type: {(file.EndsWith(".png") ? "image/png" : "image/jpeg")}\r\nCache-Control: max-age=600\r\nX-Content-Type-Options: nosniff")
                // A format Windows can't decode here (some AVIF/WebP): the page shows the picture itself instead.
                : env.CreateWebResourceResponse(new FileStream(img.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete), 200, "OK", $"Content-Type: {ImageFormats.ContentType(img.Path)}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
        }
        catch (Exception ex)
        {
            Log.Error("Gallery preview failed: " + img.Path, ex);
            try { e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain"); } catch (Exception) { /* the request is gone */ }
        }
        finally { deferral.Complete(); }
    }

    /// <summary>The preview file for a picture (made or remade when the picture changed), or null if it can't be decoded.</summary>
    internal static string? EnsureThumb(GalleryImage img)
    {
        var src = new FileInfo(img.Path);
        var alpha = img.Path.EndsWith(".png", StringComparison.OrdinalIgnoreCase) || img.Path.EndsWith(".gif", StringComparison.OrdinalIgnoreCase) || img.Path.EndsWith(".webp", StringComparison.OrdinalIgnoreCase);
        var file = Path.Combine(ThumbFolder, img.Id + (alpha ? ".png" : ".jpg"));
        if (File.Exists(file) && File.GetLastWriteTimeUtc(file) >= src.LastWriteTimeUtc) return file;
        try
        {
            BitmapSource frame;
            ushort orientation = 1;
            using (var fs = new FileStream(img.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                var decoder = BitmapDecoder.Create(fs, BitmapCreateOptions.IgnoreColorProfile | BitmapCreateOptions.DelayCreation, BitmapCacheOption.None);
                var first = decoder.Frames[0];
                try { if (first.Metadata is BitmapMetadata md && md.GetQuery("/app1/ifd/{ushort=274}") is ushort o) orientation = o; } catch (Exception) { /* no EXIF */ }
                var w = first.PixelWidth; var h = first.PixelHeight;
                var scale = Math.Min(1.0, (double)ThumbSize / Math.Max(w, h));
                fs.Position = 0;
                var bi = new BitmapImage();
                bi.BeginInit();
                bi.CacheOption = BitmapCacheOption.OnLoad;
                bi.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
                bi.StreamSource = fs;
                if (w >= h) bi.DecodePixelWidth = Math.Max(1, (int)Math.Round(w * scale)); else bi.DecodePixelHeight = Math.Max(1, (int)Math.Round(h * scale));
                bi.EndInit();
                frame = bi;
            }
            // Turn the preview the way the camera was held (the browser does the same for the full picture).
            var angle = orientation switch { 3 => 180, 6 => 90, 8 => 270, _ => 0 };
            if (angle != 0) frame = new TransformedBitmap(frame, new RotateTransform(angle));
            frame.Freeze();
            BitmapEncoder enc = alpha ? new PngBitmapEncoder() : new JpegBitmapEncoder { QualityLevel = 82 };
            enc.Frames.Add(BitmapFrame.Create(frame));
            Directory.CreateDirectory(ThumbFolder);
            var tmp = file + ".tmp";
            using (var outFs = File.Create(tmp)) enc.Save(outFs);
            File.Move(tmp, file, overwrite: true);
            return file;
        }
        catch (Exception ex) when (ex is NotSupportedException or FileFormatException or IOException or InvalidOperationException or ArgumentException or OverflowException or System.Runtime.InteropServices.COMException)
        {
            return null;
        }
    }

    private object GalleryStatus() => new
    {
        folders = Gallery.Folders(), count = Gallery.Count(), albums = Gallery.Albums().Select(AlbumForPage),
        slideshows = Gallery.Slideshows().Select(SlideshowForPage), scanning = _galleryScan is { IsCompleted: false },
    };

    private async Task<object?> DispatchGalleryAsync(BridgeRequest req)
    {
        var p = req.Payload;
        try
        {
            switch (req.Type)
            {
                case "gallery.status": return GalleryStatus();
                case "gallery.query":
                {
                    var q = new GalleryQuery(req.GetString("search", 200), req.GetString("filter", 20) ?? "all", req.GetString("album", 2000),
                        NoorMD.Core.Bridge.Json.OptLong(p, "slideshow"), req.GetString("sort", 20) ?? "taken", !p.TryGetProperty("descending", out var d) || d.ValueKind != JsonValueKind.False);
                    return Gallery.Query(q).Select(ImageForPage);
                }
                case "gallery.addFolder":
                {
                    var dlg = new OpenFolderDialog { Title = "Add a picture folder (subfolders become albums)", Multiselect = false };
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    var id = Gallery.AddFolder(dlg.FolderName);
                    await ScanGalleryAsync([id]);
                    return GalleryStatus();
                }
                case "gallery.removeFolder":
                    Gallery.RemoveFolder(Long(p, "id"));
                    return GalleryStatus();
                case "gallery.rescan":
                    await ScanGalleryAsync(Gallery.Folders().Select(f => f.Id).ToList());
                    return GalleryStatus();
                case "gallery.favorite":
                    Gallery.SetFavorite(Ids(p, "ids"), NoorMD.Core.Bridge.Json.IsTrue(p, "on"));
                    return null;
                case "gallery.insert":
                {
                    var img = Gallery.Get(Long(p, "id")) ?? throw new BridgeError("That picture is no longer in the Gallery.");
                    if (!File.Exists(img.Path)) throw new BridgeError($"“{img.Path}” is not there any more.");
                    var s = TryTabFrom(req) ?? ActiveSession ?? throw new BridgeError("Open a document to put the picture into.");
                    return new { inserted = InsertPicture(s, img.Path, img.Name), document = s.FileName };
                }
                case "gallery.reveal":
                {
                    var img = Gallery.Get(Long(p, "id")) ?? throw new BridgeError("That picture is no longer in the Gallery.");
                    if (!File.Exists(img.Path)) throw new BridgeError($"“{img.Path}” is not there any more.");
                    Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{img.Path}\"") { UseShellExecute = false });
                    return null;
                }
                case "gallery.slideshow.create":
                {
                    var id = Gallery.CreateSlideshow(req.GetString("name", 200) ?? "", Ids(p, "ids"), SettingsJson(p));
                    return new { id, status = GalleryStatus() };
                }
                case "gallery.slideshow.update":
                    Gallery.UpdateSlideshow(Long(p, "id"), req.GetString("name", 200), p.TryGetProperty("settings", out _) ? SettingsJson(p) : null);
                    if (p.TryGetProperty("ids", out _)) Gallery.SetItems(Long(p, "id"), Ids(p, "ids"));
                    return GalleryStatus();
                case "gallery.slideshow.add":
                    Gallery.AddItems(Long(p, "id"), Ids(p, "ids"));
                    return GalleryStatus();
                case "gallery.slideshow.delete":
                    Gallery.DeleteSlideshow(Long(p, "id"));
                    return GalleryStatus();
                case "gallery.session.get": return Gallery.GetState("session");
                case "gallery.session.save":
                {
                    var json = p.TryGetProperty("state", out var st) && st.ValueKind == JsonValueKind.Object ? st.GetRawText() : "{}";
                    if (json.Length > 4000) throw new BridgeError("Gallery state is too large.");
                    Gallery.SetState("session", json);
                    return null;
                }
                default:
                    throw new BridgeError($"Unknown command \"{req.Type}\".");
            }
        }
        catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
    }

    private static string SettingsJson(JsonElement p) =>
        p.TryGetProperty("settings", out var s) && s.ValueKind == JsonValueKind.Object ? s.GetRawText() : "{}";

    private async Task ScanGalleryAsync(IReadOnlyList<long> folderIds)
    {
        if (_galleryScan is { IsCompleted: false }) await _galleryScan;
        _galleryScan = Task.Run(() =>
        {
            var found = 0; var added = 0; var missing = 0;
            foreach (var id in folderIds)
            {
                try { var r = Gallery.Scan(id); found += r.Found; added += r.Added; missing += r.Missing; }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { Log.Error("Gallery scan failed", ex); }
            }
            Dispatcher.BeginInvoke(() => PushEvent("gallery.scanned", new { found, added, missing }));
        });
        await _galleryScan;
    }

    private static object ImageForPage(GalleryImage i) => new
    {
        id = i.Id, name = i.Name, album = i.Album, albumKey = i.AlbumKey, size = i.Size, width = i.Width, height = i.Height,
        taken = i.TakenUtc, favorite = i.Favorite, fileName = Path.GetFileName(i.Path), folder = Path.GetDirectoryName(i.Path),
    };

    private static object AlbumForPage(GalleryAlbum a) => new { key = a.Key, name = a.Name, folder = a.Folder, count = a.Count, coverId = a.CoverId, latest = a.LatestUtc };

    private static object SlideshowForPage(Slideshow s) => new { id = s.Id, name = s.Name, count = s.Count, settings = JsonDocument.Parse(s.Settings).RootElement.Clone(), created = s.CreatedUtc };
}
