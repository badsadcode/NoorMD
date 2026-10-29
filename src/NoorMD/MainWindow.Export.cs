using System.IO;
using System.Text.Json;
using Microsoft.Win32;
using NoorMD.Core.Bridge;
using NoorMD.Core.Export;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// Where the benches' exports go: a folder chosen each time, or a game project's folder chosen once, arranged by a
/// layout (a template or your own folder and file-name patterns). Files are only written inside the folder or project
/// you chose; nothing is replaced without asking.
/// </summary>
public partial class MainWindow
{
    private ExportProjectStore? _exportProjects;
    private ExportProjectStore ExportProjects => _exportProjects ??= new ExportProjectStore(Path.Combine(App.Paths.Local, "Export", "projects.json"));

    /// <summary>Where one export goes: the base folder (a project's, or null: ask), and its folder and file patterns.</summary>
    private sealed record ExportPlace(ExportProject? Project, string FolderPattern, string FilePattern, string Layout);

    private ExportPlace ExportPlaceFrom(JsonElement p, string bench)
    {
        var id = p.TryGetProperty("layout", out var l) && l.ValueKind == JsonValueKind.String ? l.GetString() : "flat";
        string folder, file;
        if (id == "custom")
        {
            folder = p.TryGetProperty("folderPattern", out var f) && f.ValueKind == JsonValueKind.String ? f.GetString() ?? "" : "";
            file = p.TryGetProperty("filePattern", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() ?? "" : "";
            if (folder.Length > ExportLayouts.MaxPattern || file.Length > ExportLayouts.MaxPattern) throw new BridgeError("That pattern is too long.");
            if (file.Trim().Length == 0) file = bench switch { "sound" => "{name}_{n}", "music" or "model" => "{name}", _ => "{name}_{map}" };
        }
        else
        {
            var layout = ExportLayouts.Get(id) ?? ExportLayouts.All[0];
            id = layout.Id;
            (folder, file) = bench switch
            {
                "sound" => (layout.SoundFolder, layout.SoundFile),
                "music" => (layout.MusicFolder, layout.MusicFile),
                "model" => (layout.ModelFolder, layout.ModelFile),
                _ => (layout.TextureFolder, layout.TextureFile),
            };
        }
        var projectId = p.TryGetProperty("project", out var pr) && pr.ValueKind == JsonValueKind.String ? pr.GetString() : null;
        ExportProject? project = null;
        if (!string.IsNullOrEmpty(projectId))
        {
            project = ExportProjects.Get(projectId) ?? throw new BridgeError("That project is no longer in the list.");
            if (!Directory.Exists(project.Root)) throw new BridgeError($"The project folder “{project.Root}” can't be found. It may have been moved or renamed.");
        }
        return new ExportPlace(project, folder, file, id!);
    }

    /// <summary>The base folder: the project's, or one chosen now (null when the dialog is cancelled).</summary>
    private string? ExportBase(ExportPlace place, string title)
    {
        if (place.Project != null) return place.Project.Root;
        var dlg = new OpenFolderDialog { Title = title };
        NativeCursor.Restore();
        return dlg.ShowDialog(this) == true ? dlg.FolderName : null;
    }

    /// <summary>
    /// Files that would be replaced: asks once. "replace" writes over them, "keep" numbers the new ones, null cancels.
    /// </summary>
    private string? AskReplace(IReadOnlyCollection<string> paths, string what)
    {
        var existing = paths.Where(File.Exists).ToList();
        if (existing.Count == 0) return "replace";
        var list = string.Join("\n", existing.Take(6).Select(Path.GetFileName)) + (existing.Count > 6 ? $"\n… and {existing.Count - 6} more" : "");
        var choice = ThemedDialog.Show(this, existing.Count == 1 ? $"Replace “{Path.GetFileName(existing[0])}”?" : $"Replace {existing.Count} files of {what}?",
            $"They are already in {Path.GetDirectoryName(existing[0])}:\n{list}\n\nReplacing keeps your game project's references working; keeping both numbers the new files.",
            [new DialogButton("Cancel", "cancel", Cancel: true), new DialogButton("Keep both", "keep"), new DialogButton("Replace", "replace", Primary: true)]);
        return choice is "replace" or "keep" ? choice : null;
    }

    private object ExportProjectsPayload() => new
    {
        projects = ExportProjects.List().Select(p => new { id = p.Id, name = p.Name, root = p.Root, missing = !Directory.Exists(p.Root) }),
        layouts = ExportLayouts.All.Select(l => new { id = l.Id, name = l.Name, description = l.Description, texture = new { folder = l.TextureFolder, file = l.TextureFile }, sound = new { folder = l.SoundFolder, file = l.SoundFile }, music = new { folder = l.MusicFolder, file = l.MusicFile }, model = new { folder = l.ModelFolder, file = l.ModelFile } }),
    };

    /// <summary>The tokens of a material or sound: its name, family and size; a map's tokens are added per file.</summary>
    private static Dictionary<string, string> ExportTokens(string name, string family, int size, string? project)
    {
        var t = ExportLayouts.NameTokens(name);
        foreach (var kv in ExportLayouts.NameTokens(string.IsNullOrWhiteSpace(family) ? "Custom" : family, "family")) t[kv.Key] = kv.Value;
        t["size"] = size > 0 ? size.ToString(System.Globalization.CultureInfo.InvariantCulture) : "";
        t["project"] = project ?? "";
        return t;
    }

    /// <summary>
    /// Exported sounds and songs added to the Music Bench's library (in a "Made in NoorMD" playlist), to audition,
    /// rate, tag and compare them there. Returns how many were added.
    /// </summary>
    private async Task<int> AddToMusicBenchAsync(IEnumerable<string> files)
    {
        var audio = files.Where(f => NoorMD.Media.AudioFormats.IsAudio(f) && File.Exists(f)).ToList();
        if (audio.Count == 0) return 0;
        var lib = Music;
        var count = await Task.Run(() =>
        {
            var ids = audio.Select(lib.AddFile).ToList();
            var playlist = lib.Playlists().FirstOrDefault(pl => pl.Name == "Made in NoorMD")?.Id ?? lib.CreatePlaylist("Made in NoorMD");
            lib.AddToPlaylist(playlist, ids.Where(id => !lib.PlaylistTrackIds(playlist).Contains(id)));
            return ids.Count;
        });
        PushEvent("music.changed", new { });
        return count;
    }

    private object? DispatchExport(BridgeRequest req)
    {
        var p = req.Payload;
        switch (req.Type)
        {
            case "export.projects": return ExportProjectsPayload();
            case "export.project.add":
            {
                var dlg = new OpenFolderDialog { Title = "Choose your game project's folder (exports will be arranged inside it)" };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var added = ExportProjects.Add(dlg.FolderName);
                return new { id = added.Id, all = ExportProjectsPayload() };
            }
            case "export.project.remove":
                ExportProjects.Remove(req.GetString("id", 20) ?? "");
                return ExportProjectsPayload();
            case "export.plan":
            {
                // A preview of where the files will go, as relative paths (and under which project).
                var bench = req.GetString("bench", 10) switch { "sound" => "sound", "music" => "music", "model" => "model", _ => "texture" };
                var place = ExportPlaceFrom(p, bench);
                var name = req.GetString("name", 200) ?? "Untitled";
                var tokens = ExportTokens(name, req.GetString("family", 80) ?? "", (int)(Json.OptDouble(p, "size") ?? 0), place.Project?.Name);
                var folders = ExportLayouts.Folders(ExportLayouts.Expand(place.FolderPattern, tokens));
                var files = new List<string>();
                if (bench == "texture")
                {
                    var target = req.GetString("target", 20) ?? "generic";
                    if (!TextureTargets.ContainsKey(target)) target = "generic";
                    List<(string Suffix, string What)> maps;
                    try { maps = TextureOutputs(p, target); } catch (BridgeError) { maps = []; }
                    foreach (var (suffix, _) in maps)
                    {
                        var t = new Dictionary<string, string>(tokens); foreach (var kv in ExportLayouts.MapTokens(suffix)) t[kv.Key] = kv.Value;
                        files.Add(ExportLayouts.FileName(ExportLayouts.Expand(place.FilePattern, t), name) + ".png");
                    }
                    files.Add(ExportLayouts.FileName(tokens["name"], name) + ".noortex.json");
                }
                else if (bench == "model")
                {
                    var file = ExportLayouts.FileName(ExportLayouts.Expand(place.FilePattern, tokens), name);
                    var lods = Math.Clamp((int)(Json.OptDouble(p, "lods") ?? 1), 1, 6);
                    var variants = Math.Clamp((int)(Json.OptDouble(p, "variants") ?? 1), 1, NoorMD.Media.Assets3D.TreeVariants.MaxCount);
                    var stem = ExportLayouts.FileName(tokens["name"], name);
                    // A variety pack lists the first tree's files and says how many more there are.
                    var first = variants > 1 ? $"{file}_01" : file;
                    if (lods > 1 && req.GetString("lodFiles", 10) != "one") for (var i = 0; i < lods; i++) files.Add($"{first}_LOD{i}.glb");
                    else files.Add(first + ".glb");
                    files.Add((variants > 1 ? stem + "_01" : stem) + (req.GetString("recipeKind", 10) == "rock" ? ".noorrock.json" : ".noortree.json"));
                    if (variants > 1) files.Add($"… and the same for _02 to _{variants:00}");
                    files.Add(stem + ".manifest.json");
                }
                else if (bench == "music")
                {
                    var file = ExportLayouts.FileName(ExportLayouts.Expand(place.FilePattern, tokens), name);
                    var parts = p.TryGetProperty("parts", out var pa) && pa.ValueKind == JsonValueKind.Object ? pa : default;
                    bool Part(string key, bool fallback) => parts.ValueKind == JsonValueKind.Object && parts.TryGetProperty(key, out var v) ? v.ValueKind == JsonValueKind.True : fallback;
                    var fmt = req.GetString("format", 8);
                    string[] exts = fmt == "both" ? [".wav", ".ogg"] : [fmt == "ogg" ? ".ogg" : ".wav"];
                    var layerNames = p.TryGetProperty("layers", out var ln) && ln.ValueKind == JsonValueKind.Array
                        ? ln.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Take(4).Select(x => x.GetString()!).ToList() : [];
                    foreach (var ext in exts)
                    {
                        if (Part("mix", true)) files.Add(file + ext);
                        if (Part("loop", false)) files.Add(file + "_loop" + ext);
                        if (Part("layers", false)) files.AddRange(layerNames.Select(l => ExportLayouts.FileName($"{file}_{ExportLayouts.NameTokens(l)["name"]}_loop", name) + ext));
                    }
                    if (Part("stems", false)) files.Add(file + " stems/01 …wav");
                    if (Part("midi", false)) files.Add(file + ".mid");
                    files.Add(ExportLayouts.FileName(tokens["name"], name) + ".noorsong.json");
                }
                else
                {
                    var count = Math.Clamp((int)(Json.OptDouble(p, "variations") ?? 1), 1, 20);
                    var fmt = req.GetString("format", 8);
                    string[] exts = fmt == "both" ? [".wav", ".ogg"] : [fmt == "ogg" ? ".ogg" : ".wav"];
                    for (var i = 1; i <= Math.Min(count, 3); i++)
                    {
                        var t = new Dictionary<string, string>(tokens) { ["n"] = i.ToString("00", System.Globalization.CultureInfo.InvariantCulture) };
                        foreach (var ext in exts) files.Add(ExportLayouts.FileName(ExportLayouts.Expand(place.FilePattern, t, single: count == 1), name) + ext);
                    }
                    if (count > 3) files.Add("…");
                    files.Add(ExportLayouts.FileName(tokens["name"], name) + ".noorsound.json");
                }
                return new { project = place.Project?.Name, root = place.Project?.Root, folder = string.Join('/', folders), files };
            }
            default: throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }
}
