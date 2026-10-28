using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Media;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// Texture Bench: tileable procedural materials. The page edits a recipe; the app renders its maps (the same recipe and
/// seed always give the same pixels), serves the preview maps from memory at /_texture/{key}/{map}.png, and exports PNG
/// sets for game engines with the recipe next to them. Your own presets are recipes kept in the local data folder.
/// </summary>
public partial class MainWindow
{
    private readonly Dictionary<string, Dictionary<string, byte[]>> _texturePreviews = new(StringComparer.Ordinal);
    private readonly Queue<string> _texturePreviewOrder = new();
    private readonly HashSet<string> _textureFolders = new(StringComparer.OrdinalIgnoreCase);
    private static readonly SemaphoreSlim TextureGate = new(1);
    private static string UserTextureFolder => Path.Combine(App.Paths.Local, "Texture", "Presets");
    /// <summary>Paintings made for materials in NoorSketch (a layer of the material refers to them by path).</summary>
    private static string TexturePaintingsFolder => Path.Combine(App.Paths.Local, "Texture", "Paintings");
    private const int TexturePaintingSize = 1024;

    // Image layers read only pictures you picked, or that a recipe or preset you opened names (as with Sound Bench samples).
    private readonly HashSet<string> _textureImageFiles = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, (DateTime Stamp, TextureImage Image)> _textureImageCache = new(StringComparer.OrdinalIgnoreCase);
    private const int TextureImageMax = 2048;

    private void AllowTextureImages(TextureRecipe r)
    {
        foreach (var path in r.Files()) { try { _textureImageFiles.Add(Path.GetFullPath(path)); } catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { } }
    }

    /// <summary>A picture for an image layer (at most 2048 pixels across, turned upright), or null when it can't or may not be read.</summary>
    private TextureImage? LoadTextureImage(string path)
    {
        try
        {
            var full = Path.GetFullPath(path);
            if (!_textureImageFiles.Contains(full) || !File.Exists(full)) return null;
            var stamp = File.GetLastWriteTimeUtc(full);
            lock (_textureImageCache)
                if (_textureImageCache.TryGetValue(full, out var hit) && hit.Stamp == stamp) return hit.Image;
            if (new FileInfo(full).Length > 200 * 1024 * 1024) return null;
            // A NoorSketch painting keeps its transparency (where it isn't painted); other pictures are opaque.
            var painting = full.EndsWith(".noorsketch", StringComparison.OrdinalIgnoreCase);
            BitmapSource? frame;
            if (painting)
            {
                var (sketchPng, _) = NoorMD.Core.Sketch.SketchFile.Load(full);
                frame = BitmapDecoder.Create(new MemoryStream(sketchPng), BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad).Frames[0];
            }
            else frame = Decode(full, TextureImageMax);
            if (frame == null) return null;
            var conv = new FormatConvertedBitmap(frame, painting ? PixelFormats.Bgra32 : PixelFormats.Bgr32, null, 0);
            int w = conv.PixelWidth, h = conv.PixelHeight;
            var px = new byte[w * h * 4];
            conv.CopyPixels(px, w * 4, 0);
            var rgb = new float[w * h * 3];
            for (var i = 0; i < w * h; i++) { rgb[i * 3] = px[i * 4 + 2] / 255f; rgb[i * 3 + 1] = px[i * 4 + 1] / 255f; rgb[i * 3 + 2] = px[i * 4] / 255f; }
            float[]? alpha = null;
            if (painting) { alpha = new float[w * h]; for (var i = 0; i < w * h; i++) alpha[i] = px[i * 4 + 3] / 255f; }
            var image = new TextureImage { Width = w, Height = h, Rgb = rgb, Alpha = alpha, Id = $"{full}|{stamp.Ticks}" };
            lock (_textureImageCache)
            {
                if (_textureImageCache.Count >= 6) _textureImageCache.Remove(_textureImageCache.Keys.First());
                _textureImageCache[full] = (stamp, image);
            }
            return image;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException or InvalidDataException or InvalidOperationException) { return null; }
    }

    /// <summary>
    /// Opens a painting for a material in NoorSketch, with the material (as it is without the painting) shown under
    /// it; one window per painting. Each save there goes straight back to the material.
    /// </summary>
    private async Task OpenTexturePaintingAsync(TextureRecipe under, string path)
    {
        var (_, manifest) = await Task.Run(() => NoorMD.Core.Sketch.SketchFile.Load(path));
        var size = Math.Clamp(Math.Max(manifest.Width, manifest.Height), TextureEngine.MinSize, 2048);
        var underlay = await Task.Run(() => TextureEngine.Render(under, size, LoadTextureImage).Png("albedo", fast: true));
        var open = _sketches.FirstOrDefault(w => string.Equals(w.TexturePath, path, StringComparison.OrdinalIgnoreCase));
        if (open != null) { open.UpdateUnderlay(underlay, under.Name); open.Activate(); return; }
        if (WebEnvironment == null) throw new BridgeError("The editor is still starting. Try again in a moment.");
        var w = new SketchWindow(this, path, new TexturePaint(path, under.Name, underlay)) { Owner = null };
        _sketches.Add(w);
        w.Show();
    }

    /// <summary>A painting was saved in NoorSketch: the Texture Bench renders the material with it again.</summary>
    internal void TexturePaintingSaved(string path) => PushEvent("texture.paintingChanged", new { path });

    /// <summary>
    /// After an export: the maps shown in the Gallery (their folder added if no Gallery folder holds it yet), tagged
    /// "material" and with the material's name.
    /// </summary>
    private async Task<int> AddTextureExportToGalleryAsync(string folder, IEnumerable<string> files, string material)
    {
        var holders = Gallery.Folders().Where(f => IsUnder(folder, f.Path)).Select(f => f.Id).ToList();
        if (holders.Count == 0) holders.Add(Gallery.AddFolder(folder));
        await ScanGalleryAsync(holders);
        var ids = files.Select(f => Gallery.FindByPath(f)?.Id).OfType<long>().ToList();
        if (ids.Count > 0) Gallery.AddTags(ids, ["material", material]);
        return ids.Count;
    }

    /// <summary>
    /// After an export: the recipe kept in the open Vault (Materials folder) with its paintings and a small albedo
    /// picture, so it can be found, linked from notes and opened again from the Vault.
    /// </summary>
    private async Task<string> SaveTextureToVaultAsync(TextureRecipe recipe, TextureMaps maps, string stem)
    {
        var v = _vault ?? throw new BridgeError("Open a Vault first.");
        var folder = Path.Combine(v.Root, "Materials");
        Directory.CreateDirectory(folder);
        var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var copy = await CopyPaintingsBesideAsync(recipe, folder, taken);
        var recipePath = PictureConvert.FreePath(folder, stem + ".noortex", ".json", taken);
        var picture = PictureConvert.FreePath(folder, Path.GetFileNameWithoutExtension(Path.GetFileNameWithoutExtension(recipePath)), ".png", taken);
        var albedo = await Task.Run(() => (maps.Size > 512 ? TextureEngine.Render(recipe, 512, LoadTextureImage) : maps).Png("albedo"));
        await File.WriteAllBytesAsync(picture, albedo);
        await File.WriteAllTextAsync(recipePath, copy.ToJson(), new UTF8Encoding(false));
        ScheduleRescan(0);
        return Path.GetRelativePath(v.Root, recipePath).Replace('\\', '/');
    }

    /// <summary>A copy of the recipe whose paintings are copied into the folder and named relative to it (a recipe that travels with its paintings).</summary>
    private static async Task<TextureRecipe> CopyPaintingsBesideAsync(TextureRecipe recipe, string folder, HashSet<string> taken, bool replace = false)
    {
        var copy = recipe.Clone();
        foreach (var l in copy.Layers.Where(l => l.Type == "painted" && !string.IsNullOrEmpty(l.Path) && File.Exists(l.Path)))
        {
            var source = Path.GetFullPath(l.Path!);
            var dest = ExportTarget(folder, Path.GetFileName(source), keep: !replace, taken);
            if (!string.Equals(source, dest, StringComparison.OrdinalIgnoreCase)) await Task.Run(() => File.Copy(source, dest, overwrite: true));
            l.Path = Path.GetFileName(dest);
        }
        return copy;
    }

    /// <summary>A file's place in an export: as named (replacing, after asking), or numbered beside what is there.</summary>
    private static string ExportTarget(string folder, string fileName, bool keep, HashSet<string> taken)
    {
        var path = Path.Combine(folder, fileName);
        if (!keep && taken.Add(path)) return path;
        // "x.noortex.json" numbers as "x (2).noortex.json".
        var dot = fileName.IndexOf('.', 1);
        var (stem, ext) = dot > 0 ? (fileName[..dot], fileName[dot..]) : (fileName, "");
        return PictureConvert.FreePath(folder, stem, ext, taken);
    }

    /// <summary>What each export target writes: (file suffix, what goes in it).</summary>
    private static readonly Dictionary<string, (string Suffix, string What)[]> TextureTargets = new()
    {
        ["generic"] = [("albedo", "albedo"), ("normal", "normal"), ("roughness", "roughness"), ("ao", "ao"), ("metallic", "metallic"), ("height", "height")],
        ["godot"] = [("albedo", "albedo"), ("normal", "normal"), ("roughness", "roughness"), ("metallic", "metallic"), ("ao", "ao"), ("height", "height")],
        ["unity"] = [("albedo", "albedo"), ("normal", "normal"), ("metallic_smoothness", "unity-ms"), ("ao", "ao"), ("height", "height")],
        ["unreal"] = [("basecolor", "albedo"), ("normal", "normal-dx"), ("orm", "orm"), ("height", "height")],
    };

    /// <summary>Serves /_texture/{key}/{map}.png: preview maps rendered moments ago.</summary>
    private bool TryServeTexture(Uri uri, CoreWebView2WebResourceRequestedEventArgs e, CoreWebView2Environment env)
    {
        var path = uri.AbsolutePath;
        if (!path.StartsWith("/_texture/", StringComparison.Ordinal)) return false;
        var parts = path[10..].Split('/');
        byte[]? png = null;
        if (parts.Length == 2)
            lock (_texturePreviews)
                if (_texturePreviews.TryGetValue(parts[0], out var maps)) maps.TryGetValue(Path.GetFileNameWithoutExtension(parts[1]), out png);
        e.Response = png != null
            ? env.CreateWebResourceResponse(new MemoryStream(png), 200, "OK", "Content-Type: image/png\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff")
            : env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
        return true;
    }

    private static TextureRecipe TextureRecipeFrom(JsonElement p)
    {
        if (!p.TryGetProperty("recipe", out var r) || r.ValueKind != JsonValueKind.Object) throw new BridgeError("Missing the material recipe.");
        var raw = r.GetRawText();
        if (raw.Length > 200_000) throw new BridgeError("That recipe is too big.");
        try { return TextureRecipe.FromJson(raw); }
        catch (JsonException ex) { throw new BridgeError("The recipe can't be read: " + ex.Message); }
    }

    private static JsonElement TextureForPage(TextureRecipe r) => JsonDocument.Parse(r.ToJson()).RootElement.Clone();

    private static object UserTexturePresets()
    {
        var list = new List<object>();
        if (!Directory.Exists(UserTextureFolder)) return list;
        foreach (var f in Directory.EnumerateFiles(UserTextureFolder, "*.json").OrderBy(f => f, StringComparer.CurrentCultureIgnoreCase))
        {
            try
            {
                var r = TextureRecipe.FromJson(File.ReadAllText(f));
                list.Add(new { id = "user:" + Path.GetFileName(f), family = r.Family, name = r.Name, description = "Your preset" });
            }
            catch (Exception ex) when (ex is JsonException or IOException or ArgumentException) { /* a broken file is left out */ }
        }
        return list;
    }

    private static string UserTexturePath(string id)
    {
        var file = id.StartsWith("user:", StringComparison.Ordinal) ? id[5..] : "";
        if (file.Length == 0 || file != Path.GetFileName(file) || !file.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) throw new BridgeError("Unknown preset.");
        return Path.Combine(UserTextureFolder, file);
    }

    private static readonly string[] PackSources = ["roughness", "smoothness", "ao", "metallic", "height", "zero", "one"];

    /// <summary>
    /// The files an export writes: the target's maps, without the ones left out, with the normal convention and the
    /// height's bit depth chosen, and any packed maps of your own (grey maps in R, G, B and A).
    /// </summary>
    private static List<(string Suffix, string What)> TextureOutputs(JsonElement p, string target)
    {
        if (!TextureTargets.TryGetValue(target, out var files)) throw new BridgeError("Unknown export target.");
        var skip = p.TryGetProperty("skip", out var sk) && sk.ValueKind == JsonValueKind.Array ? sk.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()!).ToHashSet() : [];
        var normal = p.TryGetProperty("normal", out var nm) && nm.ValueKind == JsonValueKind.String ? nm.GetString() : null;
        var height8 = (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "heightBits") ?? 16) == 8;
        var list = files.Where(f => !skip.Contains(f.Suffix)).Select(f => (f.Suffix, What:
            f.What is "normal" or "normal-dx" && normal is "gl" or "dx" ? (normal == "dx" ? "normal-dx" : "normal")
            : f.What == "height" && height8 ? "height8" : f.What)).ToList();
        if (p.TryGetProperty("packs", out var packs) && packs.ValueKind == JsonValueKind.Array)
            foreach (var pk in packs.EnumerateArray().Take(8))
            {
                string Src(string ch, string fallback) => pk.TryGetProperty(ch, out var v) && v.ValueKind == JsonValueKind.String && PackSources.Contains(v.GetString()) ? v.GetString()! : fallback;
                var name = NoorMD.Core.Export.ExportLayouts.Segment(pk.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() ?? "" : "");
                if (name.Length == 0) name = "packed";
                if (name.Length > 40) name = name[..40];
                var a = pk.TryGetProperty("a", out var av) && av.ValueKind == JsonValueKind.String && PackSources.Contains(av.GetString()) ? av.GetString() : "none";
                list.Add((name, $"pack:{Src("r", "zero")},{Src("g", "zero")},{Src("b", "zero")},{a}"));
            }
        if (list.Count == 0) throw new BridgeError("Choose at least one map to export.");
        return list;
    }

    private static byte[] TextureFile(TextureMaps maps, string what) => what switch
    {
        "height8" => PngWriter.Gray(maps.Size, maps.Size, maps.Height8()),
        _ when what.StartsWith("pack:", StringComparison.Ordinal) && what[5..].Split(',') is [var r, var g, var b, var a] => maps.Packed(r, g, b, a == "none" ? null : a),
        "normal-dx" => maps.Png("normal", directX: true),
        "orm" => maps.Packed("ao", "roughness", "metallic"),
        "unity-ms" => maps.Packed("metallic", "metallic", "metallic", "smoothness"),
        _ => maps.Png(what),
    };

    private async Task<object?> DispatchTextureAsync(BridgeRequest req)
    {
        var p = req.Payload;
        try
        {
            switch (req.Type)
            {
                case "texture.presets":
                    return new { builtIn = TexturePresets.All.Select(x => new { id = x.Id, family = x.Family, name = x.Name, description = x.Description }), mine = UserTexturePresets() };
                case "texture.preset":
                {
                    var id = req.GetString("id", 300) ?? "";
                    var recipe = id.StartsWith("user:", StringComparison.Ordinal) ? TextureRecipe.FromJson(await File.ReadAllTextAsync(UserTexturePath(id))) : TexturePresets.Make(id);
                    AllowTextureImages(recipe);
                    return TextureForPage(recipe);
                }
                case "texture.render":
                {
                    // A preview: 256 while a slider moves, 512 once it settles.
                    var recipe = TextureRecipeFrom(p);
                    var size = (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "size") ?? 512) <= 256 ? 256 : 512;
                    var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(recipe.ToJson() + "|" + size)))[..20].ToLowerInvariant();
                    var watch = Stopwatch.StartNew();
                    // A picture changed on disk renders afresh: its stamp is part of the key.
                    var stamps = string.Join("|", recipe.Files().Select(f => { try { return File.GetLastWriteTimeUtc(f).Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture); } catch (Exception) { return "0"; } }));
                    key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key + "|" + stamps)))[..20].ToLowerInvariant();
                    lock (_texturePreviews)
                        if (_texturePreviews.ContainsKey(key)) return new { key, size, maps = TextureMaps.Names.ToDictionary(m => m, m => $"/_texture/{key}/{m}.png"), ms = 0L, warnings = Array.Empty<string>() };
                    Dictionary<string, byte[]> pngs;
                    IReadOnlyList<string> warnings;
                    await TextureGate.WaitAsync();
                    try
                    {
                        (pngs, warnings) = await Task.Run(() =>
                        {
                            var maps = TextureEngine.Render(recipe, size, LoadTextureImage);
                            return (TextureMaps.Names.AsParallel().Select(m => (m, png: maps.Png(m, fast: true))).ToDictionary(x => x.m, x => x.png), maps.Warnings);
                        });
                    }
                    finally { TextureGate.Release(); }
                    lock (_texturePreviews)
                    {
                        if (!_texturePreviews.ContainsKey(key)) { _texturePreviews[key] = pngs; _texturePreviewOrder.Enqueue(key); }
                        while (_texturePreviewOrder.Count > 4) _texturePreviews.Remove(_texturePreviewOrder.Dequeue());
                    }
                    return new { key, size, maps = TextureMaps.Names.ToDictionary(m => m, m => $"/_texture/{key}/{m}.png"), ms = watch.ElapsedMilliseconds, warnings };
                }
                case "texture.export":
                {
                    var recipe = TextureRecipeFrom(p);
                    var size = (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "size") ?? 1024);
                    if (size is not (512 or 1024 or 2048 or 4096)) throw new BridgeError("Choose 512, 1024, 2048 or 4096 pixels.");
                    var target = req.GetString("target", 20) ?? "generic";
                    var files = TextureOutputs(p, target);
                    // Where: a folder chosen now or a game project's, arranged by the chosen layout.
                    var place = ExportPlaceFrom(p, "texture");
                    var root = ExportBase(place, $"Save the maps of “{recipe.Name}” ({size} × {size}) in… (you can make a new folder here)");
                    if (root == null) return new { cancelled = true };
                    var tokens = ExportTokens(recipe.Name, recipe.Family, size, place.Project?.Name);
                    var folder = NoorMD.Core.Export.ExportLayouts.Under(root, NoorMD.Core.Export.ExportLayouts.Folders(NoorMD.Core.Export.ExportLayouts.Expand(place.FolderPattern, tokens)));
                    var stem = NoorMD.Core.Export.ExportLayouts.FileName(tokens["name"], recipe.Name);
                    var names = files.Select(f =>
                    {
                        var t = new Dictionary<string, string>(tokens); foreach (var kv in NoorMD.Core.Export.ExportLayouts.MapTokens(f.Suffix)) t[kv.Key] = kv.Value;
                        return NoorMD.Core.Export.ExportLayouts.FileName(NoorMD.Core.Export.ExportLayouts.Expand(place.FilePattern, t), recipe.Name) + ".png";
                    }).ToList();
                    var how = AskReplace([.. names.Select(n => Path.Combine(folder, n)), Path.Combine(folder, stem + ".noortex.json")], $"“{recipe.Name}”");
                    if (how == null) return new { cancelled = true };
                    var keep = how == "keep";
                    Directory.CreateDirectory(folder);
                    var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    var maps = await Task.Run(() => TextureEngine.Render(recipe, size, LoadTextureImage));
                    var written = new List<string>();
                    for (var k = 0; k < files.Count; k++)
                    {
                        var (_, what) = files[k];
                        var path = ExportTarget(folder, names[k], keep, taken);
                        var png = await Task.Run(() => TextureFile(maps, what));
                        await File.WriteAllBytesAsync(path, png);
                        written.Add(path);
                        PushEvent("texture.exportProgress", new { done = written.Count, total = files.Count });
                    }
                    // Paintings go along, so the recipe beside the maps opens complete anywhere.
                    var travelling = await CopyPaintingsBesideAsync(recipe, folder, taken, replace: !keep);
                    var recipePath = ExportTarget(folder, stem + ".noortex.json", keep, taken);
                    await File.WriteAllTextAsync(recipePath, travelling.ToJson(), new UTF8Encoding(false));
                    _textureFolders.Add(folder);
                    Log.Info($"Texture Bench: exported {written.Count} maps of “{recipe.Name}” at {size}");
                    int? gallery = null; string? vault = null; var notes = new List<string>();
                    if (NoorMD.Core.Bridge.Json.IsTrue(p, "gallery"))
                        try { gallery = await AddTextureExportToGalleryAsync(folder, written, recipe.Name); }
                        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or Microsoft.Data.Sqlite.SqliteException) { notes.Add("Not added to the Gallery: " + ex.Message); }
                    if (NoorMD.Core.Bridge.Json.IsTrue(p, "vault"))
                    {
                        if (_vault == null) notes.Add("No Vault is open, so the recipe wasn't kept there.");
                        else
                            try { vault = await SaveTextureToVaultAsync(recipe, maps, stem); }
                            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { notes.Add("Not kept in the Vault: " + ex.Message); }
                    }
                    return new { folder, files = written.Select(Path.GetFileName), recipe = Path.GetFileName(recipePath), project = place.Project?.Name, relative = Path.GetRelativePath(root, folder).Replace('\\', '/'), paintings = travelling.Layers.Count(l => l.Type == "painted" && l.Path != null), gallery, vault, notes };
                }
                case "texture.reveal":
                {
                    var folder = req.GetString("folder", 4000) ?? "";
                    if (!_textureFolders.Contains(folder) || !Directory.Exists(folder)) throw new BridgeError("That is not a folder the maps went to.");
                    Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = false, ArgumentList = { folder } });
                    return null;
                }
                case "texture.save":
                {
                    var recipe = TextureRecipeFrom(p);
                    // Only pictures already allowed are kept, so a preset can't smuggle in another path.
                    foreach (var l in recipe.Layers)
                        if (l.Type is "image" or "painted" && !string.IsNullOrEmpty(l.Path) && !_textureImageFiles.Contains(Path.GetFullPath(l.Path))) l.Path = null;
                    Directory.CreateDirectory(UserTextureFolder);
                    var file = NoorMD.Core.Documents.DocumentFile.SafeFileName(recipe.Name, ".json");
                    var path = Path.Combine(UserTextureFolder, file);
                    var replaced = File.Exists(path);
                    await File.WriteAllTextAsync(path, recipe.ToJson(), new UTF8Encoding(false));
                    return new { id = "user:" + file, replaced, mine = UserTexturePresets() };
                }
                case "texture.delete":
                    File.Delete(UserTexturePath(req.GetString("id", 300) ?? ""));
                    return new { mine = UserTexturePresets() };
                case "texture.open":
                {
                    var dlg = new OpenFileDialog { Title = "Open a material recipe", Filter = "Material recipes (*.noortex.json;*.json)|*.noortex.json;*.json", CheckFileExists = true };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    if (new FileInfo(dlg.FileName).Length > 200_000) throw new BridgeError("That file is too big for a material recipe.");
                    var opened = TextureRecipe.FromJson(await File.ReadAllTextAsync(dlg.FileName)).FindImagesBeside(Path.GetDirectoryName(Path.GetFullPath(dlg.FileName))!);
                    AllowTextureImages(opened);
                    return new { recipe = TextureForPage(opened) };
                }
                case "texture.paint.new":
                {
                    // A new, empty painting for the material (transparent), kept with the app's data, and opened in NoorSketch.
                    var recipe = TextureRecipeFrom(p);
                    Directory.CreateDirectory(TexturePaintingsFolder);
                    var stem = Path.GetFileNameWithoutExtension(NoorMD.Core.Documents.DocumentFile.SafeFileName(recipe.Name + " painting", ".noorsketch"));
                    var path = PictureConvert.FreePath(TexturePaintingsFolder, stem, ".noorsketch", new HashSet<string>(StringComparer.OrdinalIgnoreCase));
                    var blank = PngWriter.Rgba(TexturePaintingSize, TexturePaintingSize, new byte[TexturePaintingSize * TexturePaintingSize * 4]);
                    await Task.Run(() => NoorMD.Core.Sketch.SketchFile.Save(path, blank, "transparent"));
                    _textureImageFiles.Add(path);
                    await OpenTexturePaintingAsync(recipe, path);
                    return new { path, name = Path.GetFileName(path) };
                }
                case "texture.paint.edit":
                {
                    // The page sends the material without this painting, to show under it while you paint.
                    var recipe = TextureRecipeFrom(p);
                    var path = Path.GetFullPath(req.GetString("path", 4000) ?? "");
                    if (!path.EndsWith(".noorsketch", StringComparison.OrdinalIgnoreCase)) throw new BridgeError("Only NoorSketch paintings (.noorsketch) can be painted on here.");
                    if (!_textureImageFiles.Contains(path) || !File.Exists(path)) throw new BridgeError("That painting can't be found. It may have been moved or deleted.");
                    try { await OpenTexturePaintingAsync(recipe, path); }
                    catch (InvalidDataException ex) { throw new BridgeError(ex.Message); }
                    return null;
                }
                case "texture.image.pick":
                {
                    // A picture for an image layer: a photo of a surface, a scan, a painting; read here, never changed.
                    var dlg = new OpenFileDialog { Title = "Choose a picture for the material", Filter = "Pictures (*.jpg;*.jpeg;*.png;*.bmp;*.tif;*.tiff;*.webp;*.gif)|*.jpg;*.jpeg;*.png;*.bmp;*.tif;*.tiff;*.webp;*.gif|All files|*.*", CheckFileExists = true };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    var full = Path.GetFullPath(dlg.FileName);
                    _textureImageFiles.Add(full);
                    var image = await Task.Run(() => LoadTextureImage(full)) ?? throw new BridgeError("That picture can't be read.");
                    return new { path = full, name = Path.GetFileName(full), width = image.Width, height = image.Height };
                }
                default: throw new BridgeError($"Unknown command \"{req.Type}\".");
            }
        }
        catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
        catch (JsonException ex) { throw new BridgeError("The recipe can't be read: " + ex.Message); }
    }
}
