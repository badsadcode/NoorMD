using NoorMD.Core.Documents;
using NoorMD.Core.Snapshots;

namespace NoorMD.Host;

/// <summary>
/// Host-side facts about the document open in a window. The text itself lives in the editor; the host
/// only keeps the latest autosaved copy (for recovery and for restoring the editor after a renderer crash).
/// </summary>
internal sealed class DocumentSession
{
    public string? Path { get; private set; }
    public TextFormat Format { get; private set; } = TextFormat.Default;
    public FileStamp? Stamp { get; set; }
    public string UntitledTitle { get; set; } = "Untitled document";
    public bool Dirty { get; set; }
    public string? LastMarkdown { get; set; }
    public string SnapshotKey { get; private set; } = SnapshotStore.KeyForUntitled(Guid.NewGuid().ToString("N"));

    /// <summary>A disk version the user already chose to keep their own text over.</summary>
    public FileStamp? AcknowledgedExternalStamp { get; set; }
    public bool DeletionNoticeShown { get; set; }

    public string? Folder => Path == null ? null : System.IO.Path.GetDirectoryName(Path);
    public string FileName => Path == null ? UntitledTitle : System.IO.Path.GetFileName(Path);
    public string Title => Path == null ? UntitledTitle : System.IO.Path.GetFileNameWithoutExtension(Path);

    public void ResetUntitled(string title)
    {
        Path = null;
        Format = TextFormat.Default;
        Stamp = null;
        UntitledTitle = string.IsNullOrWhiteSpace(title) ? "Untitled document" : title;
        Dirty = false;
        LastMarkdown = null;
        SnapshotKey = SnapshotStore.KeyForUntitled(Guid.NewGuid().ToString("N"));
        AcknowledgedExternalStamp = null;
        DeletionNoticeShown = false;
    }

    public void SetFile(string path, TextFormat format, FileStamp? stamp)
    {
        Path = System.IO.Path.GetFullPath(path);
        Format = format;
        Stamp = stamp;
        SnapshotKey = SnapshotStore.KeyForPath(Path);
        AcknowledgedExternalStamp = null;
        DeletionNoticeShown = false;
    }
}
