using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows.Media;
using System.Windows.Media.Imaging;
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

    // Pictures of your own for bark and leaves: read only when you picked them here, or a recipe you opened names them.
    private readonly HashSet<string> _assetImageFiles = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, (DateTime Stamp, RawImage Image)> _assetImageCache = new(StringComparer.OrdinalIgnoreCase);

    private void AllowTreeImages(TreeRecipe r)
    {
        foreach (var path in new[] { r.BarkImage, r.LeafImage }.Where(p => p != ""))
            try { _assetImageFiles.Add(Path.GetFullPath(path)); } catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { }
    }

    /// <summary>A recipe opened from a file: pictures it names that aren't where it says are looked for beside it.</summary>
    private static TreeRecipe FindTreeImagesBeside(TreeRecipe r, string folder)
    {
        string Find(string p)
        {
            if (p == "" || File.Exists(p)) return p;
            var beside = Path.Combine(folder, Path.GetFileName(p));
            return File.Exists(beside) ? beside : p;
        }
        r.BarkImage = Find(r.BarkImage);
        r.LeafImage = Find(r.LeafImage);
        return r;
    }

    /// <summary>A picture of your own as RGBA pixels (at most 2048 across), or null when it can't or may not be read.</summary>
    private RawImage? LoadAssetImage(string path)
    {
        try
        {
            var full = Path.GetFullPath(path);
            if (!_assetImageFiles.Contains(full) || !File.Exists(full)) return null;
            var stamp = File.GetLastWriteTimeUtc(full);
            lock (_assetImageCache)
                if (_assetImageCache.TryGetValue(full, out var hit) && hit.Stamp == stamp) return hit.Image;
            if (new FileInfo(full).Length > 200 * 1024 * 1024) return null;
            var frame = Decode(full, 2048);
            if (frame == null) return null;
            var conv = new FormatConvertedBitmap(frame, PixelFormats.Bgra32, null, 0);
            int w = conv.PixelWidth, h = conv.PixelHeight;
            var px = new byte[w * h * 4];
            conv.CopyPixels(px, w * 4, 0);
            for (var i = 0; i < px.Length; i += 4) (px[i], px[i + 2]) = (px[i + 2], px[i]);     // BGRA to RGBA
            var image = new RawImage(w, h, px);
            lock (_assetImageCache)
            {
                if (_assetImageCache.Count >= 6) _assetImageCache.Remove(_assetImageCache.Keys.First());
                _assetImageCache[full] = (stamp, image);
            }
            return image;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException or InvalidOperationException) { return null; }
    }

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

    /// <summary>
    /// What an engine needs to know about the files, whatever the engine: what the asset is, the recipe and seed it comes
    /// from, units, axes, bounds and pivot, each level with its file (or node) and triangles, each material's maps with
    /// their colour space and normal-map convention, and the wind data's layout.
    /// </summary>
    private static object TreeManifest(TreeBuild build, IReadOnlyList<string> files, int textureSize, string recipeFile, bool oneFile, int variant = 0, string? species = null)
    {
        var (lo, hi) = TreeExport.Bounds(build.Lods[0]);
        float R(float v) => MathF.Round(v, 3);
        float[] V(System.Numerics.Vector3 v) => [R(v.X), R(v.Y), R(v.Z)];
        var at = TreeExport.SwitchDistances(build);
        var profile = GameProfiles.Find(build.Recipe.Profile);
        return new
        {
            generator = "NoorMD Asset Bench",
            kind = "tree",
            name = build.Recipe.Name,
            // Made for a game: its profile and the name its catalogue knows this tree by.
            profile = profile?.Id,
            catalogue = profile?.CatalogueName(species ?? build.Recipe.Name, variant),
            species = GameProfile.Species(species ?? build.Recipe.Name).ToLowerInvariant(),
            variant = GameProfile.Variant(variant),
            recipe = recipeFile,
            seed = build.Recipe.Seed,
            units = "metres",
            up = "+Y",
            forward = "+Z",
            pivot = new { position = new[] { 0f, 0f, 0f }, at = "the base of the trunk, on the ground" },
            bounds = new { min = new[] { R(lo.X), R(lo.Y), R(lo.Z) }, max = new[] { R(hi.X), R(hi.Y), R(hi.Z) }, size = new[] { R(hi.X - lo.X), R(hi.Y - lo.Y), R(hi.Z - lo.Z) } },
            height = build.Recipe.Height,
            heightMetres = R(hi.Y),
            widthMetres = R(MathF.Max(hi.X - lo.X, hi.Z - lo.Z)),
            texture = new { size = build.Recipe.Pixels > 0 && textureSize > 0 ? build.Recipe.Pixels : textureSize, sampling = build.Recipe.Pixels > 0 ? "nearest" : "linear", pixelArt = build.Recipe.Pixels > 0 },
            branches = build.Recipe.Branches,
            files,
            lods = build.Lods.Select((l, i) => new
            {
                level = i,
                file = oneFile || build.Lods.Count == 1 ? files.FirstOrDefault() : files.ElementAtOrDefault(i),
                node = oneFile && build.Lods.Count > 1 ? l.Root.Name : null,
                triangles = l.TriangleCount,
                objects = l.Root.All().Count(n => n.Mesh is { TriangleCount: > 0 }),
                bounds = new { min = V(TreeExport.Bounds(l).Min), max = V(TreeExport.Bounds(l).Max) },
                billboard = build.Recipe.Billboard && i == build.Lods.Count - 1 && build.Lods.Count > 1,
                nodes = l.Root.All().Where(n => n.Mesh != null).Select(n => n.Name),
                visibleFrom = i == 0 ? 0 : at[i - 1],
                visibleTo = i < build.Lods.Count - 1 ? at[i] : 0,
            }),
            materials = build.Lods.SelectMany(l => l.Materials).Distinct().Select(m => new { name = m.Name, alpha = m.Alpha, doubleSided = m.DoubleSided, embedded = textureSize > 0, maps = TreeExport.Maps(m, textureSize) }),
            wind = !build.Recipe.Wind ? null : (object)(build.Recipe.WindData == "color"
                ? new { channel = "COLOR_0", r = "trunk sway (0 at the base, 1 at the top)", g = "branch bend (0 on the trunk, rising along limbs)", b = "leaf flutter (0 at a card's anchor, 1 at its tip)", a = "phase (shared by a limb and what grows on it)" }
                : new { channel = "TEXCOORD_1 and TEXCOORD_2", uv1x = "branch bend (0 on the trunk, rising along limbs)", uv1y = "leaf flutter (0 at a card's anchor, 1 at its tip)", uv2x = "phase (shared by a limb and what grows on it)", uv2y = "trunk sway (0 at the base, 1 at the top)" }),
        };
    }

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
                        builtIn = TreePresets.Everything.Select(x => { var r = x.Make(); return new { id = x.Id, name = x.Name, description = x.Description, style = r.Style, archetype = r.Archetype, group = x.Group, profile = r.Profile }; }),
                        profiles = GameProfiles.All.Select(g => new { id = g.Id, name = g.Name, description = g.Description, group = g.Group, engine = g.Engine, lodFiles = g.LodFiles, helpers = g.Helpers }),
                        mine = UserTreePresets(),
                        barks = new[] { new { id = "bark", name = "Bark in the bark colour (realistic)" }, new { id = "painted", name = "Painted bark (stylized)" }, new { id = "birch", name = "Birch bark" }, new { id = "cactus", name = "Cactus skin" } }
                            .Concat(NoorMD.Media.TexturePresets.All.Where(t => t.Family is "Wood" or "Nature" or "Ground" or "Stone").Select(t => new { id = t.Id, name = "Texture Bench: " + t.Name })),
                    };
                case "asset.preset":
                {
                    var id = req.GetString("id", 300) ?? "";
                    var recipe = id.StartsWith("user:", StringComparison.Ordinal) ? TreeRecipe.FromJson(await File.ReadAllTextAsync(UserTreePath(id))) : TreePresets.Make(id);
                    // Built-in trees start as forest trees (a few thousand triangles, for scenes with very many); yours keep theirs.
                    if (!id.StartsWith("user:", StringComparison.Ordinal) && recipe.TriangleTarget == 0 && recipe.LodTriangles.Count == 0) recipe.TriangleTarget = 4000;
                    AllowTreeImages(recipe);
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
                    List<TreeStats> stats;
                    await AssetGate.WaitAsync();
                    try
                    {
                        cancel.Token.ThrowIfCancellationRequested();
                        (build, glbs, stats) = await Task.Run(() =>
                        {
                            var b = TreeBuilder.Build(recipe, new TreeBuilder.Options { TextureSize = AssetPreviewTexture, Images = LoadAssetImage }, cancel.Token);
                            // What each level costs and how full it looks (drawn from four sides, cut out by the leaves' alpha).
                            return (b, b.Lods.Select(l => GlbWriter.Write(l)).ToArray(), b.Lods.Select(TreeStatsMeter.Measure).ToList());
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
                            wood = stats[i].WoodTriangles,
                            leaves = stats[i].LeafTriangles,
                            drawCalls = stats[i].DrawCalls,
                            fullness = stats[i].Fullness,
                            overdraw = stats[i].Overdraw,
                            emptyCards = stats[i].EmptyCardArea,
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
                    // A variety pack: several trees of this kind from consecutive seeds, sizes spread a little.
                    var variants = TreeVariants.Make(recipe, (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "variants") ?? 1), NoorMD.Core.Bridge.Json.OptDouble(p, "spread") ?? 0.15);
                    // Made for a game: variants lettered as its catalogue names them (Pine_A, Pine_B…), even a single tree.
                    var profile = GameProfiles.Find(recipe.Profile);
                    if (profile != null)
                        for (var v = 0; v < variants.Count; v++) variants[v].Name = $"{GameProfile.Species(recipe.Name)}_{GameProfile.Variant(v)}";
                    var place = ExportPlaceFrom(p, "model");
                    var root = ExportBase(place, variants.Count > 1 ? $"Save {variants.Count} × “{recipe.Name}” in… (you can make a new folder here)" : $"Save “{recipe.Name}” in… (you can make a new folder here)");
                    if (root == null) return new { cancelled = true };
                    var tokens = ExportTokens(recipe.Name, recipe.Archetype, size, place.Project?.Name);
                    var folder = ExportLayouts.Under(root, ExportLayouts.Folders(ExportLayouts.Expand(place.FolderPattern, tokens)));
                    var file = ExportLayouts.FileName(ExportLayouts.Expand(place.FilePattern, tokens), recipe.Name);
                    var stem = ExportLayouts.FileName(tokens["name"], recipe.Name);
                    var levels = recipe.Lods + (recipe.Billboard ? 1 : 0);
                    var separate = !oneFile && levels > 1;
                    string Suffix(int v) => profile != null ? "_" + GameProfile.Variant(v) : variants.Count > 1 ? $"_{v + 1:00}" : "";
                    List<string> GlbNames(int v) => separate ? Enumerable.Range(0, levels).Select(i => $"{file}{Suffix(v)}_LOD{i}.glb").ToList() : [$"{file}{Suffix(v)}.glb"];
                    var planned = Enumerable.Range(0, variants.Count).SelectMany(v => GlbNames(v).Append($"{stem}{Suffix(v)}.noortree.json")).Append(stem + ".manifest.json").Concat(profile != null ? [stem + ".handoff.md"] : []).Select(n => Path.Combine(folder, n)).ToList();
                    var how = AskReplace(planned, $"“{recipe.Name}”");
                    if (how == null) return new { cancelled = true };
                    var keep = how == "keep";
                    Directory.CreateDirectory(folder);
                    var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    var written = new List<string>();
                    var recipes = new List<string>();
                    var manifests = new List<object>();
                    var triangles = new List<int>();
                    var delivered = new List<GameProfiles.Delivered>();
                    for (var v = 0; v < variants.Count; v++)
                    {
                        var variant = variants[v];
                        PushEvent("asset.exportProgress", new { stage = variants.Count > 1 ? $"Growing and meshing tree {v + 1} of {variants.Count}…" : "Growing and meshing the tree…", done = v, total = variants.Count });
                        TreeBuild build;
                        await AssetGate.WaitAsync();
                        try { build = await Task.Run(() => TreeBuilder.Build(variant, new TreeBuilder.Options { TextureSize = size, Images = LoadAssetImage })); }
                        finally { AssetGate.Release(); }
                        var names = GlbNames(v);
                        var mine = new List<string>();
                        if (separate)
                            for (var i = 0; i < build.Lods.Count; i++)
                            {
                                var path = ExportTarget(folder, names[i], keep, taken);
                                await File.WriteAllBytesAsync(path, await Task.Run(() => GlbWriter.Write(TreeExport.Level(build, i))));
                                mine.Add(path);
                            }
                        else
                        {
                            var path = ExportTarget(folder, names[0], keep, taken);
                            await File.WriteAllBytesAsync(path, await Task.Run(() => GlbWriter.Write(TreeExport.OneFile(build))));
                            mine.Add(path);
                        }
                        var recipePath = ExportTarget(folder, $"{stem}{Suffix(v)}.noortree.json", keep, taken);
                        await File.WriteAllTextAsync(recipePath, variant.ToJson(), new UTF8Encoding(false));
                        written.AddRange(mine);
                        recipes.Add(Path.GetFileName(recipePath));
                        manifests.Add(TreeManifest(build, mine.Select(Path.GetFileName).ToList()!, size, Path.GetFileName(recipePath), !separate, v, recipe.Name));
                        triangles.Add(build.Lods[0].TriangleCount);
                        if (profile != null)
                        {
                            var (blo, bhi) = TreeExport.Bounds(build.Lods[0]);
                            delivered.Add(new(profile.CatalogueName(recipe.Name, v), Path.GetFileName(recipePath), mine.Select(f => Path.GetFileName(f)!).ToList(), build.Lods.Select(l => l.TriangleCount).ToList(), bhi.Y, MathF.Max(bhi.X - blo.X, bhi.Z - blo.Z)));
                        }
                    }
                    var manifestPath = ExportTarget(folder, stem + ".manifest.json", keep, taken);
                    object manifest = variants.Count == 1 ? manifests[0] : new { generator = "NoorMD Asset Bench", kind = "tree variety pack", name = recipe.Name, variants = manifests };
                    await File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));
                    // For a game: a note for whoever brings the trees in (a person, or an agent working on the game).
                    string? handoff = null;
                    if (profile != null)
                    {
                        var handoffPath = ExportTarget(folder, stem + ".handoff.md", keep, taken);
                        await File.WriteAllTextAsync(handoffPath, GameProfiles.Handoff(profile, recipe, Path.GetFileName(manifestPath), delivered, size), new UTF8Encoding(false));
                        handoff = Path.GetFileName(handoffPath);
                    }
                    // Engine helpers. Godot: the import plugin (levels switched by distance, the wind material), in the
                    // project's addons folder when the trees go into a Godot project, else beside them. Unity and Unreal: the
                    // HLSL wind function. Other: both shader files. Shaders already there may have been changed by you, so
                    // they are kept; the plugin's own files are updated only from an older version of it.
                    var engine = req.GetString("engine", 10) is "unity" or "unreal" or "other" ? req.GetString("engine", 10)! : "godot";
                    var helpers = NoorMD.Core.Bridge.Json.IsTrue(p, "shaders");
                    var shaders = new List<string>();
                    object? godot = null;
                    if (helpers && engine == "godot")
                    {
                        // Into the Godot project the trees went into, unless you keep your project's addons to yourself.
                        var keepOut = p.TryGetProperty("godotInProject", out var gp) && gp.ValueKind == JsonValueKind.False;
                        var project = keepOut ? null : GodotAddon.ProjectOf(folder);
                        var addons = Path.Combine(project ?? folder, "addons");
                        var addonFiles = await Task.Run(() => GodotAddon.WriteTo(addons));
                        var addonFolder = Path.Combine(addons, GodotAddon.Folder);
                        godot = new { folder = addonFolder, inProject = project != null, resPath = project != null ? "res://" + Path.GetRelativePath(project, addonFolder).Replace('\\', '/') : null, written = addonFiles.Count };
                    }
                    var shaderFiles = !helpers || !recipe.Wind || recipe.WindData != "uv" ? [] : engine switch
                    {
                        "godot" => Array.Empty<(string, string)>(),
                        "other" => new[] { (WindShaders.GodotFile, WindShaders.Godot), (WindShaders.HlslFile, WindShaders.Hlsl) },
                        _ => new[] { (WindShaders.HlslFile, WindShaders.Hlsl) },
                    };
                    foreach (var (name, text) in shaderFiles)
                    {
                        var path = Path.Combine(folder, name);
                        if (File.Exists(path)) continue;
                        await File.WriteAllTextAsync(path, text.Replace("\r\n", "\n"), new UTF8Encoding(false));
                        shaders.Add(name);
                    }
                    PushEvent("asset.exportProgress", new { stage = "", done = variants.Count, total = variants.Count });
                    _assetFolders.Add(folder);
                    Log.Info($"Asset Bench: exported {variants.Count} × “{recipe.Name}” ({recipe.Lods} level(s) of detail)");
                    return new { folder, files = written.Select(Path.GetFileName), recipe = recipes[0], recipes, variants = variants.Count, manifest = Path.GetFileName(manifestPath), handoff, profile = profile?.Name, shaders, engine, godot, project = place.Project?.Name, relative = Path.GetRelativePath(root, folder).Replace('\\', '/'), triangles };
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
                    // Only pictures already allowed are kept, so a preset can't smuggle in another path.
                    if (recipe.BarkImage != "" && !_assetImageFiles.Contains(Path.GetFullPath(recipe.BarkImage))) recipe.BarkImage = "";
                    if (recipe.LeafImage != "" && !_assetImageFiles.Contains(Path.GetFullPath(recipe.LeafImage))) recipe.LeafImage = "";
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
                    var opened = FindTreeImagesBeside(TreeRecipe.FromJson(await File.ReadAllTextAsync(dlg.FileName)), Path.GetDirectoryName(Path.GetFullPath(dlg.FileName))!);
                    AllowTreeImages(opened);
                    return new { recipe = TreeForPage(opened) };
                }
                case "asset.image.pick":
                {
                    var leaves = req.GetString("kind", 10) == "leaves";
                    var dlg = new OpenFileDialog
                    {
                        Title = leaves ? "Choose a leaf picture (PNG with transparency: a 2 × 2 atlas, or one twig)" : "Choose a bark picture (it tiles round and up the branches)",
                        Filter = "Pictures (*.png;*.jpg;*.jpeg;*.tga;*.bmp;*.tif;*.tiff;*.webp)|*.png;*.jpg;*.jpeg;*.tga;*.bmp;*.tif;*.tiff;*.webp|All files|*.*",
                        CheckFileExists = true,
                    };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    var full = Path.GetFullPath(dlg.FileName);
                    _assetImageFiles.Add(full);
                    var image = await Task.Run(() => LoadAssetImage(full)) ?? throw new BridgeError("That picture can't be read.");
                    return new { path = full, name = Path.GetFileName(full), width = image.Width, height = image.Height };
                }
                default: throw new BridgeError($"Unknown command \"{req.Type}\".");
            }
        }
        catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
        catch (JsonException ex) { throw new BridgeError("The recipe can't be read: " + ex.Message); }
    }
}
