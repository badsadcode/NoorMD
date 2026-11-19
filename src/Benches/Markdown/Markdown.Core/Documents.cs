namespace Markdown.Core;

/// <summary>The documents open in a Markdown bench, as far as files go: where each lives, how it was stored (so it's
/// saved back the same way) and which version of the file it was opened from (so another program's changes are
/// noticed before they're overwritten). Files are opened only when the user picked them (now, or once before: the
/// recent list).</summary>
public sealed class Documents
{
    sealed class Doc { public string? Path; public TextFormat Format = TextFormat.Default; public FileStamp? Stamp; }

    readonly Dictionary<string, Doc> _docs = new(StringComparer.Ordinal);
    readonly HashSet<string> _picked = new(StringComparer.OrdinalIgnoreCase);

    public Documents(string dataFolder)
    {
        Directory.CreateDirectory(dataFolder);
        Recent = new RecentFiles(System.IO.Path.Combine(dataFolder, "recent.json"));
        Drafts = new DraftStore(System.IO.Path.Combine(dataFolder, "drafts"));
        Snapshots = new SnapshotStore(System.IO.Path.Combine(dataFolder, "snapshots"));
    }

    public SnapshotStore Snapshots { get; }

    /// <summary>Where a document's snapshots live: by its file once it has one, by its id before.</summary>
    public string SnapshotKey(string id) => PathOf(Id(id)) is { } p ? SnapshotStore.KeyForPath(p) : SnapshotStore.KeyForUntitled(id);

    public RecentFiles Recent { get; }
    public DraftStore Drafts { get; }

    /// <summary>The user chose these in a dialog (or dropped them on the window).</summary>
    public void Picked(IEnumerable<string> paths) { foreach (var p in paths) _picked.Add(System.IO.Path.GetFullPath(p)); }

    public bool MayOpen(string path) => _picked.Contains(System.IO.Path.GetFullPath(path)) || Recent.Contains(path);

    static string Id(string id) => DraftStore.IsValidId(id) ? id : throw new ArgumentException("That isn't a document id.");

    public LoadedDocument Open(string id, string path)
    {
        Id(id);
        if (!System.IO.Path.IsPathFullyQualified(path)) throw new UnauthorizedAccessException("Open that file with File › Open first.");
        if (!System.IO.Path.IsPathFullyQualified(path) || !MayOpen(path)) throw new UnauthorizedAccessException("Open that file with File › Open first.");
        if (!DocumentFile.IsOpenable(path)) throw new IOException($"\"{System.IO.Path.GetFileName(path)}\" isn't a Markdown or text file.");
        var doc = DocumentFile.Load(path);
        _docs[id] = new Doc { Path = doc.Path, Format = doc.Format, Stamp = doc.Stamp };
        Recent.Add(doc.Path);
        return doc;
    }

    /// <summary>A document that came back from a draft: carries on with the file facts the draft kept.</summary>
    public void Resume(Draft draft) => _docs[Id(draft.Id)] = new Doc { Path = draft.Path, Format = draft.Format, Stamp = draft.Stamp };

    public string? PathOf(string id) => _docs.TryGetValue(id, out var d) ? d.Path : null;
    public TextFormat FormatOf(string id) => _docs.TryGetValue(id, out var d) ? d.Format : TextFormat.Default;
    public FileStamp? StampOf(string id) => _docs.TryGetValue(id, out var d) ? d.Stamp : null;

    /// <summary>True when the file on disk isn't the version the document was opened from (or saved as last).</summary>
    public bool ChangedOnDisk(string id)
    {
        if (!_docs.TryGetValue(id, out var d) || d.Path == null || d.Stamp == null) return false;
        var now = FileStamp.Read(d.Path);
        return now == null || now != d.Stamp;
    }

    public enum SaveOutcome { Saved, NoPath, Conflict }

    public SaveOutcome Save(string id, string markdown, bool overwrite = false)
    {
        if (!_docs.TryGetValue(Id(id), out var d) || d.Path == null) return SaveOutcome.NoPath;
        if (!overwrite && File.Exists(d.Path) && ChangedOnDisk(id)) return SaveOutcome.Conflict;
        d.Stamp = DocumentFile.Save(d.Path, markdown, d.Format, null);
        Drafts.Delete(id);
        Recent.Add(d.Path);
        return SaveOutcome.Saved;
    }

    /// <summary>Saves to a path the user just chose (Save As, or the first save of a new document).</summary>
    public void SaveAs(string id, string path, string markdown)
    {
        Id(id);
        var full = System.IO.Path.GetFullPath(path);
        var d = _docs.TryGetValue(id, out var x) ? x : _docs[id] = new Doc();
        var oldKey = SnapshotKey(id);
        d.Path = full;
        Snapshots.Merge(oldKey, SnapshotKey(id), full);   // the history comes along to the new file
        d.Stamp = DocumentFile.Save(full, markdown, d.Format, null);
        _picked.Add(full);
        Drafts.Delete(id);
        Recent.Add(full);
    }

    public void WriteDraft(string id, string markdown, string? title)
    {
        var d = _docs.TryGetValue(Id(id), out var x) ? x : new Doc();
        Drafts.Save(new Draft
        {
            Id = id, Path = d.Path, Title = string.IsNullOrWhiteSpace(title) ? "Untitled document" : title.Trim(), Markdown = markdown, SavedUtc = DateTime.UtcNow,
            EncodingName = d.Format.EncodingName, Bom = d.Format.Bom, Eol = d.Format.Eol.ToString(), FinalNewline = d.Format.FinalNewline,
            StampUtc = d.Stamp?.LastWriteUtc, StampLength = d.Stamp?.Length,
        });
    }

    /// <summary>The document is gone (closed): its draft goes with it.</summary>
    public void Close(string id)
    {
        _docs.Remove(Id(id));
        Drafts.Delete(id);
    }
}
