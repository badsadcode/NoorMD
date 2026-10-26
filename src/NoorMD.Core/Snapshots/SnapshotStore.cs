using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NoorMD.Core.Documents;
using NoorMD.Core.Settings;

namespace NoorMD.Core.Snapshots;

public sealed class Snapshot
{
    public string Id { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
    public string Label { get; set; } = "";
    public string? Title { get; set; }
    public int Words { get; set; }
    public string Markdown { get; set; } = "";
}

public sealed record SnapshotInfo(string Id, DateTime CreatedUtc, string Label, string? Title, int Words);

internal sealed class SnapshotFile
{
    public string? DocumentPath { get; set; }
    public List<Snapshot> Items { get; set; } = [];
}

/// <summary>
/// Manual and automatic revision snapshots, one JSON file per document, kept in app data so they
/// survive restarts. Saved documents are keyed by their full path; untitled ones by session id.
/// </summary>
public sealed class SnapshotStore(string directory)
{
    public const int MaxPerDocument = 50;
    private readonly object _gate = new();

    public static string KeyForPath(string path)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(path).ToUpperInvariant()));
        return "doc-" + Convert.ToHexString(bytes, 0, 16).ToLowerInvariant();
    }

    public static string KeyForUntitled(string sessionId) => "untitled-" + sessionId;

    private string FileFor(string key)
    {
        if (key.Any(c => !(char.IsAsciiLetterOrDigit(c) || c == '-'))) throw new ArgumentException("Invalid snapshot key.");
        return Path.Combine(directory, key + ".json");
    }

    public IReadOnlyList<SnapshotInfo> List(string key)
    {
        lock (_gate)
            return Read(key).Items.Select(s => new SnapshotInfo(s.Id, s.CreatedUtc, s.Label, s.Title, s.Words)).ToList();
    }

    public SnapshotInfo Create(string key, string markdown, string label, string? title, string? documentPath)
    {
        lock (_gate)
        {
            var file = Read(key);
            var snap = new Snapshot
            {
                Id = Guid.NewGuid().ToString("N"), CreatedUtc = DateTime.UtcNow,
                Label = string.IsNullOrWhiteSpace(label) ? "Snapshot" : label.Trim()[..Math.Min(label.Trim().Length, 120)],
                Title = title, Words = TextFileCodec.CountWords(markdown), Markdown = markdown,
            };
            file.DocumentPath = documentPath ?? file.DocumentPath;
            file.Items.Insert(0, snap);
            if (file.Items.Count > MaxPerDocument) file.Items.RemoveRange(MaxPerDocument, file.Items.Count - MaxPerDocument);
            Write(key, file);
            return new SnapshotInfo(snap.Id, snap.CreatedUtc, snap.Label, snap.Title, snap.Words);
        }
    }

    public Snapshot? Get(string key, string id)
    {
        lock (_gate) return Read(key).Items.FirstOrDefault(s => s.Id == id);
    }

    public bool Delete(string key, string id)
    {
        lock (_gate)
        {
            var file = Read(key);
            if (file.Items.RemoveAll(s => s.Id == id) == 0) return false;
            Write(key, file);
            return true;
        }
    }

    /// <summary>Moves snapshots when an untitled document is saved for the first time (or saved under a new name).</summary>
    public void Merge(string fromKey, string toKey, string? documentPath)
    {
        if (fromKey == toKey) return;
        lock (_gate)
        {
            var from = Read(fromKey);
            if (from.Items.Count == 0) return;
            var to = Read(toKey);
            to.Items = from.Items.Concat(to.Items).OrderByDescending(s => s.CreatedUtc).Take(MaxPerDocument).ToList();
            to.DocumentPath = documentPath;
            Write(toKey, to);
            if (fromKey.StartsWith("untitled-", StringComparison.Ordinal)) TryDelete(FileFor(fromKey));
        }
    }

    /// <summary>Removes snapshot files of untitled documents older than the given age.</summary>
    public void PruneUntitled(TimeSpan olderThan)
    {
        if (!Directory.Exists(directory)) return;
        foreach (var f in Directory.EnumerateFiles(directory, "untitled-*.json"))
            if (DateTime.UtcNow - File.GetLastWriteTimeUtc(f) > olderThan) TryDelete(f);
    }

    private SnapshotFile Read(string key)
    {
        var path = FileFor(key);
        if (!File.Exists(path)) return new SnapshotFile();
        try { return JsonSerializer.Deserialize<SnapshotFile>(File.ReadAllText(path), SettingsStore.Json) ?? new SnapshotFile(); }
        catch (JsonException)
        {
            try { File.Move(path, path + ".corrupt", overwrite: true); } catch { }
            return new SnapshotFile();
        }
    }

    private void Write(string key, SnapshotFile file)
    {
        Directory.CreateDirectory(directory);
        AtomicFile.WriteAllText(FileFor(key), JsonSerializer.Serialize(file, SettingsStore.Json));
    }

    private static void TryDelete(string path) { try { File.Delete(path); } catch { } }
}
