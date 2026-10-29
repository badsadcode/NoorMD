using System.Diagnostics;
using System.IO;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using NoorMD.Core.Bridge;
using NoorMD.Media;
using NoorMD.Media.Forge;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// NoorForge: a model textured with layers and smart masks (docs/NOORFORGE_PLAN.md). The page edits the recipe; the app
/// reads the model (only one you picked, or one an opened recipe names), bakes its maps once per size, composes the
/// layers into texture sets, and serves the textured GLB and the maps for the preview at /_forge/{key}/….
/// </summary>
public partial class MainWindow
{
    private readonly HashSet<string> _forgeFiles = new(StringComparer.OrdinalIgnoreCase);
    private (string Path, DateTime Stamp, ForgeModel Model)? _forgeModel;
    private readonly Dictionary<string, ForgeBake> _forgeBakes = new(StringComparer.Ordinal);
    private readonly Dictionary<string, TextureMaps> _forgeMaterials = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Dictionary<string, byte[]>> _forgePreviews = new(StringComparer.Ordinal);
    private readonly Queue<string> _forgePreviewOrder = new();
    private static readonly SemaphoreSlim ForgeGate = new(1);
    private const int ForgePreviewSize = 512, ForgeMaterialSize = 512;
    private static string ForgeSmartFolder => Path.Combine(App.Paths.Local, "Forge", "Smart materials");

    private static readonly string[] ForgePreviewMaps = ["basecolor", "normal", "orm", "roughness", "metallic", "height", "ao", "curvature", "mask"];

    /// <summary>The smart materials: NoorForge's, then your own.</summary>
    private static List<object> ForgeSmartList() =>
        ForgeSmart.All.Select(s => (object)new { id = s.Id, name = s.Name, description = s.Description, layers = s.Make().Select(l => l.Clamped()), mine = false })
            .Concat(ForgeUserSmart.Load(ForgeSmartFolder).Select(s => (object)new { id = s.Id, name = s.Smart.Name, description = s.Smart.Description, layers = s.Smart.Layers, mine = true })).ToList();

    private ForgeModel ForgeLoad(string path)
    {
        var full = Path.GetFullPath(path);
        if (!_forgeFiles.Contains(full)) throw new BridgeError("Open the model here first (it is read only when you pick it).");
        if (!File.Exists(full)) throw new BridgeError("The model is no longer where it was.");
        var stamp = File.GetLastWriteTimeUtc(full);
        if (_forgeModel is { } m && m.Path == full && m.Stamp == stamp) return m.Model;
        if (new FileInfo(full).Length > 512L * 1024 * 1024) throw new BridgeError("That model file is too big (over 512 MB).");
        try
        {
            var model = ForgeModel.Read(full);
            _forgeModel = (full, stamp, model);
            lock (_forgeBakes) _forgeBakes.Clear();
            return model;
        }
        catch (InvalidDataException ex) { throw new BridgeError(ex.Message); }
    }

    private TextureMaps? ForgeMaterial(string id)
    {
        lock (_forgeMaterials)
        {
            if (_forgeMaterials.TryGetValue(id, out var hit)) return hit;
            if (!TexturePresets.All.Any(p => p.Id == id)) return null;
            if (_forgeMaterials.Count >= 24) _forgeMaterials.Remove(_forgeMaterials.Keys.First());
            return _forgeMaterials[id] = TextureEngine.Render(TexturePresets.Make(id), ForgeMaterialSize);
        }
    }

    private ForgeBake ForgeBakeFor(ForgeModel model, int set, int size, ForgeRecipe r)
    {
        var key = $"{set}|{size}|{r.AoRays}|{r.AoDistance}|{r.EdgeWidth}";
        lock (_forgeBakes)
            if (_forgeBakes.TryGetValue(key, out var hit)) return hit;
        var bake = ForgeBake.Bake(model, set, size, r.BakeSettings);
        lock (_forgeBakes)
        {
            if (_forgeBakes.Count >= 16) _forgeBakes.Remove(_forgeBakes.Keys.First());
            _forgeBakes[key] = bake;
        }
        return bake;
    }

    private static ForgeRecipe ForgeRecipeFrom(JsonElement p)
    {
        if (!p.TryGetProperty("recipe", out var r) || r.ValueKind != JsonValueKind.Object) throw new BridgeError("Missing the recipe.");
        var raw = r.GetRawText();
        if (raw.Length > 32_000_000) throw new BridgeError("That recipe is too big (its strokes are too many).");
        try { return ForgeRecipe.FromJson(raw); }
        catch (JsonException ex) { throw new BridgeError("The recipe can't be read: " + ex.Message); }
    }

    /// <summary>Seven floats a texel: position, normal, part (NaN for texels outside the charts).</summary>
    private static byte[] ForgeTexels(ForgeBake bake)
    {
        var n = bake.Size * bake.Size;
        var f = new float[n * 7];
        for (var i = 0; i < n; i++)
        {
            if (bake.Covered[i] == 0) { f[i * 7] = float.NaN; continue; }
            var p = bake.Position[i]; var nm = bake.Normal[i];
            f[i * 7] = p.X; f[i * 7 + 1] = p.Y; f[i * 7 + 2] = p.Z; f[i * 7 + 3] = nm.X; f[i * 7 + 4] = nm.Y; f[i * 7 + 5] = nm.Z; f[i * 7 + 6] = bake.Part[i];
        }
        var bytes = new byte[f.Length * 4];
        Buffer.BlockCopy(f, 0, bytes, 0, bytes.Length);
        return bytes;
    }

    private static object ForgeModelInfo(string path, ForgeModel m)
    {
        var (min, max) = m.Bounds();
        return new
        {
            path, name = m.Name, triangles = m.TriangleCount, parts = m.PartNames, size = new[] { max.X - min.X, max.Y - min.Y, max.Z - min.Z },
            sets = m.Sets.Select(s => new { name = s.Name, triangles = s.TriangleCount, unwrapped = s.Unwrapped }),
        };
    }

    /// <summary>Serves /_forge/{key}/model.glb and /_forge/{key}/{set}-{map}.png: the preview made moments ago.</summary>
    private bool TryServeForge(Uri uri, CoreWebView2WebResourceRequestedEventArgs e, CoreWebView2Environment env)
    {
        var path = uri.AbsolutePath;
        if (!path.StartsWith("/_forge/", StringComparison.Ordinal)) return false;
        var parts = path[8..].Split('/');
        byte[]? data = null;
        if (parts.Length == 2)
            lock (_forgePreviews)
                if (_forgePreviews.TryGetValue(parts[0], out var files)) files.TryGetValue(parts[1], out data);
        var type = path.EndsWith(".glb", StringComparison.Ordinal) ? "model/gltf-binary" : path.EndsWith(".bin", StringComparison.Ordinal) ? "application/octet-stream" : "image/png";
        e.Response = data != null
            ? env.CreateWebResourceResponse(new MemoryStream(data), 200, "OK", $"Content-Type: {type}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff")
            : env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
        return true;
    }

    private async Task<object?> DispatchForgeAsync(BridgeRequest req)
    {
        var p = req.Payload;
        switch (req.Type)
        {
            case "forge.presets":
                return new
                {
                    smart = await Task.Run(ForgeSmartList),
                    materials = TexturePresets.All.Select(m => new { id = m.Id, name = m.Name, family = m.Family }),
                    masks = ForgeMask.Kinds, sizes = ForgeRecipe.Sizes,
                };
            case "forge.smart.save":
            {
                // The layers as a smart material of your own (the same name replaces it).
                var name = req.GetString("name", 200) ?? "";
                var recipe = ForgeRecipeFrom(p);
                if (recipe.Layers.Count == 0) throw new BridgeError("There are no layers to save.");
                string id;
                try { id = await Task.Run(() => ForgeUserSmart.Save(ForgeSmartFolder, name, req.GetString("description", 400) ?? "", recipe.Layers)); }
                catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
                return new { id, smart = ForgeSmartList() };
            }
            case "forge.smart.delete":
            {
                var id = req.GetString("id", 200) ?? "";
                var removed = await Task.Run(() => ForgeUserSmart.Delete(ForgeSmartFolder, id));
                return new { removed, smart = ForgeSmartList() };
            }
            case "forge.model.pick":
            {
                var dlg = new OpenFileDialog { Title = "Open a model to texture", Filter = "3D models (*.glb;*.obj)|*.glb;*.obj|GLB (*.glb)|*.glb|OBJ (*.obj)|*.obj", CheckFileExists = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var full = Path.GetFullPath(dlg.FileName);
                _forgeFiles.Add(full);
                var model = await Task.Run(() => ForgeLoad(full));
                return ForgeModelInfo(full, model);
            }
            case "forge.fromAsset":
            {
                // The Asset Bench's tree or rock (its closest level, as built moments ago) as the model to texture.
                var key = req.GetString("key", 80) ?? "";
                byte[]? glb;
                lock (_assetPreviews) glb = _assetPreviews.TryGetValue(key, out var lods) && lods.Length > 0 ? lods[0] : null;
                if (glb == null) throw new BridgeError("Build the tree or rock again first (it is no longer in memory).");
                var folder = Path.Combine(App.Paths.Local, "Forge", "Models");
                Directory.CreateDirectory(folder);
                var name = NoorMD.Core.Documents.DocumentFile.SafeFileName(req.GetString("name", 80) is { Length: > 0 } n ? n : "Asset", "");
                var full = Path.GetFullPath(Path.Combine(folder, name + ".glb"));
                await File.WriteAllBytesAsync(full, glb);
                _forgeFiles.Add(full);
                return ForgeModelInfo(full, await Task.Run(() => ForgeLoad(full)));
            }
            case "forge.render":
            {
                // The preview: textures at most 512 px (the export makes them at the recipe's size).
                var recipe = ForgeRecipeFrom(p);
                if (recipe.Model == null) throw new BridgeError("Open a model first.");
                // The layer whose mask is shown (on the model and in the strip).
                var maskLayer = p.TryGetProperty("maskLayer", out var ml) && ml.TryGetInt32(out var mli) ? mli : -1;
                await ForgeGate.WaitAsync();
                try
                {
                    var sw = Stopwatch.StartNew();
                    var model = await Task.Run(() => ForgeLoad(recipe.Model));
                    var size = Math.Min(ForgePreviewSize, recipe.Size);
                    var files = new Dictionary<string, byte[]>(StringComparer.Ordinal);
                    var sets = await Task.Run(() => Enumerable.Range(0, model.Sets.Count).Select(s =>
                    {
                        var bake = ForgeBakeFor(model, s, size, recipe);
                        var tex = ForgeCompositor.Compose(model, s, bake, recipe, ForgeMaterial);
                        foreach (var m in new[] { "basecolor", "normal", "orm", "roughness", "metallic", "height" }) files[$"{s}-{m}.png"] = tex.Png(m);
                        if (maskLayer >= 0 && maskLayer < recipe.Layers.Count) files[$"{s}-mask.png"] = PngWriter.Gray(size, size, ForgeCompositor.Mask(bake, recipe.Layers[maskLayer], s));
                        files[$"{s}-ao.png"] = PngWriter.Gray(size, size, bake.Ao.Select(v => (byte)Math.Clamp(v * 255, 0, 255)).ToArray());
                        files[$"{s}-curvature.png"] = PngWriter.Gray(size, size, bake.Curvature.Select(v => (byte)Math.Clamp(128 + v * 127, 0, 255)).ToArray());
                        return tex;
                    }).ToList());
                    files["model.glb"] = await Task.Run(() => ForgeExport.Glb(model, sets));
                    var key = "f" + Guid.NewGuid().ToString("N")[..12];
                    lock (_forgePreviews)
                    {
                        _forgePreviews[key] = files; _forgePreviewOrder.Enqueue(key);
                        while (_forgePreviewOrder.Count > 3) _forgePreviews.Remove(_forgePreviewOrder.Dequeue());
                    }
                    return new
                    {
                        url = $"/_forge/{key}/model.glb", key, size, ms = sw.ElapsedMilliseconds,
                        sets = model.Sets.Select((s, i) => new { name = s.Name, maps = ForgePreviewMaps.Where(m => m != "mask" || files.ContainsKey($"{i}-mask.png")).ToDictionary(m => m, m => $"/_forge/{key}/{i}-{m}.png") }),
                    };
                }
                finally { ForgeGate.Release(); }
            }
            case "forge.texels":
            {
                // Where each texel of the preview's textures is on the model (and which way it faces, and its part), so
                // the page can show a stroke while it is painted, exactly as the app will paint it.
                var recipe = ForgeRecipeFrom(p);
                if (recipe.Model == null) throw new BridgeError("Open a model first.");
                await ForgeGate.WaitAsync();
                try
                {
                    var model = await Task.Run(() => ForgeLoad(recipe.Model));
                    var size = Math.Min(ForgePreviewSize, recipe.Size);
                    var files = new Dictionary<string, byte[]>(StringComparer.Ordinal);
                    await Task.Run(() =>
                    {
                        for (var s = 0; s < model.Sets.Count; s++) files[$"{s}-texels.bin"] = ForgeTexels(ForgeBakeFor(model, s, size, recipe));
                    });
                    var key = "t" + Guid.NewGuid().ToString("N")[..12];
                    lock (_forgePreviews)
                    {
                        _forgePreviews[key] = files; _forgePreviewOrder.Enqueue(key);
                        while (_forgePreviewOrder.Count > 4) _forgePreviews.Remove(_forgePreviewOrder.Dequeue());
                    }
                    return new { size, sets = Enumerable.Range(0, model.Sets.Count).Select(s => $"/_forge/{key}/{s}-texels.bin") };
                }
                finally { ForgeGate.Release(); }
            }
            case "forge.export":
            {
                var recipe = ForgeRecipeFrom(p);
                if (recipe.Model == null) throw new BridgeError("Open a model first.");
                var dlg = new OpenFolderDialog { Title = "Export the textured model into this folder" };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var folder = dlg.FolderName;
                await ForgeGate.WaitAsync();
                try
                {
                    var model = await Task.Run(() => ForgeLoad(recipe.Model));
                    var stem = NoorMD.Core.Documents.DocumentFile.SafeFileName(recipe.Name, "");
                    var written = new List<string>();
                    var sets = new List<ForgeTextures>();
                    for (var s = 0; s < model.Sets.Count; s++)
                    {
                        var set = s;
                        var tex = await Task.Run(() => ForgeCompositor.Compose(model, set, ForgeBakeFor(model, set, recipe.Size, recipe), recipe, ForgeMaterial));
                        sets.Add(tex);
                        var setName = model.Sets.Count == 1 ? stem : $"{stem}_{NoorMD.Core.Documents.DocumentFile.SafeFileName(model.Sets[s].Name, "")}";
                        foreach (var (name, data) in await Task.Run(() => ForgeExport.SetFiles(setName, tex).ToList()))
                        {
                            var file = Path.Combine(folder, name);
                            await File.WriteAllBytesAsync(file, data);
                            written.Add(file);
                        }
                        PushEvent("forge.exportProgress", new { done = s + 1, total = model.Sets.Count });
                    }
                    var glb = Path.Combine(folder, stem + ".glb");
                    await File.WriteAllBytesAsync(glb, await Task.Run(() => ForgeExport.Glb(model, sets)));
                    written.Add(glb);
                    var recipeFile = Path.Combine(folder, stem + ".noorforge.json");
                    await File.WriteAllTextAsync(recipeFile, recipe.ToJson());
                    written.Add(recipeFile);
                    return new { folder, files = written.Select(Path.GetFileName) };
                }
                finally { ForgeGate.Release(); }
            }
            case "forge.recipe.open":
            {
                var dlg = new OpenFileDialog { Title = "Open a NoorForge recipe", Filter = "NoorForge recipe (*.noorforge.json)|*.noorforge.json", CheckFileExists = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                ForgeRecipe recipe;
                try { recipe = ForgeRecipe.FromJson(await File.ReadAllTextAsync(dlg.FileName)); }
                catch (JsonException ex) { throw new BridgeError("That recipe can't be read: " + ex.Message); }
                object? info = null;
                if (recipe.Model != null)
                {
                    // The model it names (or, moved with it, the same name beside the recipe).
                    var path = File.Exists(recipe.Model) ? recipe.Model : Path.Combine(Path.GetDirectoryName(dlg.FileName)!, Path.GetFileName(recipe.Model));
                    if (File.Exists(path))
                    {
                        recipe.Model = Path.GetFullPath(path);
                        _forgeFiles.Add(recipe.Model);
                        info = ForgeModelInfo(recipe.Model, await Task.Run(() => ForgeLoad(recipe.Model)));
                    }
                }
                return new { recipe = JsonDocument.Parse(recipe.ToJson()).RootElement.Clone(), model = info };
            }
            default:
                throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }
}
