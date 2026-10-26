using System.Text.Json;
using NoorMD.Core.Documents;
using NoorMD.Core.Settings;

namespace NoorMD.Core.Recovery;

public sealed class RecoveryDraft
{
    public string Id { get; set; } = "";
    public string? Title { get; set; }
    public string? Path { get; set; }
    public string Markdown { get; set; } = "";
    public DateTime SavedUtc { get; set; }
    public string EncodingName { get; set; } = "UTF-8";
    public bool Bom { get; set; }
    public string Eol { get; set; } = "LF";
    public bool FinalNewline { get; set; } = true;

    public TextFormat ToFormat() => new(EncodingName, Bom, Eol == "CRLF" ? LineEnding.CRLF : LineEnding.LF, FinalNewline);
}

public sealed record RecoverySummary(string Id, string? Title, string? Path, DateTime SavedUtc, int Words);

/// <summary>
/// Unsaved-work drafts. Each running window owns one draft file (named by its session id) and holds an
/// exclusive lock file while alive. Drafts whose lock is not held belong to a session that ended without
/// saving (crash, power loss, "Don't save" never chosen) and are offered for recovery.
/// </summary>
public sealed class RecoveryStore : IDisposable
{
    private readonly string _dir;
    private FileStream? _lock;

    public string SessionId { get; }

    public RecoveryStore(string directory, string? sessionId = null)
    {
        _dir = directory;
        Directory.CreateDirectory(_dir);
        SessionId = sessionId ?? Guid.NewGuid().ToString("N");
        _lock = new FileStream(LockPath(SessionId), FileMode.Create, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose);
    }

    public static bool IsValidId(string? id) => id is { Length: 32 } && id.All(Uri.IsHexDigit);

    private string DraftPath(string id) => Path.Combine(_dir, id + ".json");
    private string LockPath(string id) => Path.Combine(_dir, id + ".lock");

    public void SaveOwn(string markdown, string? title, string? path, TextFormat format)
    {
        var draft = new RecoveryDraft
        {
            Id = SessionId, Title = title, Path = path, Markdown = markdown, SavedUtc = DateTime.UtcNow,
            EncodingName = format.EncodingName, Bom = format.Bom, Eol = format.Eol.ToString(), FinalNewline = format.FinalNewline,
        };
        AtomicFile.WriteAllText(DraftPath(SessionId), JsonSerializer.Serialize(draft, SettingsStore.Json));
    }

    public void DeleteOwn()
    {
        try { File.Delete(DraftPath(SessionId)); } catch { /* retried on next save */ }
    }

    public bool HasOwnDraft => File.Exists(DraftPath(SessionId));

    /// <summary>Drafts left behind by sessions that are no longer running.</summary>
    public List<RecoverySummary> ListOrphans()
    {
        var list = new List<RecoverySummary>();
        foreach (var file in Directory.EnumerateFiles(_dir, "*.json"))
        {
            var id = Path.GetFileNameWithoutExtension(file);
            if (!IsValidId(id) || id == SessionId || IsLive(id)) continue;
            var draft = TryRead(file);
            if (draft == null) continue;
            list.Add(new RecoverySummary(id, draft.Title, draft.Path, draft.SavedUtc, TextFileCodec.CountWords(draft.Markdown)));
        }
        return list.OrderByDescending(d => d.SavedUtc).ToList();
    }

    public RecoveryDraft? LoadOrphan(string id)
    {
        if (!IsValidId(id) || id == SessionId || IsLive(id)) return null;
        return TryRead(DraftPath(id));
    }

    public bool DiscardOrphan(string id)
    {
        if (!IsValidId(id) || id == SessionId || IsLive(id)) return false;
        try { File.Delete(DraftPath(id)); return true; } catch { return false; }
    }

    public int DiscardAllOrphans() => ListOrphans().Count(d => DiscardOrphan(d.Id));

    private bool IsLive(string id)
    {
        var lockPath = LockPath(id);
        if (!File.Exists(lockPath)) return false;
        try
        {
            // If we can open it exclusively, its owner is gone.
            using var probe = new FileStream(lockPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose);
            return false;
        }
        catch (IOException) { return true; }
        catch (UnauthorizedAccessException) { return true; }
    }

    private static RecoveryDraft? TryRead(string file)
    {
        try { return JsonSerializer.Deserialize<RecoveryDraft>(File.ReadAllText(file), SettingsStore.Json); }
        catch { return null; }
    }

    public void Dispose()
    {
        _lock?.Dispose();
        _lock = null;
    }
}
