using System.Globalization;
using System.Text;
using System.Text.Json;
using NoorMD.Core.Documents;

namespace NoorMD.Core.Export;

/// <summary>
/// Where a bench's export goes inside the folder you choose (or a game project's folder), and what its files are
/// called: a folder pattern and a file-name pattern with tokens. NoorMaterial, NoorSound, NoorSequencer and NoorForm share the templates.
/// </summary>
/// <param name="TextureFolder">Folder for a material's maps, recipe and paintings.</param>
/// <param name="TextureFile">A map's file name (without .png).</param>
/// <param name="SoundFolder">Folder for a sound's WAV files, stems and recipe.</param>
/// <param name="SoundFile">A sound file's name (without .wav); {n} is the variation (01, 02…), dropped when there is one.</param>
/// <param name="MusicFolder">Folder for a song's WAV, loop, stems, MIDI and recipe.</param>
/// <param name="MusicFile">A song file's name (without the extension; the loop adds _loop).</param>
/// <param name="ModelFolder">Folder for a 3D asset's files (GLB, recipe, manifest).</param>
/// <param name="ModelFile">A 3D asset's file name (without .glb; separate levels of detail add _LOD0, _LOD1…).</param>
public sealed record ExportLayout(string Id, string Name, string Description, string TextureFolder, string TextureFile, string SoundFolder, string SoundFile,
    string MusicFolder = "", string MusicFile = "{name}", string ModelFolder = "", string ModelFile = "{name}");

public static class ExportLayouts
{
    public static readonly IReadOnlyList<ExportLayout> All =
    [
        new("flat", "Flat: everything in the folder", "The files go straight into the folder.", "", "{name}_{map}", "", "{name}_{n}", "", "{name}", "", "{name}"),
        new("per-item", "A folder for each", "Its own folder for each material, sound or model, named after it.", "{name}", "{name}_{map}", "{name}", "{name}_{n}", "{name}", "{name}", "{name}", "{name}"),
        new("godot", "Godot", "res:// style: lower-case folders and snake_case names.", "assets/materials/{name_snake}", "{name_snake}_{map}", "assets/audio/sfx/{name_snake}", "{name_snake}_{n}", "assets/audio/music/{name_snake}", "{name_snake}", "assets/models/{family_snake}/{name_snake}", "{name_snake}"),
        new("unity", "Unity", "Assets/… with PascalCase names.", "Assets/Materials/{Name}/Textures", "{Name}_{Map}", "Assets/Audio/SFX/{Name}", "{Name}_{n}", "Assets/Audio/Music/{Name}", "{Name}", "Assets/Models/{Family}/{Name}", "{Name}"),
        new("unreal", "Unreal Engine", "Content/… with the usual prefixes: T_ for textures, A_ for audio, SM_ for meshes, short map codes (BC, N, ORM).", "Content/Materials/{Name}", "T_{Name}_{MAP}", "Content/Audio/SFX/{Name}", "A_{Name}_{n}", "Content/Audio/Music/{Name}", "A_{Name}", "Content/{Family}/{Name}", "SM_{Name}"),
        new("by-size", "By size or kind", "Textures by their size; sounds, music and models by their family.", "Textures/{size}/{name}", "{name}_{map}", "Audio/{family}/{name}", "{name}_{n}", "Audio/Music/{family}/{name}", "{name}", "Models/{family}/{name}", "{name}"),
    ];

    public static ExportLayout? Get(string? id) => All.FirstOrDefault(l => l.Id == id);

    public const int MaxPattern = 200, MaxDepth = 10, MaxSegment = 80;

    /// <summary>The tokens a name gives: as typed ({name}, spaces as _), {Name} (PascalCase), {name_snake}, {name-kebab}.</summary>
    public static Dictionary<string, string> NameTokens(string name, string prefix = "name")
    {
        var words = Words(name);
        var cap = char.ToUpperInvariant(prefix[0]) + prefix[1..];
        return new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [prefix] = string.Join('_', name.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries)),
            [cap] = string.Concat(words.Select(w => char.ToUpperInvariant(w[0]) + w[1..])),
            [prefix + "_snake"] = string.Join('_', words.Select(w => w.ToLowerInvariant())),
            [prefix + "-kebab"] = string.Join('-', words.Select(w => w.ToLowerInvariant())),
        };
    }

    /// <summary>A map's tokens: {map} (albedo, normal…), {Map} (Albedo, MetallicSmoothness…), {MAP} (BC, N, R, AO, M, H, ORM, MS).</summary>
    public static Dictionary<string, string> MapTokens(string suffix) => new(StringComparer.Ordinal)
    {
        ["map"] = suffix,
        ["Map"] = string.Concat(Words(suffix).Select(w => char.ToUpperInvariant(w[0]) + w[1..])),
        ["MAP"] = suffix switch
        {
            "albedo" or "basecolor" => "BC", "normal" => "N", "roughness" => "R", "ao" => "AO", "metallic" => "M",
            "height" => "H", "orm" => "ORM", "metallic_smoothness" => "MS", _ => suffix.ToUpperInvariant(),
        },
    };

    private static List<string> Words(string s)
    {
        var words = new List<string>();
        var cur = new StringBuilder();
        foreach (var c in s)
        {
            if (char.IsLetterOrDigit(c))
            {
                // A capital after a small letter starts a new word (RedBricks → Red, Bricks).
                if (char.IsUpper(c) && cur.Length > 0 && char.IsLower(cur[^1])) { words.Add(cur.ToString()); cur.Clear(); }
                cur.Append(c);
            }
            else if (cur.Length > 0) { words.Add(cur.ToString()); cur.Clear(); }
        }
        if (cur.Length > 0) words.Add(cur.ToString());
        return words.Count == 0 ? ["untitled"] : words;
    }

    /// <summary>
    /// Fills a pattern's {tokens}. Unknown tokens are left out. With one variation, {n} goes, with the _ - or space
    /// before it.
    /// </summary>
    public static string Expand(string pattern, IReadOnlyDictionary<string, string> tokens, bool single = false)
    {
        if (pattern.Length > MaxPattern) pattern = pattern[..MaxPattern];
        if (single) pattern = pattern.Replace("_{n}", "").Replace("-{n}", "").Replace(" {n}", "").Replace("{n}", "");
        var sb = new StringBuilder();
        for (var i = 0; i < pattern.Length; i++)
        {
            if (pattern[i] == '{')
            {
                var end = pattern.IndexOf('}', i + 1);
                if (end > i)
                {
                    if (tokens.TryGetValue(pattern[(i + 1)..end], out var v)) sb.Append(v);
                    i = end;
                    continue;
                }
            }
            sb.Append(pattern[i]);
        }
        return sb.ToString();
    }

    private static readonly HashSet<char> Invalid = Path.GetInvalidFileNameChars().Concat(['\\', '/', ':', '*', '?', '"', '<', '>', '|']).ToHashSet();
    private static readonly string[] Reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"];

    /// <summary>One folder or file name: no characters Windows refuses, no dots or spaces at the ends, not a device name.</summary>
    public static string Segment(string s)
    {
        var cleaned = new string(s.Select(c => Invalid.Contains(c) || char.IsControl(c) ? '_' : c).ToArray()).Trim(' ', '.');
        if (cleaned.Length > MaxSegment) cleaned = cleaned[..MaxSegment].TrimEnd(' ', '.');
        if (Reserved.Contains(cleaned.Split('.')[0], StringComparer.OrdinalIgnoreCase)) cleaned += "_";
        return cleaned;
    }

    /// <summary>A folder pattern, filled in, as safe relative folder names (empty: the folder itself). ".." and roots are dropped.</summary>
    public static IReadOnlyList<string> Folders(string expanded) =>
        expanded.Replace('\\', '/').Split('/').Select(Segment).Where(p => p.Length > 0 && p != "." && p != "..").Take(MaxDepth).ToList();

    /// <summary>A file name from a pattern (any folders in it are flattened), never empty.</summary>
    public static string FileName(string expanded, string fallback)
    {
        var name = Segment(expanded.Replace('/', '_').Replace('\\', '_'));
        if (name.Trim('_', '-', ' ').Length > 0) return name;
        var f = Segment(fallback);
        return f.Trim('_', '-', ' ').Length > 0 ? f : "untitled";
    }

    /// <summary>The folder under <paramref name="root"/>; refuses anything that would end up outside it.</summary>
    public static string Under(string root, IReadOnlyList<string> folders)
    {
        var baseFull = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        var full = Path.GetFullPath(Path.Combine([baseFull, .. folders]));
        if (!full.Equals(baseFull, StringComparison.OrdinalIgnoreCase) && !full.StartsWith(baseFull + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("That folder pattern leads outside the export folder.");
        return full;
    }
}

/// <summary>A game project: a folder you chose once, which exports go into by the chosen layout.</summary>
public sealed record ExportProject(string Id, string Name, string Root);

/// <summary>The export projects, kept in a small JSON file. Their folders are only ever ones picked in a folder dialog.</summary>
public sealed class ExportProjectStore(string path)
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };

    public IReadOnlyList<ExportProject> List()
    {
        try
        {
            if (!File.Exists(path)) return [];
            var list = JsonSerializer.Deserialize<List<ExportProject>>(File.ReadAllText(path), Json) ?? [];
            return list.Where(p => p != null && !string.IsNullOrWhiteSpace(p.Id) && !string.IsNullOrWhiteSpace(p.Root) && Path.IsPathFullyQualified(p.Root)).Take(50).ToList();
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException) { return []; }
    }

    public ExportProject? Get(string? id) => id == null ? null : List().FirstOrDefault(p => p.Id == id);

    /// <summary>Adds a folder (or returns the project that already has it), named after the folder unless named.</summary>
    public ExportProject Add(string root, string? name = null)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        var list = List().ToList();
        if (list.FirstOrDefault(p => p.Root.Equals(full, StringComparison.OrdinalIgnoreCase)) is { } known) return known;
        var label = string.IsNullOrWhiteSpace(name) ? Path.GetFileName(full) : name.Trim();
        if (label.Length == 0) label = full;
        if (label.Length > 60) label = label[..60];
        var id = "p" + (list.Count == 0 ? 1 : list.Max(p => int.TryParse(p.Id.AsSpan(1), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0) + 1).ToString(CultureInfo.InvariantCulture);
        var project = new ExportProject(id, label, full);
        list.Add(project);
        Save(list);
        return project;
    }

    public void Remove(string id) => Save(List().Where(p => p.Id != id).ToList());

    private void Save(List<ExportProject> list)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        AtomicFile.WriteAllText(path, JsonSerializer.Serialize(list, Json));
    }
}
