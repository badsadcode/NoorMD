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
            var frame = Decode(full, TextureImageMax);
            if (frame == null) return null;
            var bgr = new FormatConvertedBitmap(frame, PixelFormats.Bgr32, null, 0);
            int w = bgr.PixelWidth, h = bgr.PixelHeight;
            var px = new byte[w * h * 4];
            bgr.CopyPixels(px, w * 4, 0);
            var rgb = new float[w * h * 3];
            for (var i = 0; i < w * h; i++) { rgb[i * 3] = px[i * 4 + 2] / 255f; rgb[i * 3 + 1] = px[i * 4 + 1] / 255f; rgb[i * 3 + 2] = px[i * 4] / 255f; }
            var image = new TextureImage { Width = w, Height = h, Rgb = rgb, Id = $"{full}|{stamp.Ticks}" };
            lock (_textureImageCache)
            {
                if (_textureImageCache.Count >= 6) _textureImageCache.Remove(_textureImageCache.Keys.First());
                _textureImageCache[full] = (stamp, image);
            }
            return image;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException) { return null; }
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

    private static byte[] TextureFile(TextureMaps maps, string what) => what switch
    {
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
                    if (!TextureTargets.TryGetValue(target, out var files)) throw new BridgeError("Unknown export target.");
                    var dlg = new OpenFolderDialog { Title = $"Save the maps of “{recipe.Name}” ({size} × {size}) in… (you can make a new folder here)" };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    var folder = dlg.FolderName;
                    var stem = Path.GetFileNameWithoutExtension(NoorMD.Core.Documents.DocumentFile.SafeFileName(recipe.Name.Replace(' ', '_'), ".png"));
                    var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    var maps = await Task.Run(() => TextureEngine.Render(recipe, size, LoadTextureImage));
                    var written = new List<string>();
                    foreach (var (suffix, what) in files)
                    {
                        var path = PictureConvert.FreePath(folder, $"{stem}_{suffix}", ".png", taken);
                        var png = await Task.Run(() => TextureFile(maps, what));
                        await File.WriteAllBytesAsync(path, png);
                        written.Add(path);
                        PushEvent("texture.exportProgress", new { done = written.Count, total = files.Length });
                    }
                    var recipePath = PictureConvert.FreePath(folder, stem + ".noortex", ".json", taken);
                    await File.WriteAllTextAsync(recipePath, recipe.ToJson(), new UTF8Encoding(false));
                    _textureFolders.Add(folder);
                    Log.Info($"Texture Bench: exported {written.Count} maps of “{recipe.Name}” at {size}");
                    return new { folder, files = written.Select(Path.GetFileName), recipe = Path.GetFileName(recipePath) };
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
                        if (l.Type == "image" && !string.IsNullOrEmpty(l.Path) && !_textureImageFiles.Contains(Path.GetFullPath(l.Path))) l.Path = null;
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
