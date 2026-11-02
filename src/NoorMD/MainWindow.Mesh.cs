using System.IO;
using System.Text.Json;
using Microsoft.Win32;
using NoorMD.Core.Bridge;
using NoorMD.Media.Mesh;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// NoorMesh: the page models (the scene, its meshes, every edit); the app opens and saves .noormesh files, imports GLB
/// and OBJ, exports them (turned to +Y up), and keeps a draft now and then to bring back after a crash. Only files you
/// choose, or opened here before (File › Open recent), are read.
/// </summary>
public partial class MainWindow
{
    private static string MeshFolder => Path.Combine(App.Paths.Local, "Mesh");
    private static string MeshRecentFile => Path.Combine(MeshFolder, "recent.json");

    private static List<string> MeshRecent()
    {
        try { return JsonSerializer.Deserialize<List<string>>(File.ReadAllText(MeshRecentFile)) ?? []; }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { return []; }
    }
    private static void AddMeshRecent(string path)
    {
        try
        {
            var full = Path.GetFullPath(path);
            var list = MeshRecent().Where(x => !string.Equals(x, full, StringComparison.OrdinalIgnoreCase)).Prepend(full).Take(15).ToList();
            Directory.CreateDirectory(MeshFolder);
            NoorMD.Core.Documents.AtomicFile.WriteAllText(MeshRecentFile, JsonSerializer.Serialize(list));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* the list is a convenience */ }
    }

    /// <summary>The scene the page sent ("doc"), checked.</summary>
    private static MeshDoc MeshDocFrom(JsonElement p)
    {
        if (p.ValueKind != JsonValueKind.Object || !p.TryGetProperty("doc", out var d) || d.ValueKind != JsonValueKind.Object) throw new BridgeError("No scene.");
        try { return MeshDoc.FromJson(d.GetRawText()); }
        catch (InvalidDataException ex) { throw new BridgeError(ex.Message); }
    }
    /// <summary>A scene for the page: plain JSON (the page's own shape).</summary>
    private static JsonElement MeshDocOut(MeshDoc doc) { using var j = JsonDocument.Parse(doc.ToJson()); return j.RootElement.Clone(); }

    private static object MeshOpenPath(string path)
    {
        if (!path.EndsWith(".noormesh", StringComparison.OrdinalIgnoreCase)) throw new BridgeError("NoorMesh opens NoorMesh scenes (.noormesh); GLB and OBJ come in with File › Import.");
        var info = new FileInfo(path);
        if (info.Length > MeshDoc.MaxFileBytes) throw new BridgeError("That scene is too big to open here.");
        try
        {
            var doc = MeshDoc.FromFile(File.ReadAllBytes(path));
            AddMeshRecent(path);
            return new { doc = MeshDocOut(doc), path, name = Path.GetFileName(path) };
        }
        catch (InvalidDataException ex) { throw new BridgeError(ex.Message); }
    }

    private async Task<object?> DispatchMeshAsync(BridgeRequest req)
    {
        var p = req.Payload;
        switch (req.Type)
        {
            case "mesh.open":
            {
                var dlg = new OpenFileDialog { Title = Tr.T("Open a NoorMesh scene"), Filter = Tr.T("NoorMesh scenes (*.noormesh)|*.noormesh"), CheckFileExists = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var path = dlg.FileName;
                return await Task.Run(() => MeshOpenPath(path));
            }
            case "mesh.recent":
                return new { files = MeshRecent().Where(File.Exists).Select(f => new { path = f, name = Path.GetFileName(f) }).ToList() };
            case "mesh.openRecent":
            {
                var path = req.GetString("path", 2000);
                if (string.IsNullOrEmpty(path) || !MeshRecent().Contains(Path.GetFullPath(path), StringComparer.OrdinalIgnoreCase)) throw new BridgeError("That scene isn't one opened here before.");
                if (!File.Exists(path)) throw new BridgeError("That scene is gone (moved or deleted).");
                return await Task.Run(() => MeshOpenPath(path));
            }
            case "mesh.save":
            {
                var doc = MeshDocFrom(p);
                var path = req.GetString("path", 2000);
                if (!string.IsNullOrEmpty(path) && !path.EndsWith(".noormesh", StringComparison.OrdinalIgnoreCase)) path = null;
                if (string.IsNullOrEmpty(path))
                {
                    var stem = Path.GetFileNameWithoutExtension(req.GetString("name", 200) ?? "scene");
                    var dlg = new SaveFileDialog { Title = Tr.T("Save the NoorMesh scene"), FileName = string.IsNullOrWhiteSpace(stem) ? "scene" : stem, Filter = Tr.T("NoorMesh scenes (*.noormesh)|*.noormesh"), DefaultExt = ".noormesh", AddExtension = true };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    path = dlg.FileName;
                }
                var bytes = await Task.Run(doc.ToFile);
                await Task.Run(() => NoorMD.Core.Documents.AtomicFile.WriteAllBytes(path, bytes));
                AddMeshRecent(path);
                return new { path, name = Path.GetFileName(path) };
            }
            case "mesh.import":
            {
                var dlg = new OpenFileDialog { Title = Tr.T("Import a model into the scene"), Filter = Tr.T("3D models (*.glb;*.obj)|*.glb;*.obj|GLB (*.glb)|*.glb|OBJ (*.obj)|*.obj"), CheckFileExists = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var path = dlg.FileName;
                if (new FileInfo(path).Length > MeshDoc.MaxFileBytes) throw new BridgeError("That model is too big to import here.");
                var stem = Path.GetFileNameWithoutExtension(path);
                try
                {
                    var doc = await Task.Run(() => path.EndsWith(".obj", StringComparison.OrdinalIgnoreCase)
                        ? MeshDoc.FromObj(File.ReadAllText(path), stem)
                        : MeshDoc.FromGlb(File.ReadAllBytes(path), stem));
                    return new { doc = MeshDocOut(doc), name = Path.GetFileName(path) };
                }
                catch (InvalidDataException ex) { throw new BridgeError(ex.Message); }
                catch (Exception ex) when (ex is JsonException or ArgumentException or IndexOutOfRangeException or KeyNotFoundException or InvalidOperationException) { throw new BridgeError("That model can't be read: " + ex.Message); }
            }
            case "mesh.export":
            {
                var doc = MeshDocFrom(p);
                var format = req.GetString("format", 10) ?? "glb";
                var (filter, ext) = format switch
                {
                    "glb" => (Tr.T("GLB (*.glb)|*.glb"), ".glb"),
                    "obj" => (Tr.T("OBJ (*.obj)|*.obj"), ".obj"),
                    _ => throw new BridgeError("NoorMesh exports GLB or OBJ."),
                };
                if (!doc.Objects.Any(o => !o.Hidden && o.Mesh.F.Count > 0)) throw new BridgeError("Nothing to export: every object is hidden or empty.");
                var stem = Path.GetFileNameWithoutExtension(req.GetString("name", 200) ?? "scene");
                var dlg = new SaveFileDialog { Title = Tr.T("Export the scene"), FileName = (string.IsNullOrWhiteSpace(stem) ? "scene" : stem) + ext, Filter = filter, DefaultExt = ext, AddExtension = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var path = dlg.FileName;
                await Task.Run(() =>
                {
                    if (format == "glb") NoorMD.Core.Documents.AtomicFile.WriteAllBytes(path, doc.ToGlb());
                    else NoorMD.Core.Documents.AtomicFile.WriteAllText(path, doc.ToObj());
                });
                return new { path, name = Path.GetFileName(path) };
            }
            case "mesh.draft.save":
            {
                // The scene open now, kept in the app's own folder now and then, to bring back after a crash.
                var doc = MeshDocFrom(p);
                Directory.CreateDirectory(MeshFolder);
                var bytes = await Task.Run(doc.ToFile);
                await Task.Run(() => NoorMD.Core.Documents.AtomicFile.WriteAllBytes(Path.Combine(MeshFolder, "draft.noormesh"), bytes));
                await File.WriteAllTextAsync(Path.Combine(MeshFolder, "draft.json"), JsonSerializer.Serialize(new { name = req.GetString("name", 200) ?? "", path = req.GetString("path", 2000) ?? "", savedUtc = DateTime.UtcNow }));
                return new { ok = true };
            }
            case "mesh.draft.load":
            {
                var file = Path.Combine(MeshFolder, "draft.noormesh");
                if (!File.Exists(file)) return new { none = true };
                try
                {
                    var info = File.Exists(Path.Combine(MeshFolder, "draft.json")) ? JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(MeshFolder, "draft.json"))).RootElement.Clone() : default;
                    string? Field(string k) => info.ValueKind == JsonValueKind.Object && info.TryGetProperty(k, out var v) ? v.GetString() : "";
                    var doc = await Task.Run(() => MeshDoc.FromFile(File.ReadAllBytes(file)));
                    return new { doc = MeshDocOut(doc), name = Field("name"), path = Field("path"), savedUtc = File.GetLastWriteTimeUtc(file) };
                }
                catch (Exception ex) when (ex is InvalidDataException or JsonException or IOException) { return new { none = true, broken = ex.Message }; }
            }
            case "mesh.draft.clear":
            {
                foreach (var f in new[] { "draft.noormesh", "draft.json" }) { var path = Path.Combine(MeshFolder, f); if (File.Exists(path)) File.Delete(path); }
                return new { ok = true };
            }
            default:
                throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }
}
