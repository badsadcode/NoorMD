using System.IO;
using System.Text;
using System.Text.Json;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Export;
using NoorMD.Media.Assets3D;

namespace NoorMD;

/// <summary>
/// Asset Bench rocks: stones, rocks, boulders, outcrops and scree patches from a recipe, previewed and exported like the
/// trees (levels of detail, the recipe and a manifest beside them), with convex collision pieces in the closest level.
/// </summary>
public partial class MainWindow
{
    private static string UserRockFolder => Path.Combine(App.Paths.Local, "Assets", "Rocks");

    private static RockRecipe RockRecipeFrom(JsonElement p)
    {
        if (!p.TryGetProperty("recipe", out var r) || r.ValueKind != JsonValueKind.Object) throw new BridgeError("Missing the rock recipe.");
        var raw = r.GetRawText();
        if (raw.Length > 20_000) throw new BridgeError("That recipe is too big.");
        try { return RockRecipe.FromJson(raw); }
        catch (JsonException ex) { throw new BridgeError("The recipe can't be read: " + ex.Message); }
    }

    private static JsonElement RockForPage(RockRecipe r) => JsonDocument.Parse(r.ToJson()).RootElement.Clone();

    private static object UserRockPresets()
    {
        var list = new List<object>();
        if (!Directory.Exists(UserRockFolder)) return list;
        foreach (var f in Directory.EnumerateFiles(UserRockFolder, "*.json").OrderBy(f => f, StringComparer.CurrentCultureIgnoreCase))
        {
            try
            {
                var r = RockRecipe.FromJson(File.ReadAllText(f));
                list.Add(new { id = "user:" + Path.GetFileName(f), name = r.Name, style = r.Style, kind = r.Kind, description = "Your preset" });
            }
            catch (Exception ex) when (ex is JsonException or IOException or ArgumentException) { /* a broken file is left out */ }
        }
        return list;
    }

    private static string UserRockPath(string id)
    {
        var file = id.StartsWith("user:", StringComparison.Ordinal) ? id[5..] : "";
        if (file.Length == 0 || file != Path.GetFileName(file) || !file.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) throw new BridgeError("Unknown preset.");
        return Path.Combine(UserRockFolder, file);
    }

    /// <summary>What an engine needs to know about a rock's files: levels, triangles, collision, pivot, materials.</summary>
    private static object RockManifest(RockBuild build, IReadOnlyList<string> files, int textureSize, string recipeFile, bool oneFile)
    {
        var (lo, hi) = TreeExport.Bounds(build.Lods[0]);
        float R(float v) => MathF.Round(v, 3);
        var at = RockExport.SwitchDistances(build);
        return new
        {
            generator = "NoorMD Asset Bench",
            kind = "rock",
            rockKind = build.Recipe.Kind,
            name = build.Recipe.Name,
            recipe = recipeFile,
            seed = build.Recipe.Seed,
            style = build.Recipe.Style,
            units = "metres",
            up = "+Y",
            forward = "+Z",
            pivot = new { position = new[] { 0f, 0f, 0f }, at = "the middle of where it meets the ground", sunk = R((float)build.Recipe.Sink * build.Height), note = "the base reaches this far below the pivot, so it sits in uneven ground without gaps" },
            bounds = new { min = new[] { R(lo.X), R(lo.Y), R(lo.Z) }, max = new[] { R(hi.X), R(hi.Y), R(hi.Z) }, size = new[] { R(hi.X - lo.X), R(hi.Y - lo.Y), R(hi.Z - lo.Z) } },
            heightMetres = R(build.Height),
            widthMetres = R(build.Width),
            texture = new { size = textureSize, tileMetres = build.Recipe.TileMetres, note = "UVs are projected in metres (one tile covers tileMetres), so every rock shares one texel density" },
            files,
            lods = build.Lods.Select((l, i) => new
            {
                level = i,
                file = oneFile || build.Lods.Count == 1 ? files.FirstOrDefault() : files.ElementAtOrDefault(i),
                node = oneFile && build.Lods.Count > 1 ? l.Root.Name : null,
                triangles = RockExport.Drawn(l),
                visibleFrom = i == 0 ? 0 : at[i - 1],
                visibleTo = i < build.Lods.Count - 1 ? at[i] : 0,
            }),
            collision = build.Collision.Count == 0 ? null : new
            {
                shape = "convex",
                level = 0,
                pieces = build.Collision.Select(c => new { node = c.Name + "-convcolonly", triangles = c.TriangleCount, points = c.VertexCount }),
                naming = "Godot makes a convex collision shape of each node whose name ends in -convcolonly (and drops its mesh). Other engines: use these meshes as convex colliders (Unreal: rename to UCX_<mesh>_00…).",
            },
            materials = build.Lods.SelectMany(l => l.Materials).Distinct().Select(m => new { name = m.Name, alpha = m.Alpha, embedded = textureSize > 0, maps = TreeExport.Maps(m, textureSize) }),
            vertexColors = "COLOR_0 RGB: painted light (lighter tops and worn edges, darker cracks and foot" + (build.Recipe.Moss > 0 ? ", a green fringe round the moss" : "") + "), to multiply with the base colour. A: how worn the edge is (0–1), a mask for a shader of your own (opaque materials ignore it).",
            edgeWear = build.Recipe.EdgeWear,
        };
    }

    private async Task<object?> DispatchRockAsync(BridgeRequest req)
    {
        var p = req.Payload;
        switch (req.Type)
        {
            case "asset.rock.presets":
                return new
                {
                    builtIn = RockPresets.All.Select(x => { var r = x.Make(); return new { id = x.Id, name = x.Name, description = x.Description, style = r.Style, kind = r.Kind }; }),
                    mine = UserRockPresets(),
                    materials = new[] { new { id = "rock", name = "Weathered rock" }, new { id = "granite", name = "Granite (speckled)" }, new { id = "sandstone", name = "Sandstone (layered)" }, new { id = "mossy", name = "Mossy rock" }, new { id = "snowy", name = "Snowy rock" }, new { id = "painted", name = "Painted rock (stylized)" } }
                        .Concat(NoorMD.Media.TexturePresets.All.Where(t => t.Family is "Stone" or "Ground").Select(t => new { id = t.Id, name = "Texture Bench: " + t.Name })),
                };
            case "asset.rock.preset":
            {
                var id = req.GetString("id", 300) ?? "";
                var recipe = id.StartsWith("user:", StringComparison.Ordinal) ? RockRecipe.FromJson(await File.ReadAllTextAsync(UserRockPath(id))) : RockPresets.Make(id);
                return RockForPage(recipe);
            }
            case "asset.rock.build":
            {
                var recipe = RockRecipeFrom(p);
                var key = "r" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(recipe.ToJson())))[..19].ToLowerInvariant();
                var cancel = new CancellationTokenSource();
                Interlocked.Exchange(ref _assetBuildCancel, cancel)?.Cancel();
                var watch = System.Diagnostics.Stopwatch.StartNew();
                RockBuild build;
                byte[][] glbs;
                await AssetGate.WaitAsync();
                try
                {
                    cancel.Token.ThrowIfCancellationRequested();
                    (build, glbs) = await Task.Run(() =>
                    {
                        var b = RockBuilder.Build(recipe, new RockBuilder.Options { TextureSize = AssetPreviewTexture }, cancel.Token);
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
                return new
                {
                    key,
                    ms = watch.ElapsedMilliseconds,
                    lods = build.Lods.Select((l, i) => new
                    {
                        url = $"/_asset/{key}/lod{i}.glb",
                        triangles = RockExport.Drawn(l),
                        vertices = l.Root.All().Where(n => n.Mesh != null && !n.Name.EndsWith("-convcolonly", StringComparison.Ordinal)).Sum(n => n.Mesh!.VertexCount),
                        bytes = glbs[i].Length,
                    }),
                    nodes = build.Lods[0].Root.All().Where(n => n.Mesh != null && !n.Name.EndsWith("-convcolonly", StringComparison.Ordinal)).Select(n => new { name = n.Name, triangles = n.Mesh!.TriangleCount }),
                    collision = build.Collision.Select(c => c.TriangleCount),
                    height = MathF.Round(build.Height, 2),
                    width = MathF.Round(build.Width, 2),
                    notes = build.Notes,
                };
            }
            case "asset.rock.export":
            {
                var recipe = RockRecipeFrom(p);
                var size = (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "textureSize") ?? 1024);
                if (size is not (0 or 256 or 512 or 1024 or 2048)) throw new BridgeError("Choose 256, 512, 1024 or 2048 pixels for the textures, or none.");
                var oneFile = req.GetString("lodFiles", 10) == "one";
                var variants = RockVariants.Make(recipe, (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "variants") ?? 1), NoorMD.Core.Bridge.Json.OptDouble(p, "spread") ?? 0.15);
                var place = ExportPlaceFrom(p, "model");
                var root = ExportBase(place, variants.Count > 1 ? $"Save {variants.Count} × “{recipe.Name}” in… (you can make a new folder here)" : $"Save “{recipe.Name}” in… (you can make a new folder here)");
                if (root == null) return new { cancelled = true };
                var tokens = ExportTokens(recipe.Name, recipe.Kind, size, place.Project?.Name);
                var folder = ExportLayouts.Under(root, ExportLayouts.Folders(ExportLayouts.Expand(place.FolderPattern, tokens)));
                var file = ExportLayouts.FileName(ExportLayouts.Expand(place.FilePattern, tokens), recipe.Name);
                var stem = ExportLayouts.FileName(tokens["name"], recipe.Name);
                var separate = !oneFile && recipe.Lods > 1;
                string Suffix(int v) => variants.Count > 1 ? $"_{v + 1:00}" : "";
                List<string> GlbNames(int v) => separate ? Enumerable.Range(0, recipe.Lods).Select(i => $"{file}{Suffix(v)}_LOD{i}.glb").ToList() : [$"{file}{Suffix(v)}.glb"];
                var planned = Enumerable.Range(0, variants.Count).SelectMany(v => GlbNames(v).Append($"{stem}{Suffix(v)}.noorrock.json")).Append(stem + ".manifest.json").Select(n => Path.Combine(folder, n)).ToList();
                var how = AskReplace(planned, $"“{recipe.Name}”");
                if (how == null) return new { cancelled = true };
                var keep = how == "keep";
                Directory.CreateDirectory(folder);
                var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var written = new List<string>();
                var recipes = new List<string>();
                var manifests = new List<object>();
                var triangles = new List<int>();
                for (var v = 0; v < variants.Count; v++)
                {
                    var variant = variants[v];
                    PushEvent("asset.exportProgress", new { stage = variants.Count > 1 ? $"Shaping rock {v + 1} of {variants.Count}…" : "Shaping the rock…", done = v, total = variants.Count });
                    RockBuild build;
                    await AssetGate.WaitAsync();
                    try { build = await Task.Run(() => RockBuilder.Build(variant, new RockBuilder.Options { TextureSize = size })); }
                    finally { AssetGate.Release(); }
                    var names = GlbNames(v);
                    var mine = new List<string>();
                    if (separate)
                        for (var i = 0; i < build.Lods.Count; i++)
                        {
                            var path = ExportTarget(folder, names[i], keep, taken);
                            await File.WriteAllBytesAsync(path, await Task.Run(() => GlbWriter.Write(RockExport.Level(build, i))));
                            mine.Add(path);
                        }
                    else
                    {
                        var path = ExportTarget(folder, names[0], keep, taken);
                        await File.WriteAllBytesAsync(path, await Task.Run(() => GlbWriter.Write(RockExport.OneFile(build))));
                        mine.Add(path);
                    }
                    var recipePath = ExportTarget(folder, $"{stem}{Suffix(v)}.noorrock.json", keep, taken);
                    await File.WriteAllTextAsync(recipePath, variant.ToJson(), new UTF8Encoding(false));
                    written.AddRange(mine);
                    recipes.Add(Path.GetFileName(recipePath));
                    manifests.Add(RockManifest(build, mine.Select(Path.GetFileName).ToList()!, size, Path.GetFileName(recipePath), !separate));
                    triangles.Add(RockExport.Drawn(build.Lods[0]));
                }
                var manifestPath = ExportTarget(folder, stem + ".manifest.json", keep, taken);
                object manifest = variants.Count == 1 ? manifests[0] : new { generator = "NoorMD Asset Bench", kind = "rock variety pack", name = recipe.Name, variants = manifests };
                await File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));
                // Godot: the same plugin as the trees switches the levels of a one-file rock.
                object? godot = null;
                if (NoorMD.Core.Bridge.Json.IsTrue(p, "shaders") && req.GetString("engine", 10) is null or "godot" && !separate && recipe.Lods > 1)
                {
                    var keepOut = p.TryGetProperty("godotInProject", out var gp) && gp.ValueKind == JsonValueKind.False;
                    var project = keepOut ? null : GodotAddon.ProjectOf(folder);
                    var addons = Path.Combine(project ?? folder, "addons");
                    var addonFiles = await Task.Run(() => GodotAddon.WriteTo(addons));
                    var addonFolder = Path.Combine(addons, GodotAddon.Folder);
                    godot = new { folder = addonFolder, inProject = project != null, resPath = project != null ? "res://" + Path.GetRelativePath(project, addonFolder).Replace('\\', '/') : null, written = addonFiles.Count };
                }
                PushEvent("asset.exportProgress", new { stage = "", done = variants.Count, total = variants.Count });
                _assetFolders.Add(folder);
                Log.Info($"Asset Bench: exported {variants.Count} × “{recipe.Name}” (rock, {recipe.Lods} level(s) of detail)");
                return new { folder, files = written.Select(Path.GetFileName), recipe = recipes[0], recipes, variants = variants.Count, manifest = Path.GetFileName(manifestPath), shaders = Array.Empty<string>(), godot, project = place.Project?.Name, relative = Path.GetRelativePath(root, folder).Replace('\\', '/'), triangles };
            }
            case "asset.rock.save":
            {
                var recipe = RockRecipeFrom(p);
                Directory.CreateDirectory(UserRockFolder);
                var file = NoorMD.Core.Documents.DocumentFile.SafeFileName(recipe.Name, ".json");
                var path = Path.Combine(UserRockFolder, file);
                var replaced = File.Exists(path);
                await File.WriteAllTextAsync(path, recipe.ToJson(), new UTF8Encoding(false));
                return new { id = "user:" + file, replaced, mine = UserRockPresets() };
            }
            case "asset.rock.delete":
                File.Delete(UserRockPath(req.GetString("id", 300) ?? ""));
                return new { mine = UserRockPresets() };
            default: throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }
}
