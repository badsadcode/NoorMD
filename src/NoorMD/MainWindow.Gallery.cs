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
                try { if (first.Metadata is BitmapMetadata md && md.GetQuery("/app1/ifd/{ushort=274}") is ushort o) orientation = o; } catch (Exception) { /* no EXIF */ }
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
            var angle = orientation switch { 3 => 180, 6 => 90, 8 => 270, _ => 0 };
            if (angle != 0) frame = new TransformedBitmap(frame, new RotateTransform(angle));
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
                        NoorMD.Core.Bridge.Json.OptLong(p, "slideshow"), req.GetString("sort", 20) ?? "taken", !p.TryGetProperty("descending", out var d) || d.ValueKind != JsonValueKind.False, Format: req.GetString("format", 20));
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
                    if (inside) await ScanGalleryAsync(Gallery.Folders().Where(f => dest.StartsWith(f.Path, StringComparison.OrdinalIgnoreCase)).Select(f => f.Id).ToList());
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

    private static object ImageForPage(GalleryImage i) => new
    {
        id = i.Id, name = i.Name, album = i.Album, albumKey = i.AlbumKey, size = i.Size, width = i.Width, height = i.Height,
        taken = i.TakenUtc, favorite = i.Favorite, fileName = Path.GetFileName(i.Path), folder = Path.GetDirectoryName(i.Path), format = i.Format, web = ImageFormats.IsWeb(i.Path),
    };

    private static object AlbumForPage(GalleryAlbum a) => new { key = a.Key, name = a.Name, folder = a.Folder, count = a.Count, coverId = a.CoverId, latest = a.LatestUtc };

    private static object SlideshowForPage(Slideshow s) => new { id = s.Id, name = s.Name, count = s.Count, settings = JsonDocument.Parse(s.Settings).RootElement.Clone(), created = s.CreatedUtc };
}
