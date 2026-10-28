using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Export;
using NoorMD.Media.Assets3D;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// Asset Bench: game-ready trees (and, later, rocks) made from a recipe. The page edits the recipe; the app grows and
/// meshes the tree (the same recipe and seed always give the same mesh), serves the preview's GLB files from memory at
/// /_asset/{key}/lod{n}.glb, and exports GLB files with the recipe and a manifest beside them. Your own presets are
/// recipes kept in the local data folder.
/// </summary>
public partial class MainWindow
{
    private readonly Dictionary<string, byte[][]> _assetPreviews = new(StringComparer.Ordinal);
    private readonly Queue<string> _assetPreviewOrder = new();
    private readonly HashSet<string> _assetFolders = new(StringComparer.OrdinalIgnoreCase);
    private CancellationTokenSource? _assetBuildCancel;
    private static readonly SemaphoreSlim AssetGate = new(1);
    private static string UserTreeFolder => Path.Combine(App.Paths.Local, "Assets", "Trees");
    private const int AssetPreviewTexture = 256;

    /// <summary>Serves /_asset/{key}/lod{n}.glb: preview meshes built moments ago.</summary>
    private bool TryServeAsset(Uri uri, CoreWebView2WebResourceRequestedEventArgs e, CoreWebView2Environment env)
    {
        var path = uri.AbsolutePath;
        if (!path.StartsWith("/_asset/", StringComparison.Ordinal)) return false;
        var parts = path[8..].Split('/');
        byte[]? glb = null;
        if (parts.Length == 2 && parts[1].StartsWith("lod", StringComparison.Ordinal) && parts[1].EndsWith(".glb", StringComparison.Ordinal)
            && int.TryParse(parts[1][3..^4], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var lod))
            lock (_assetPreviews)
                if (_assetPreviews.TryGetValue(parts[0], out var lods) && lod >= 0 && lod < lods.Length) glb = lods[lod];
        e.Response = glb != null
            ? env.CreateWebResourceResponse(new MemoryStream(glb), 200, "OK", "Content-Type: model/gltf-binary\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff")
            : env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
        return true;
    }

    private static TreeRecipe TreeRecipeFrom(JsonElement p)
    {
        if (!p.TryGetProperty("recipe", out var r) || r.ValueKind != JsonValueKind.Object) throw new BridgeError("Missing the tree recipe.");
        var raw = r.GetRawText();
        if (raw.Length > 100_000) throw new BridgeError("That recipe is too big.");
        try { return TreeRecipe.FromJson(raw); }
        catch (JsonException ex) { throw new BridgeError("The recipe can't be read: " + ex.Message); }
    }

    private static JsonElement TreeForPage(TreeRecipe r) => JsonDocument.Parse(r.ToJson()).RootElement.Clone();

    private static object UserTreePresets()
    {
        var list = new List<object>();
        if (!Directory.Exists(UserTreeFolder)) return list;
        foreach (var f in Directory.EnumerateFiles(UserTreeFolder, "*.json").OrderBy(f => f, StringComparer.CurrentCultureIgnoreCase))
        {
            try
            {
                var r = TreeRecipe.FromJson(File.ReadAllText(f));
                list.Add(new { id = "user:" + Path.GetFileName(f), name = r.Name, style = r.Style, archetype = r.Archetype, description = "Your preset" });
            }
            catch (Exception ex) when (ex is JsonException or IOException or ArgumentException) { /* a broken file is left out */ }
        }
        return list;
    }

    private static string UserTreePath(string id)
    {
        var file = id.StartsWith("user:", StringComparison.Ordinal) ? id[5..] : "";
        if (file.Length == 0 || file != Path.GetFileName(file) || !file.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) throw new BridgeError("Unknown preset.");
        return Path.Combine(UserTreeFolder, file);
    }

    /// <summary>All levels of detail as one asset: a root holding Name_LOD0, Name_LOD1… (engines that group LODs by name).</summary>
    private static Asset3D OneFileLods(TreeBuild build)
    {
        var all = new Asset3D { Name = build.Recipe.Name, Root = new Node3D { Name = build.Recipe.Name } };
        all.Materials.AddRange(build.Lods[0].Materials);
        foreach (var lod in build.Lods) all.Root.Children.Add(lod.Root);
        return all;
    }

    /// <summary>What an engine needs to know about the files: units, axes, pivot, levels, materials and the wind data's layout.</summary>
    private static object TreeManifest(TreeBuild build, IReadOnlyList<string> files, int textureSize) => new
    {
        generator = "NoorMD Asset Bench",
        kind = "tree",
        name = build.Recipe.Name,
        units = "metres",
        up = "+Y",
        pivot = "base of the trunk, at the origin",
        height = build.Recipe.Height,
        branches = build.Recipe.Branches,
        files,
        lods = build.Lods.Select((l, i) => new { level = i, triangles = l.TriangleCount, nodes = l.Root.All().Where(n => n.Mesh != null).Select(n => n.Name) }),
        materials = build.Lods[0].Materials.Select(m => new { name = m.Name, alpha = m.Alpha, textures = textureSize > 0 && (m.BaseColorPng != null) ? $"{textureSize}px, embedded" : "none" }),
        wind = !build.Recipe.Wind ? null : (object)(build.Recipe.WindData == "color"
            ? new { channel = "COLOR_0", r = "trunk sway (0 at the base, 1 at the top)", g = "branch bend (0 on the trunk, rising along limbs)", b = "leaf flutter (0 at a card's anchor, 1 at its tip)", a = "phase (shared by a limb and what grows on it)" }
            : new { channel = "TEXCOORD_1 and TEXCOORD_2", uv1x = "branch bend (0 on the trunk, rising along limbs)", uv1y = "leaf flutter (0 at a card's anchor, 1 at its tip)", uv2x = "phase (shared by a limb and what grows on it)", uv2y = "trunk sway (0 at the base, 1 at the top)" }),
        recipe = build.Recipe.Name + ".noortree.json",
    };

    private async Task<object?> DispatchAssetAsync(BridgeRequest req)
    {
        var p = req.Payload;
        try
        {
            switch (req.Type)
            {
                case "asset.presets":
                    return new
                    {
                        builtIn = TreePresets.All.Select(x => { var r = x.Make(); return new { id = x.Id, name = x.Name, description = x.Description, style = r.Style, archetype = r.Archetype }; }),
                        mine = UserTreePresets(),
                        barks = NoorMD.Media.TexturePresets.All.Where(t => t.Family is "Wood" or "Nature" or "Ground" or "Stone").Select(t => new { id = t.Id, name = t.Name }),
                    };
                case "asset.preset":
                {
                    var id = req.GetString("id", 300) ?? "";
                    var recipe = id.StartsWith("user:", StringComparison.Ordinal) ? TreeRecipe.FromJson(await File.ReadAllTextAsync(UserTreePath(id))) : TreePresets.Make(id);
                    return TreeForPage(recipe);
                }
                case "asset.build":
                {
                    // A preview: every level of detail with small textures. A newer build stops an older one.
                    var recipe = TreeRecipeFrom(p);
                    var key = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(recipe.ToJson())))[..20].ToLowerInvariant();
                    var cancel = new CancellationTokenSource();
                    Interlocked.Exchange(ref _assetBuildCancel, cancel)?.Cancel();
                    var watch = Stopwatch.StartNew();
                    TreeBuild build;
                    byte[][] glbs;
                    await AssetGate.WaitAsync();
                    try
                    {
                        cancel.Token.ThrowIfCancellationRequested();
                        (build, glbs) = await Task.Run(() =>
                        {
                            var b = TreeBuilder.Build(recipe, new TreeBuilder.Options { TextureSize = AssetPreviewTexture }, cancel.Token);
                            return (b, b.Lods.Select(l => GlbWriter.Write(l)).ToArray());
                        }, cancel.Token);
                    }
                    catch (OperationCanceledException) { return new { cancelled = true }; }
                    finally { AssetGate.Release(); }
                    lock (_assetPreviews)
                    {
                        if (!_assetPreviews.ContainsKey(key)) { _assetPreviews[key] = glbs; _assetPreviewOrder.Enqueue(key); }
                        while (_assetPreviewOrder.Count > 3) _assetPreviews.Remove(_assetPreviewOrder.Dequeue());
                    }
                    var lod0 = build.Lods[0];
                    return new
                    {
                        key,
                        ms = watch.ElapsedMilliseconds,
                        lods = build.Lods.Select((l, i) => new
                        {
                            url = $"/_asset/{key}/lod{i}.glb",
                            triangles = l.TriangleCount,
                            vertices = l.Root.All().Sum(n => n.Mesh?.VertexCount ?? 0),
                            bytes = glbs[i].Length,
                        }),
                        branches = build.Skeleton.Branches.Count(b => !b.Root && b.Level > 0),
                        nodes = lod0.Root.All().Where(n => n.Mesh != null).Select(n => new { name = n.Name, triangles = n.Mesh!.TriangleCount }),
                        notes = build.Notes,
                    };
                }
                case "asset.export":
                {
                    var recipe = TreeRecipeFrom(p);
                    var size = (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "textureSize") ?? 1024);
                    if (size is not (0 or 256 or 512 or 1024 or 2048)) throw new BridgeError("Choose 256, 512, 1024 or 2048 pixels for the textures, or none.");
                    var oneFile = req.GetString("lodFiles", 10) == "one";
                    var place = ExportPlaceFrom(p, "model");
                    var root = ExportBase(place, $"Save “{recipe.Name}” in… (you can make a new folder here)");
                    if (root == null) return new { cancelled = true };
                    var tokens = ExportTokens(recipe.Name, recipe.Archetype, size, place.Project?.Name);
                    var folder = ExportLayouts.Under(root, ExportLayouts.Folders(ExportLayouts.Expand(place.FolderPattern, tokens)));
                    var file = ExportLayouts.FileName(ExportLayouts.Expand(place.FilePattern, tokens), recipe.Name);
                    var stem = ExportLayouts.FileName(tokens["name"], recipe.Name);
                    var separate = !oneFile && recipe.Lods > 1;
                    var glbNames = separate ? Enumerable.Range(0, recipe.Lods).Select(i => $"{file}_LOD{i}.glb").ToList() : [file + ".glb"];
                    var how = AskReplace([.. glbNames.Select(n => Path.Combine(folder, n)), Path.Combine(folder, stem + ".noortree.json"), Path.Combine(folder, stem + ".manifest.json")], $"“{recipe.Name}”");
                    if (how == null) return new { cancelled = true };
                    var keep = how == "keep";
                    PushEvent("asset.exportProgress", new { stage = "Growing and meshing the tree…" });
                    TreeBuild build;
                    await AssetGate.WaitAsync();
                    try { build = await Task.Run(() => TreeBuilder.Build(recipe, new TreeBuilder.Options { TextureSize = size })); }
                    finally { AssetGate.Release(); }
                    Directory.CreateDirectory(folder);
                    var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    var written = new List<string>();
                    if (separate)
                        for (var i = 0; i < build.Lods.Count; i++)
                        {
                            var path = ExportTarget(folder, glbNames[i], keep, taken);
                            await File.WriteAllBytesAsync(path, await Task.Run(() => GlbWriter.Write(build.Lods[i])));
                            written.Add(path);
                        }
                    else
                    {
                        var path = ExportTarget(folder, glbNames[0], keep, taken);
                        await File.WriteAllBytesAsync(path, await Task.Run(() => GlbWriter.Write(build.Lods.Count > 1 ? OneFileLods(build) : build.Lods[0])));
                        written.Add(path);
                    }
                    var recipePath = ExportTarget(folder, stem + ".noortree.json", keep, taken);
                    await File.WriteAllTextAsync(recipePath, recipe.ToJson(), new UTF8Encoding(false));
                    var manifestPath = ExportTarget(folder, stem + ".manifest.json", keep, taken);
                    await File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(TreeManifest(build, written.Select(Path.GetFileName).ToList()!, size), new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));
                    _assetFolders.Add(folder);
                    Log.Info($"Asset Bench: exported “{recipe.Name}” ({build.Lods.Count} level(s) of detail, {build.Lods[0].TriangleCount} triangles at LOD0)");
                    return new { folder, files = written.Select(Path.GetFileName), recipe = Path.GetFileName(recipePath), manifest = Path.GetFileName(manifestPath), project = place.Project?.Name, relative = Path.GetRelativePath(root, folder).Replace('\\', '/'), triangles = build.Lods.Select(l => l.TriangleCount) };
                }
                case "asset.reveal":
                {
                    var folder = req.GetString("folder", 4000) ?? "";
                    if (!_assetFolders.Contains(folder) || !Directory.Exists(folder)) throw new BridgeError("That is not a folder the asset went to.");
                    Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = false, ArgumentList = { folder } });
                    return null;
                }
                case "asset.save":
                {
                    var recipe = TreeRecipeFrom(p);
                    Directory.CreateDirectory(UserTreeFolder);
                    var file = NoorMD.Core.Documents.DocumentFile.SafeFileName(recipe.Name, ".json");
                    var path = Path.Combine(UserTreeFolder, file);
                    var replaced = File.Exists(path);
                    await File.WriteAllTextAsync(path, recipe.ToJson(), new UTF8Encoding(false));
                    return new { id = "user:" + file, replaced, mine = UserTreePresets() };
                }
                case "asset.delete":
                    File.Delete(UserTreePath(req.GetString("id", 300) ?? ""));
                    return new { mine = UserTreePresets() };
                case "asset.open":
                {
                    var dlg = new OpenFileDialog { Title = "Open a tree recipe", Filter = "Tree recipes (*.noortree.json;*.json)|*.noortree.json;*.json", CheckFileExists = true };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    if (new FileInfo(dlg.FileName).Length > 100_000) throw new BridgeError("That file is too big for a tree recipe.");
                    return new { recipe = TreeForPage(TreeRecipe.FromJson(await File.ReadAllTextAsync(dlg.FileName))) };
                }
                default: throw new BridgeError($"Unknown command \"{req.Type}\".");
            }
        }
        catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
        catch (JsonException ex) { throw new BridgeError("The recipe can't be read: " + ex.Message); }
    }
}
