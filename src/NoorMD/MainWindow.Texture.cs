using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
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
                    return TextureForPage(recipe);
                }
                case "texture.render":
                {
                    // A preview: 256 while a slider moves, 512 once it settles.
                    var recipe = TextureRecipeFrom(p);
                    var size = (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "size") ?? 512) <= 256 ? 256 : 512;
                    var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(recipe.ToJson() + "|" + size)))[..20].ToLowerInvariant();
                    var watch = Stopwatch.StartNew();
                    lock (_texturePreviews)
                        if (_texturePreviews.ContainsKey(key)) return new { key, size, maps = TextureMaps.Names.ToDictionary(m => m, m => $"/_texture/{key}/{m}.png"), ms = 0L };
                    Dictionary<string, byte[]> pngs;
                    await TextureGate.WaitAsync();
                    try
                    {
                        pngs = await Task.Run(() =>
                        {
                            var maps = TextureEngine.Render(recipe, size);
                            return TextureMaps.Names.AsParallel().Select(m => (m, png: maps.Png(m, fast: true))).ToDictionary(x => x.m, x => x.png);
                        });
                    }
                    finally { TextureGate.Release(); }
                    lock (_texturePreviews)
                    {
                        if (!_texturePreviews.ContainsKey(key)) { _texturePreviews[key] = pngs; _texturePreviewOrder.Enqueue(key); }
                        while (_texturePreviewOrder.Count > 4) _texturePreviews.Remove(_texturePreviewOrder.Dequeue());
                    }
                    return new { key, size, maps = TextureMaps.Names.ToDictionary(m => m, m => $"/_texture/{key}/{m}.png"), ms = watch.ElapsedMilliseconds };
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
                    var maps = await Task.Run(() => TextureEngine.Render(recipe, size));
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
                    return new { recipe = TextureForPage(TextureRecipe.FromJson(await File.ReadAllTextAsync(dlg.FileName))) };
                }
                default: throw new BridgeError($"Unknown command \"{req.Type}\".");
            }
        }
        catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
        catch (JsonException ex) { throw new BridgeError("The recipe can't be read: " + ex.Message); }
    }
}
