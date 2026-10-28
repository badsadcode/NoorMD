using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Host;
using NoorMD.Media;
using NoorMD.Ui;

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
    private GalleryOrganizer? _galleryOrganizer;
    private readonly HashSet<string> _convertFolders = new(StringComparer.OrdinalIgnoreCase);
    private GalleryOrganizer Organizer => _galleryOrganizer ??= new GalleryOrganizer(Gallery);
    // "thumbs2": previews made before preview.21 could be upside down (top-down thumbnails from Affinity); they are made again.
    private static string ThumbFolder => Path.Combine(App.Paths.Local, "Gallery", "thumbs2");
    private static bool _oldThumbsCleared;

    private static void ClearOldThumbs()
    {
        if (_oldThumbsCleared) return;
        _oldThumbsCleared = true;
        var old = Path.Combine(App.Paths.Local, "Gallery", "thumbs");
        if (Directory.Exists(old)) _ = Task.Run(() => { try { Directory.Delete(old, true); } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { Log.Error("Removing old Gallery previews failed", ex); } });
    }

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
        if (!thumb && ImageFormats.IsWeb(img.Path))
        {
            // Read into memory: a stream handed to WebView2 stays open until it is collected, and an open file blocks
            // renaming or moving its folder. Only very big files (over 80 MB) are streamed.
            System.IO.Stream stream = new FileInfo(img.Path).Length <= 80L * 1024 * 1024
                ? new MemoryStream(File.ReadAllBytes(img.Path))
                : new FileStream(img.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            e.Response = env.CreateWebResourceResponse(stream, 200, "OK", $"Content-Type: {ImageFormats.ContentType(img.Path)}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
            return true;
        }
        // Making a preview can take a moment for a big photo: off the UI thread, a few at a time. Work files (PSD, Affinity,
        // TIFF…) are shown through a big preview in the viewer too, since the browser can't show them.
        var deferral = e.GetDeferral();
        _ = ServeThumbAsync(img, thumb ? ThumbSize : PreviewSize, e, env, deferral);
        return true;
    }

    public const int PreviewSize = 1600;

    private async Task ServeThumbAsync(GalleryImage img, int size, CoreWebView2WebResourceRequestedEventArgs e, CoreWebView2Environment env, CoreWebView2Deferral deferral)
    {
        try
        {
            var file = await Task.Run(async () =>
            {
                await ThumbGate.WaitAsync();
                try { return EnsureThumb(img, size); } finally { ThumbGate.Release(); }
            });
            e.Response = file != null
                ? env.CreateWebResourceResponse(new MemoryStream(await File.ReadAllBytesAsync(file)), 200, "OK", $"Content-Type: {(file.EndsWith(".png") ? "image/png" : "image/jpeg")}\r\nCache-Control: max-age=600\r\nX-Content-Type-Options: nosniff")
                : ImageFormats.IsWeb(img.Path)
                    // A format Windows can't decode here (some AVIF/WebP): the page shows the picture itself instead.
                    ? env.CreateWebResourceResponse(new MemoryStream(await File.ReadAllBytesAsync(img.Path)), 200, "OK", $"Content-Type: {ImageFormats.ContentType(img.Path)}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff")
                    : env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain"); // no preview: the page shows the format's name
        }
        catch (Exception ex)
        {
            Log.Error("Gallery preview failed: " + img.Path, ex);
            try { e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain"); } catch (Exception) { /* the request is gone */ }
        }
        finally { deferral.Complete(); }
    }

    /// <summary>
    /// A preview file for a picture, at most <paramref name="size"/> pixels on its long side (made or remade when the picture
    /// changed), or null. Windows' own decoders first (JPEG, PNG, TIFF, HEIC with its extension…); for work files the
    /// thumbnail their program gives Explorer (Affinity, Photoshop), or the small preview inside a PSD.
    /// </summary>
    internal static string? EnsureThumb(GalleryImage img, int size = ThumbSize)
    {
        ClearOldThumbs();
        var src = new FileInfo(img.Path);
        var stem = Path.Combine(ThumbFolder, img.Id + (size == ThumbSize ? "" : "-" + size));
        foreach (var ext in new[] { ".jpg", ".png" })
            if (File.Exists(stem + ext) && File.GetLastWriteTimeUtc(stem + ext) >= src.LastWriteTimeUtc) return stem + ext;
        Directory.CreateDirectory(ThumbFolder);
        if (Decode(img.Path, size) is { } frame)
        {
            var alpha = Path.GetExtension(img.Path).ToLowerInvariant() is ".png" or ".gif" or ".webp" or ".ico" or ".tif" or ".tiff"; // may be see-through
            return Write(stem + (alpha ? ".png" : ".jpg"), alpha ? new PngBitmapEncoder() : new JpegBitmapEncoder { QualityLevel = 85 }, frame);
        }
        if (ShellIcons.Thumbnail(img.Path, size) is { } png) return WriteBytes(stem + ".png", png);
        if (img.Path.EndsWith(".psd", StringComparison.OrdinalIgnoreCase) || img.Path.EndsWith(".psb", StringComparison.OrdinalIgnoreCase))
            if (PsdPreview.Jpeg(img.Path) is { } jpeg) return WriteBytes(stem + ".jpg", jpeg);
        return null;
    }

    private static string WriteBytes(string file, byte[] bytes)
    {
        var tmp = file + ".tmp";
        File.WriteAllBytes(tmp, bytes);
        File.Move(tmp, file, overwrite: true);
        return file;
    }

    private static string? Write(string file, BitmapEncoder enc, BitmapSource frame)
    {
        enc.Frames.Add(BitmapFrame.Create(frame));
        var tmp = file + ".tmp";
        using (var outFs = File.Create(tmp)) enc.Save(outFs);
        File.Move(tmp, file, overwrite: true);
        return file;
    }

    /// <summary>Decodes a picture with Windows' imaging, scaled down to <paramref name="size"/> and turned upright; null if Windows can't read it.</summary>
    private static BitmapSource? Decode(string path, int size)
    {
        try
        {
            BitmapSource frame;
            ushort orientation = 1;
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                var decoder = BitmapDecoder.Create(fs, BitmapCreateOptions.IgnoreColorProfile | BitmapCreateOptions.DelayCreation, BitmapCacheOption.None);
                var first = decoder.Frames[0];
                // The orientation may be stored as a short or a long (TagLib writes it either way when a photo is turned).
                // The orientation may be stored as a short or (written by older tools) a long; read the JPEG itself when Windows finds none.
                ushort? found = null;
                try { if (first.Metadata is BitmapMetadata md && md.GetQuery("/app1/ifd/{ushort=274}") is { } o and (ushort or short or uint or int)) found = (ushort)Convert.ToInt32(o); } catch (Exception) { /* no EXIF */ }
                orientation = found ?? (PictureRotate.CanRotateLosslessly(path) ? (ushort)PictureRotate.Orientation(path) : (ushort)1);
                var w = first.PixelWidth; var h = first.PixelHeight;
                var scale = Math.Min(1.0, (double)size / Math.Max(w, h));
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
            // Mirrored ones (2, 4, 5, 7) are flipped first.
            var (angle, flip) = orientation switch { 2 => (0, true), 3 => (180, false), 4 => (180, true), 5 => (270, true), 6 => (90, false), 7 => (90, true), 8 => (270, false), _ => (0, false) };
            if (angle != 0 || flip)
            {
                var t = new TransformGroup();
                if (flip) t.Children.Add(new ScaleTransform(-1, 1));
                if (angle != 0) t.Children.Add(new RotateTransform(angle));
                frame = new TransformedBitmap(frame, t);
            }
            frame.Freeze();
            return frame;
        }
        catch (Exception ex) when (ex is NotSupportedException or FileFormatException or IOException or InvalidOperationException or ArgumentException or OverflowException or System.Runtime.InteropServices.COMException)
        {
            return null;
        }
    }

    /// <summary>A 9×8 grey version of a picture's preview, for finding look-alikes.</summary>
    internal static byte[]? Grey9x8(GalleryImage img)
    {
        var file = EnsureThumb(img);
        if (file == null) return null;
        try
        {
            var bmp = BitmapFrame.Create(new MemoryStream(File.ReadAllBytes(file)), BitmapCreateOptions.IgnoreColorProfile, BitmapCacheOption.OnLoad);
            var small = new TransformedBitmap(bmp, new ScaleTransform(9.5 / bmp.PixelWidth, 8.5 / bmp.PixelHeight)); // 9×8 or a pixel more
            var grey = new FormatConvertedBitmap(small, PixelFormats.Gray8, null, 0);
            if (grey.PixelWidth < 9 || grey.PixelHeight < 8) return null;
            var all = new byte[grey.PixelWidth * grey.PixelHeight];
            grey.CopyPixels(all, grey.PixelWidth, 0);
            var outp = new byte[72];
            for (var y = 0; y < 8; y++) for (var x = 0; x < 9; x++) outp[y * 9 + x] = all[y * grey.PixelWidth + x];
            return outp;
        }
        catch (Exception ex) when (ex is NotSupportedException or FileFormatException or IOException or ArgumentException or System.Runtime.InteropServices.COMException) { return null; }
    }

    private object GalleryStatus() => new
    {
        folders = Gallery.Folders(), count = Gallery.Count(), albums = Gallery.Albums().Select(AlbumForPage),
        slideshows = Gallery.Slideshows().Select(SlideshowForPage), scanning = _galleryScan is { IsCompleted: false },
        formats = Gallery.Formats().Select(f => new { format = f.Format, count = f.Count }), editors = Editors().Select(e => new { name = e.Name, detected = e.Detected }),
        tags = Gallery.Tags().Select(t => new { tag = t.Tag, count = t.Count }), months = Gallery.Months().Select(m => new { month = m.Month, count = m.Count }), labels = GalleryLibrary.Labels,
    };

    // ------------------------------------------------------------------ editing programs ("Open in Affinity Photo")

    private sealed record PictureEditor(string Name, string Path, bool Detected);

    /// <summary>Picture editors: the ones found on this PC (Affinity, Photoshop, GIMP, Krita, Paint.NET) and the ones you added.</summary>
    private List<PictureEditor> Editors()
    {
        var list = new List<PictureEditor>();
        try
        {
            var saved = Gallery.GetState("editors");
            if (saved != null && JsonSerializer.Deserialize<List<string[]>>(saved) is { } items)
                foreach (var it in items) if (it.Length == 2 && File.Exists(it[1])) list.Add(new PictureEditor(it[0], it[1], false));
        }
        catch (JsonException) { /* start again */ }
        foreach (var (name, path) in DetectEditors())
            if (!list.Any(e => string.Equals(e.Path, path, StringComparison.OrdinalIgnoreCase))) list.Add(new PictureEditor(name, path, true));
        return list;
    }

    private static IEnumerable<(string Name, string Path)> DetectEditors()
    {
        var pf = new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) }.Where(d => d.Length > 0).Distinct();
        foreach (var root in pf)
        {
            foreach (var (name, rel) in new[] { ("Affinity Photo 2", @"Affinity\Photo 2\Photo.exe"), ("Affinity Photo", @"Affinity\Photo\Photo.exe"), ("Affinity Designer 2", @"Affinity\Designer 2\Designer.exe"),
                ("Affinity (all apps)", @"Affinity\Affinity\Affinity.exe"), ("Krita", @"Krita (x64)\bin\krita.exe"), ("Paint.NET", @"paint.net\paintdotnet.exe") })
                if (File.Exists(Path.Combine(root, rel))) yield return (name, Path.Combine(root, rel));
            var adobe = Path.Combine(root, "Adobe");
            if (Directory.Exists(adobe))
                foreach (var d in Directory.EnumerateDirectories(adobe, "Adobe Photoshop*").OrderByDescending(x => x))
                    if (File.Exists(Path.Combine(d, "Photoshop.exe"))) { yield return (Path.GetFileName(d), Path.Combine(d, "Photoshop.exe")); break; }
            if (Directory.Exists(root))
                foreach (var d in Directory.EnumerateDirectories(root, "GIMP*"))
                    foreach (var exe in Directory.EnumerateFiles(Path.Combine(d, "bin"), "gimp-*.exe").Where(f => !f.Contains("console", StringComparison.OrdinalIgnoreCase)).Take(1))
                        yield return ("GIMP", exe);
        }
    }

    private void SaveEditors(IEnumerable<PictureEditor> mine) =>
        Gallery.SetState("editors", JsonSerializer.Serialize(mine.Where(e => !e.Detected).Select(e => new[] { e.Name, e.Path }).ToList()));

    private void OpenInEditor(IReadOnlyList<GalleryImage> imgs, PictureEditor ed)
    {
        var psi = new ProcessStartInfo(ed.Path) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(ed.Path)! };
        foreach (var i in imgs.Take(50)) psi.ArgumentList.Add(i.Path); // each file its own argument: names with spaces stay whole
        Process.Start(psi);
        Log.Info($"Gallery: opened {imgs.Count} picture(s) in {ed.Name}");
    }

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
                        NoorMD.Core.Bridge.Json.OptLong(p, "slideshow"), req.GetString("sort", 20) ?? "taken", !p.TryGetProperty("descending", out var d) || d.ValueKind != JsonValueKind.False, Format: req.GetString("format", 20),
                        MinRating: (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "minRating") ?? 0), Label: req.GetString("label", 20), Tag: req.GetString("tag", 80), Month: req.GetString("month", 7));
                    return Gallery.Query(q).Select(ImageForPage);
                }
                case "gallery.addFolder":
                {
                    var dlg = new OpenFolderDialog { Title = "Add a picture folder (subfolders become albums)", Multiselect = false };
                    Ui.NativeCursor.Restore();
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
                case "gallery.rename":
                    Organizer.Rename(Long(p, "id"), req.GetString("name", 240) ?? "");
                    return new { status = GalleryStatus(), undo = true };
                case "gallery.renameSeries":
                    Organizer.RenameSeries(Ids(p, "ids"), req.GetString("name", 200) ?? "", (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "start") ?? 1));
                    return new { status = GalleryStatus(), undo = true };
                case "gallery.move":
                {
                    var done = Organizer.Move(Ids(p, "ids"), req.GetString("folder", 4000) ?? "");
                    return new { moved = done.Count, status = GalleryStatus(), undo = true };
                }
                case "gallery.undo":
                {
                    var back = Organizer.Undo();
                    // Pictures that had left the Gallery (moved out) come back into it: a rescan finds them again.
                    if (back.Any(m => Gallery.Get(m.Id) == null)) await ScanGalleryAsync(Gallery.Folders().Select(f => f.Id).ToList());
                    return new { restored = back.Count, status = GalleryStatus() };
                }
                case "gallery.places":
                {
                    // Albums you can move pictures to: every Gallery folder and the folders inside it.
                    var roots = Gallery.Folders();
                    return Gallery.PlaceFolders().Select(f =>
                    {
                        var root = roots.Where(r => f.StartsWith(r.Path, StringComparison.OrdinalIgnoreCase)).OrderByDescending(r => r.Path.Length).FirstOrDefault();
                        var label = root == null ? f : Path.Combine(Path.GetFileName(Path.TrimEndingDirectorySeparator(root.Path)), Path.GetRelativePath(root.Path, f) is "." ? "" : Path.GetRelativePath(root.Path, f)).TrimEnd('\\', '/').Replace('\\', '/');
                        return new { path = f, label, key = NoorMD.Media.MusicLibrary.PathKey(f) };
                    });
                }
                case "gallery.album.create":
                {
                    var made = Organizer.CreateAlbum(req.GetString("parent", 4000) ?? "", req.GetString("name", 200) ?? "");
                    return new { path = made, key = NoorMD.Media.MusicLibrary.PathKey(made) };
                }
                case "gallery.delete":
                {
                    var imgs = Ids(p, "ids").Select(id => Gallery.Get(id)).Where(i => i != null && File.Exists(i.Path)).Cast<GalleryImage>().ToList();
                    if (imgs.Count == 0) return new { deleted = 0, status = GalleryStatus() };
                    var files = imgs.Select(i => i.Path).ToList();
                    var recycle = RecycleBin.CanRecycle(files);
                    var what = imgs.Count == 1 ? $"“{Path.GetFileName(files[0])}”" : $"{imgs.Count} pictures";
                    Ui.NativeCursor.Restore();
                    if (recycle
                        ? !ThemedDialog.Confirm(this, $"Delete {what}?", "The files are moved to the Windows Recycle Bin, where you can restore them.", "Move to Recycle Bin", imgs.Count == 1 ? files[0] : null)
                        : !ThemedDialog.Confirm(this, $"Delete {what} for good?", "This drive has no Recycle Bin, so they can't be restored afterwards.", "Delete permanently", imgs.Count == 1 ? files[0] : null))
                        return new { cancelled = true };
                    await Task.Run(() => RecycleBin.Send(files, permanently: !recycle));
                    Gallery.Forget(imgs.Select(i => i.Id));
                    return new { deleted = imgs.Count, status = GalleryStatus() };
                }
                case "gallery.revealFolder":
                {
                    var folder = req.GetString("folder", 4000) ?? "";
                    if (!Directory.Exists(folder) || !Gallery.IsInside(folder)) throw new BridgeError("That album is not in the Gallery.");
                    Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = false, ArgumentList = { folder } });
                    return null;
                }
                case "gallery.album.rename":
                {
                    var to = Organizer.RenameAlbum(req.GetString("folder", 4000) ?? "", req.GetString("name", 200) ?? "");
                    return new { path = to, key = NoorMD.Media.MusicLibrary.PathKey(to), status = GalleryStatus(), undo = true };
                }
                case "gallery.copyTo" or "gallery.moveTo":
                {
                    var copy = req.Type == "gallery.copyTo";
                    var ids = Ids(p, "ids");
                    if (ids.Count == 0) return new { cancelled = true };
                    var dlg = new OpenFolderDialog { Title = copy ? $"Copy {ids.Count} picture(s) to… (you can make a new folder here)" : $"Move {ids.Count} picture(s) to… (you can make a new folder here)" };
                    Ui.NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    var dest = dlg.FolderName;
                    var inside = Gallery.IsInside(dest);
                    int count;
                    if (copy) count = (await Task.Run(() => Organizer.Copy(ids, dest))).Count;
                    else count = (await Task.Run(() => Organizer.Move(ids, dest, anywhere: true))).Count;
                    if (inside) await ScanGalleryAsync(Gallery.Folders().Where(f => IsUnder(dest, f.Path)).Select(f => f.Id).ToList());
                    return new { count, folder = dest, inside, status = GalleryStatus(), undo = !copy };
                }
                case "gallery.zip":
                {
                    var imgs = Ids(p, "ids").Select(id => Gallery.Get(id)).Where(i => i != null && File.Exists(i.Path)).Cast<GalleryImage>().ToList();
                    if (imgs.Count == 0) throw new BridgeError("Choose some pictures to pack.");
                    var dlg = new SaveFileDialog { Title = $"Pack {imgs.Count} picture(s) into a ZIP", Filter = "ZIP archive (*.zip)|*.zip", FileName = (req.GetString("name", 120) is { Length: > 0 } n ? n : "Pictures") + ".zip", OverwritePrompt = true, AddExtension = true, DefaultExt = ".zip" };
                    Ui.NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    var count = await Task.Run(() => GalleryZip.Create(imgs.Select(i => i.Path).ToList(), dlg.FileName));
                    return new { path = dlg.FileName, count };
                }
                case "gallery.editors": return Editors().Select(e => new { name = e.Name, detected = e.Detected });
                case "gallery.editor.add":
                {
                    var dlg = new OpenFileDialog { Title = "Choose your picture editor (for example Affinity Photo or Photoshop)", Filter = "Programs (*.exe)|*.exe", InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), DereferenceLinks = true };
                    Ui.NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    var list = Editors();
                    if (!list.Any(e => string.Equals(e.Path, dlg.FileName, StringComparison.OrdinalIgnoreCase)))
                    {
                        var name = FileVersionInfo.GetVersionInfo(dlg.FileName).FileDescription is { Length: > 0 } d ? d : Path.GetFileNameWithoutExtension(dlg.FileName);
                        list.Add(new PictureEditor(name.Length > 60 ? name[..60] : name, dlg.FileName, false));
                        SaveEditors(list);
                    }
                    return new { editors = Editors().Select(e => new { name = e.Name, detected = e.Detected }) };
                }
                case "gallery.editor.remove":
                {
                    var list = Editors();
                    var i = (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "index") ?? -1);
                    if (i >= 0 && i < list.Count && !list[i].Detected) { list.RemoveAt(i); SaveEditors(list); }
                    return new { editors = Editors().Select(e => new { name = e.Name, detected = e.Detected }) };
                }
                case "gallery.toTexture":
                {
                    // Pictures chosen in the Gallery, for photo layers in the Texture Bench: allowed for it and measured.
                    var imgs = Ids(p, "ids").Take(12).Select(id => Gallery.Get(id)).Where(i => i != null && File.Exists(i.Path)).Cast<GalleryImage>().ToList();
                    if (imgs.Count == 0) throw new BridgeError("Those pictures are not there any more.");
                    var list = new List<object>();
                    var skipped = new List<string>();
                    foreach (var img in imgs)
                    {
                        var full = Path.GetFullPath(img.Path);
                        _textureImageFiles.Add(full);
                        var read = await Task.Run(() => LoadTextureImage(full));
                        if (read == null) { skipped.Add(img.Name); continue; }
                        list.Add(new { path = full, name = img.Name, width = read.Width, height = read.Height });
                    }
                    return new { pictures = list, skipped };
                }
                case "gallery.openWith":
                {
                    var imgs = Ids(p, "ids").Select(id => Gallery.Get(id)).Where(i => i != null && File.Exists(i.Path)).Cast<GalleryImage>().ToList();
                    if (imgs.Count == 0) throw new BridgeError("Those pictures are not there any more.");
                    var how = req.GetString("how", 20) ?? "default";
                    if (how == "default")
                        foreach (var i in imgs.Take(20)) Process.Start(new ProcessStartInfo(i.Path) { UseShellExecute = true });
                    else if (how == "choose")
                        Process.Start(new ProcessStartInfo("rundll32.exe") { UseShellExecute = false, ArgumentList = { "shell32.dll,OpenAs_RunDLL", imgs[0].Path } }); // Windows' "Open with" list
                    else
                    {
                        var list = Editors();
                        var i = (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "editor") ?? -1);
                        if (i < 0 || i >= list.Count) throw new BridgeError("That program is no longer in the list.");
                        OpenInEditor(imgs, list[i]);
                    }
                    return null;
                }
                case "gallery.duplicates":
                {
                    var similar = NoorMD.Core.Bridge.Json.IsTrue(p, "similar");
                    var scope = Gallery.Query(new GalleryQuery(AlbumKey: req.GetString("album", 2000), Limit: 20000));
                    var progress = new Progress<int>(n => PushEvent("gallery.dupProgress", new { done = n, total = scope.Count }));
                    var groups = await Task.Run(() =>
                    {
                        var exact = GalleryDuplicates.Exact(scope, progress);
                        if (!similar) return exact.Select(g => (Kind: "same", Items: g)).ToList();
                        var inExact = new HashSet<long>(exact.SelectMany(g => g).Select(i => i.Id));
                        var hashed = new List<(GalleryImage, ulong)>();
                        var n = 0;
                        foreach (var img in scope.Where(i => !inExact.Contains(i.Id)))
                        {
                            if (Grey9x8(img) is { } g) hashed.Add((img, GalleryDuplicates.DHash(g)));
                            if (++n % 25 == 0) ((IProgress<int>)progress).Report(n);
                        }
                        return exact.Select(g => (Kind: "same", Items: g)).Concat(GalleryDuplicates.Similar(hashed).Select(g => (Kind: "alike", Items: g))).ToList();
                    });
                    return groups.Select(g => new { kind = g.Kind, items = g.Items.OrderByDescending(i => i.Width * (long)i.Height).ThenByDescending(i => i.Size).Select(ImageForPage) });
                }
                case "gallery.rating":
                    Gallery.SetRating(Ids(p, "ids"), (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "stars") ?? 0));
                    return null;
                case "gallery.label":
                    Gallery.SetLabel(Ids(p, "ids"), req.GetString("label", 20));
                    return null;
                case "gallery.tags.add":
                {
                    var tags = p.TryGetProperty("tags", out var ta) && ta.ValueKind == JsonValueKind.Array
                        ? ta.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).Take(20).ToList() : [];
                    Gallery.AddTags(Ids(p, "ids"), tags);
                    return new { status = GalleryStatus(), images = Ids(p, "ids").Select(Gallery.Get).OfType<GalleryImage>().Select(ImageForPage) };
                }
                case "gallery.tags.remove":
                    Gallery.RemoveTag(Ids(p, "ids"), req.GetString("tag", 80) ?? "");
                    return new { status = GalleryStatus(), images = Ids(p, "ids").Select(Gallery.Get).OfType<GalleryImage>().Select(ImageForPage) };
                case "gallery.rotate":
                {
                    var clockwise = !p.TryGetProperty("clockwise", out var cw) || cw.ValueKind != JsonValueKind.False;
                    var turned = new List<object>();
                    var refused = new List<string>();
                    foreach (var id in Ids(p, "ids").Take(500))
                    {
                        var img = Gallery.Get(id);
                        if (img == null || !File.Exists(img.Path)) continue;
                        try { await Task.Run(() => TurnPicture(img.Path, clockwise)); }
                        catch (Exception ex) when (ex is not OutOfMemoryException)
                        {
                            // One damaged picture doesn't stop the others (and those already turned are still reported).
                            if (ex is not ArgumentException) Log.Error("Gallery: turning failed: " + img.Path, ex);
                            refused.Add($"{Path.GetFileName(img.Path)}: {ex.Message}");
                            continue;
                        }
                        if (Gallery.Refresh(id) is { } now) turned.Add(ImageForPage(now));
                    }
                    if (turned.Count == 0 && refused.Count > 0) throw new BridgeError(refused[0]);
                    return new { images = turned, refused };
                }
                case "gallery.convert":
                {
                    var ids = Ids(p, "ids");
                    if (ids.Count == 0) return new { cancelled = true };
                    var opts = PictureConvert.Clean(new ConvertOptions(req.GetString("format", 10) ?? "keep", (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "maxSide") ?? 0),
                        (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "quality") ?? 88), req.GetString("suffix", 60) ?? ""));
                    string? dest = null;
                    if (req.GetString("where", 10) != "beside")
                    {
                        var dlg = new OpenFolderDialog { Title = $"Save the {ids.Count} converted picture(s) in… (you can make a new folder here)" };
                        Ui.NativeCursor.Restore();
                        if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                        dest = dlg.FolderName;
                    }
                    var (made, failed) = await Task.Run(() => ConvertPictures(ids, opts, dest));
                    var folders = made.Select(Path.GetDirectoryName).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                    foreach (var f in folders) if (f != null) _convertFolders.Add(f);
                    var inside = folders.Any(f => f != null && Gallery.IsInside(f));
                    if (inside) await ScanGalleryAsync(Gallery.Folders().Where(f => folders.Any(d => d != null && IsUnder(d, f.Path))).Select(f => f.Id).ToList());
                    if (made.Count == 0 && failed.Count > 0) throw new BridgeError(failed[0]);
                    return new { count = made.Count, folder = folders.Count == 1 ? folders[0] : null, failed, inside, status = GalleryStatus() };
                }
                case "gallery.convert.reveal":
                {
                    // Only a folder this session's conversions wrote to.
                    var folder = req.GetString("folder", 4000) ?? "";
                    if (!_convertFolders.Contains(folder)) throw new BridgeError("That is not a folder the converted pictures went to.");
                    if (!Directory.Exists(folder)) throw new BridgeError("That folder is not there any more.");
                    Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = false, ArgumentList = { folder } });
                    return null;
                }
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

    private readonly SemaphoreSlim _galleryScanGate = new(1, 1);

    private async Task ScanGalleryAsync(IReadOnlyList<long> folderIds)
    {
        await _galleryScanGate.WaitAsync(); // one scan at a time: two at once would both add the same new files
        try
        {
            _galleryScan = Task.Run(() =>
            {
                var found = 0; var added = 0; var missing = 0;
                foreach (var id in folderIds)
                {
                    try { var r = Gallery.Scan(id); found += r.Found; added += r.Added; missing += r.Missing; }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or Microsoft.Data.Sqlite.SqliteException) { Log.Error("Gallery scan failed", ex); }
                }
                Dispatcher.BeginInvoke(() => PushEvent("gallery.scanned", new { found, added, missing }));
            });
            await _galleryScan;
        }
        finally { _galleryScanGate.Release(); }
    }

    /// <summary>
    /// Turns a picture a quarter turn without losing anything: a JPEG through its EXIF orientation (the picture data is not
    /// touched); PNG, BMP and TIFF are saved again, which keeps every pixel. Other formats are refused.
    /// </summary>
    private static void TurnPicture(string path, bool clockwise)
    {
        if (PictureRotate.CanRotateLosslessly(path)) { PictureRotate.Jpeg(path, clockwise); return; }
        var ext = Path.GetExtension(path).ToLowerInvariant();
        if (ext is not (".png" or ".bmp" or ".tif" or ".tiff")) throw new ArgumentException("This format can't be turned here; turn it in your picture editor.");
        var bytes = File.ReadAllBytes(path);
        if (ext == ".png" && bytes.AsSpan().IndexOf("acTL"u8) is >= 0 and < 4096) throw new ArgumentException("Animated PNGs can't be turned here; turn it in your picture editor.");
        BitmapFrame frame;
        using (var ms = new MemoryStream(bytes))
        {
            var dec = BitmapDecoder.Create(ms, BitmapCreateOptions.PreservePixelFormat | BitmapCreateOptions.IgnoreColorProfile, BitmapCacheOption.OnLoad);
            if (dec.Frames.Count != 1) throw new ArgumentException("Pictures with several pages can't be turned here.");
            frame = dec.Frames[0];
        }
        BitmapMetadata? meta = null;
        try { meta = (frame.Metadata as BitmapMetadata)?.Clone(); } catch (Exception ex) when (ex is NotSupportedException or InvalidOperationException) { }
        BitmapEncoder enc = ext switch { ".png" => new PngBitmapEncoder(), ".bmp" => new BmpBitmapEncoder(), _ => new TiffBitmapEncoder() };
        if (enc is TiffBitmapEncoder tiff)
        {
            // Photoshop layers live in a private TIFF tag that can't be carried over: leave those to Photoshop.
            if (Query(meta, "/ifd/{ushort=37724}") != null) throw new ArgumentException("This TIFF has Photoshop layers; turn it in Photoshop.");
            tiff.Compression = Query(meta, "/ifd/{ushort=259}") is { } comp ? Convert.ToInt32(comp) switch
            {
                1 => TiffCompressOption.None, 5 => TiffCompressOption.Lzw, 8 or 32946 => TiffCompressOption.Zip, 32773 => TiffCompressOption.Rle, _ => TiffCompressOption.Default,
            } : TiffCompressOption.Default;
            // The pixels are turned now: an orientation in the file would turn them a second time.
            try { if (Query(meta, "/ifd/{ushort=274}") != null) meta!.SetQuery("/ifd/{ushort=274}", (ushort)1); } catch (Exception ex) when (ex is NotSupportedException or InvalidOperationException or ArgumentException) { }
        }
        var rotated = new TransformedBitmap(frame, new RotateTransform(clockwise ? 90 : 270));
        rotated.Freeze();
        // Kept: the colour profile and the picture's details (text, EXIF/XMP); without them only if this format won't take them back.
        WriteFrame(path, enc, rotated, meta, frame.ColorContexts);
    }

    private static object? Query(BitmapMetadata? md, string query)
    {
        try { return md?.GetQuery(query); } catch (Exception ex) when (ex is NotSupportedException or InvalidOperationException or ArgumentException or System.Runtime.InteropServices.COMException) { return null; }
    }

    /// <summary>Writes a picture with its metadata and colour profile, falling back step by step when the encoder refuses them.</summary>
    private static void WriteFrame(string file, BitmapEncoder enc, BitmapSource pixels, BitmapMetadata? meta, System.Collections.ObjectModel.ReadOnlyCollection<ColorContext>? colors)
    {
        var attempts = new (BitmapMetadata?, System.Collections.ObjectModel.ReadOnlyCollection<ColorContext>?)[] { (meta, colors), (null, colors), (null, null) };
        Exception? last = null;
        foreach (var (m, c) in attempts)
        {
            var e = (BitmapEncoder)Activator.CreateInstance(enc.GetType())!;
            if (e is JpegBitmapEncoder je && enc is JpegBitmapEncoder src) je.QualityLevel = src.QualityLevel;
            if (e is TiffBitmapEncoder te && enc is TiffBitmapEncoder ts) te.Compression = ts.Compression;
            try
            {
                e.Frames.Add(BitmapFrame.Create(pixels, null, m, c));
                var tmp = file + ".tmp";
                using (var outFs = File.Create(tmp)) e.Save(outFs);
                File.Move(tmp, file, overwrite: true);
                return;
            }
            catch (Exception ex) when (ex is InvalidOperationException or NotSupportedException or ArgumentException or System.Runtime.InteropServices.COMException)
            {
                last = ex;
                try { File.Delete(file + ".tmp"); } catch (IOException) { }
            }
        }
        throw new IOException("The picture could not be saved: " + last?.Message, last);
    }

    /// <summary>The colour profile a picture carries (Display P3, Adobe RGB…), so a converted copy looks the same.</summary>
    private static System.Collections.ObjectModel.ReadOnlyCollection<ColorContext>? SourceColors(string path)
    {
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var f = BitmapDecoder.Create(fs, BitmapCreateOptions.IgnoreColorProfile | BitmapCreateOptions.DelayCreation, BitmapCacheOption.None).Frames[0];
            return f.ColorContexts is { Count: > 0 } c ? c : null;
        }
        catch (Exception ex) when (ex is NotSupportedException or FileFormatException or IOException or InvalidOperationException or ArgumentException or System.Runtime.InteropServices.COMException) { return null; }
    }

    private static bool IsUnder(string path, string root)
    {
        var r = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        var p = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
        return p.Equals(r, StringComparison.OrdinalIgnoreCase) || p.StartsWith(r + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Makes converted copies (format, size, quality) in <paramref name="dest"/>, or next to each picture in a “Converted”
    /// folder. The originals are not touched and nothing is overwritten. Reports progress to the page.
    /// </summary>
    private (List<string> Made, List<string> Failed) ConvertPictures(IReadOnlyList<long> ids, ConvertOptions o, string? dest)
    {
        var made = new List<string>();
        var failed = new List<string>();
        var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var done = 0;
        var lastPush = DateTime.MinValue;
        foreach (var id in ids.Distinct().Take(5000))
        {
            var img = Gallery.Get(id);
            if (img != null && File.Exists(img.Path))
            {
                var name = Path.GetFileName(img.Path);
                try
                {
                    var folder = dest ?? Path.Combine(Path.GetDirectoryName(img.Path)!, "Converted");
                    Directory.CreateDirectory(folder);
                    var ext = PictureConvert.Extension(img.Path, o.Format);
                    var outPath = PictureConvert.FreePath(folder, Path.GetFileNameWithoutExtension(img.Path) + o.Suffix, ext, taken);
                    var frame = Decode(img.Path, o.MaxSide > 0 ? o.MaxSide : int.MaxValue) ?? throw new NotSupportedException("Windows can't read this format here; export it from its program.");
                    BitmapEncoder enc = ext switch
                    {
                        ".jpg" => new JpegBitmapEncoder { QualityLevel = o.Quality },
                        ".png" => new PngBitmapEncoder(),
                        ".bmp" => new BmpBitmapEncoder(),
                        _ => new TiffBitmapEncoder(),
                    };
                    if (ext is ".jpg" or ".bmp") frame = OnWhite(frame); // no see-through in these: transparent parts become white, not black
                    WriteFrame(outPath, enc, frame, null, ext == ".bmp" ? null : SourceColors(img.Path));
                    if (ext == ".jpg") PictureConvert.KeepDate(outPath, img.TakenUtc);
                    File.SetLastWriteTimeUtc(outPath, File.GetLastWriteTimeUtc(img.Path));
                    made.Add(outPath);
                }
                catch (Exception ex) when (ex is NotSupportedException or IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or FileFormatException or System.Runtime.InteropServices.COMException)
                {
                    failed.Add($"{name}: {ex.Message}");
                }
            }
            done++;
            if ((DateTime.UtcNow - lastPush).TotalMilliseconds > 250 || done == ids.Count)
            {
                lastPush = DateTime.UtcNow;
                var (d, t) = (done, ids.Count);
                Dispatcher.BeginInvoke(() => PushEvent("gallery.convertProgress", new { done = d, total = t }));
            }
        }
        Log.Info($"Gallery: converted {made.Count} picture(s), {failed.Count} not");
        return (made, failed);
    }

    /// <summary>A picture with see-through parts put onto white (for JPEG and BMP).</summary>
    private static BitmapSource OnWhite(BitmapSource frame)
    {
        var f = frame.Format;
        var alpha = f == PixelFormats.Bgra32 || f == PixelFormats.Pbgra32 || f == PixelFormats.Rgba64 || f == PixelFormats.Prgba64 || f == PixelFormats.Rgba128Float
            || f == PixelFormats.Prgba128Float || (frame.Palette?.Colors.Any(c => c.A < 255) ?? false);
        if (!alpha) return frame;
        var pb = new FormatConvertedBitmap(frame, PixelFormats.Pbgra32, null, 0);
        var stride = pb.PixelWidth * 4;
        var px = new byte[stride * pb.PixelHeight];
        pb.CopyPixels(px, stride, 0);
        var any = false;
        for (var i = 3; i < px.Length; i += 4)
        {
            var a = px[i];
            if (a == 255) continue;
            any = true;
            var add = (byte)(255 - a); // premultiplied: colour + white × (1 − alpha)
            px[i - 3] = (byte)Math.Min(255, px[i - 3] + add); px[i - 2] = (byte)Math.Min(255, px[i - 2] + add); px[i - 1] = (byte)Math.Min(255, px[i - 1] + add);
            px[i] = 255;
        }
        if (!any) return frame;
        var flat = BitmapSource.Create(pb.PixelWidth, pb.PixelHeight, 96, 96, PixelFormats.Bgr32, null, px, stride);
        flat.Freeze();
        return flat;
    }

    private static object ImageForPage(GalleryImage i) => new
    {
        id = i.Id, name = i.Name, album = i.Album, albumKey = i.AlbumKey, size = i.Size, width = i.Width, height = i.Height,
        taken = i.TakenUtc, favorite = i.Favorite, fileName = Path.GetFileName(i.Path), folder = Path.GetDirectoryName(i.Path), format = i.Format, web = ImageFormats.IsWeb(i.Path),
        rating = i.Rating, label = i.Label, tags = i.Tags ?? [],
    };

    private static object AlbumForPage(GalleryAlbum a) => new { key = a.Key, name = a.Name, folder = a.Folder, count = a.Count, coverId = a.CoverId, latest = a.LatestUtc };

    private static object SlideshowForPage(Slideshow s) => new { id = s.Id, name = s.Name, count = s.Count, settings = JsonDocument.Parse(s.Settings).RootElement.Clone(), created = s.CreatedUtc };
}
