using NoorMD.Core.Documents;
using NoorMD.Core.Snapshots;

namespace NoorMD.Host;

/// <summary>
/// Host-side facts about one document tab. The text itself lives in that tab's editor; the host only keeps the
/// latest autosaved copy (for recovery and for restoring the editor after a renderer crash). Every operation names
/// its tab, so nothing here ever reads "whatever is on screen".
/// </summary>
internal sealed class DocumentSession(string tabId)
{
    public string TabId { get; } = tabId;
    public string? Path { get; private set; }
    /// <summary>Canonical identity of <see cref="Path"/> (long names, real casing, links resolved) for "already open" checks.</summary>
    public string? PathKey { get; private set; }
    public TextFormat Format { get; private set; } = TextFormat.Default;
    public FileStamp? Stamp { get; set; }
    public string UntitledTitle { get; set; } = "Untitled document";
    public bool Dirty { get; set; }
    public string? LastMarkdown { get; set; }
    public string SnapshotKey { get; private set; } = SnapshotStore.KeyForUntitled(Guid.NewGuid().ToString("N"));

    // Tab state reported by the page and remembered in the session.
    public bool Pinned { get; set; }
    public string? Mode { get; set; }
    /// <summary>Text of a clean untitled tab, captured when the window closes, so the session can bring it back.</summary>
    public string? SessionText { get; set; }
    /// <summary>The user chose "Don't save" for this untitled tab on close: it is not part of the next session.</summary>
    public bool Discarded { get; set; }

    /// <summary>A disk version the user already chose to keep their own text over.</summary>
    public FileStamp? AcknowledgedExternalStamp { get; set; }
    public bool DeletionNoticeShown { get; set; }

    public string? Folder => Path == null ? null : System.IO.Path.GetDirectoryName(Path);
    public string FileName => Path == null ? UntitledTitle : System.IO.Path.GetFileName(Path);
    public string Title => Path == null ? UntitledTitle : System.IO.Path.GetFileNameWithoutExtension(Path);

    public void ResetUntitled(string title)
    {
        Path = null;
        PathKey = null;
        Format = TextFormat.Default;
        Stamp = null;
        UntitledTitle = string.IsNullOrWhiteSpace(title) ? "Untitled document" : title;
        Dirty = false;
        LastMarkdown = null;
        SnapshotKey = SnapshotStore.KeyForUntitled(Guid.NewGuid().ToString("N"));
        AcknowledgedExternalStamp = null;
        DeletionNoticeShown = false;
    }

    /// <summary>An untitled document coming back after a restart keeps its snapshots.</summary>
    public void KeepSnapshotKey(string? key)
    {
        if (Path == null && key != null && key.StartsWith("untitled-", StringComparison.Ordinal) && key.Length <= 80 && key.All(c => char.IsAsciiLetterOrDigit(c) || c == '-'))
            SnapshotKey = key;
    }

    public void SetFile(string path, TextFormat format, FileStamp? stamp)
    {
        Path = System.IO.Path.GetFullPath(path);
        PathKey = PathIdentity.Key(Path);
        Format = format;
        Stamp = stamp;
        SnapshotKey = SnapshotStore.KeyForPath(Path);
        AcknowledgedExternalStamp = null;
        DeletionNoticeShown = false;
    }
}
