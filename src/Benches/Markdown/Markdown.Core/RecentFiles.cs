using System.Text.Json;

namespace Markdown.Core;

/// <summary>Files opened or saved lately, newest first. Being on this list is also what lets the bench open a file
/// again without a dialog: the user picked it once.</summary>
public sealed class RecentFiles(string file, int max = 30)
{
    readonly List<string> _paths = Load(file);

    public IReadOnlyList<string> Paths => _paths;

    public bool Contains(string path) => _paths.Contains(Normal(path), StringComparer.OrdinalIgnoreCase);

    public void Add(string path)
    {
        var p = Normal(path);
        _paths.RemoveAll(x => string.Equals(x, p, StringComparison.OrdinalIgnoreCase));
        _paths.Insert(0, p);
        if (_paths.Count > max) _paths.RemoveRange(max, _paths.Count - max);
        Save();
    }

    public void Remove(string path)
    {
        if (_paths.RemoveAll(x => string.Equals(x, Normal(path), StringComparison.OrdinalIgnoreCase)) > 0) Save();
    }

    public void Clear() { _paths.Clear(); Save(); }

    static string Normal(string path) => System.IO.Path.GetFullPath(path);

    static List<string> Load(string file)
    {
        try { return JsonSerializer.Deserialize<List<string>>(File.ReadAllText(file))?.Where(p => !string.IsNullOrWhiteSpace(p) && System.IO.Path.IsPathFullyQualified(p)).ToList() ?? []; }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { return []; }
    }

    void Save()
    {
        try { AtomicFile.WriteAllText(file, JsonSerializer.Serialize(_paths)); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}
