using Markdown.Core;

namespace Vault.Core;

/// <summary>How many links (in which notes) a rename or move would change.</summary>
public sealed record LinkPlan(int Links, IReadOnlyList<string> Notes);

/// <summary>What a link update did: links changed, in how many notes, and the notes left alone (open with unsaved
/// changes, or couldn't be written).</summary>
public sealed record LinkResult(int Links, int Notes, IReadOnlyList<string> Skipped)
{
    public static readonly LinkResult None = new(0, 0, []);
    /// <summary>The notes rewritten (full paths), so editors showing them can reload.</summary>
    public IReadOnlyList<string> Updated { get; init; } = [];
}

/// <summary>An open vault: a folder of notes, kept indexed (names, text, links, tags) while it changes on disk. From
/// NoorMD 2.0's vault, without its window: the bench (or any other app) drives it.</summary>
public sealed class VaultSession : IDisposable
{
    readonly FileSystemWatcher? _watcher;
    readonly Timer _rescanTimer;
    readonly SemaphoreSlim _scanGate = new(1, 1);
    readonly CancellationTokenSource _cts = new();
    List<VaultEntry> _entries = [];

    public string Root { get; }
    public string Name => System.IO.Path.GetFileName(Root);
    public VaultIndex Index { get; }
    public VaultFileOps Ops { get; }
    public IReadOnlyCollection<string> Excluded { get; } = VaultPaths.DefaultExcluded;
    public IReadOnlyList<VaultEntry> Entries { get { lock (_scanGate) return _entries; } }
    /// <summary>The first scan; later ones run in the background.</summary>
    public Task Ready { get; private set; }
    /// <summary>After each scan that found changes (from a background thread).</summary>
    public event Action? Changed;

    /// <summary>A folder that can be a vault (an existing folder, not a whole drive); its full path.</summary>
    public static string CheckRoot(string path)
    {
        var root = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(path));
        if (!Directory.Exists(root)) throw new VaultOperationException("That folder doesn't exist.");
        var drive = System.IO.Path.GetPathRoot(root);
        if (string.IsNullOrEmpty(drive) || string.Equals(System.IO.Path.TrimEndingDirectorySeparator(drive), root, StringComparison.OrdinalIgnoreCase))
            throw new VaultOperationException("A whole drive can't be a vault. Choose a folder.");
        return root;
    }

    public VaultSession(string path, bool watch = true)
    {
        Root = CheckRoot(path);
        Index = new VaultIndex(Root);
        Ops = new VaultFileOps(Root);
        _rescanTimer = new Timer(_ => _ = RescanAsync(), null, Timeout.Infinite, Timeout.Infinite);
        Ready = RescanAsync();
        if (!watch) return;
        try
        {
            _watcher = new FileSystemWatcher(Root) { IncludeSubdirectories = true, InternalBufferSize = 64 * 1024, NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size };
            FileSystemEventHandler changed = (_, e) => { if (!Ignored(e.FullPath)) ScheduleRescan(700); };
            _watcher.Created += changed; _watcher.Deleted += changed; _watcher.Changed += changed;
            _watcher.Renamed += (_, _) => ScheduleRescan(700);
            _watcher.Error += (_, _) => ScheduleRescan(700);
            _watcher.EnableRaisingEvents = true;
        }
        catch (Exception ex) when (ex is IOException or ArgumentException or PlatformNotSupportedException) { _watcher = null; }
    }

    bool Ignored(string full)
    {
        var rel = VaultPaths.ToRelative(Root, full);
        return rel == null || rel.Split('/').Any(seg => VaultPaths.IsExcluded(seg, Excluded) || seg.EndsWith(".noor-tmp", StringComparison.Ordinal));
    }

    /// <summary>Scan again soon (several changes in a row make one scan).</summary>
    public void ScheduleRescan(int ms) { try { _rescanTimer.Change(ms, Timeout.Infinite); } catch (ObjectDisposedException) { } }

    /// <summary>Lists the folder and re-reads notes that changed. Scans run one at a time.</summary>
    public async Task RescanAsync()
    {
        if (_cts.IsCancellationRequested) return;
        await _scanGate.WaitAsync();
        try
        {
            var entries = await Task.Run(() => VaultScanner.Scan(Root, Excluded, _cts.Token));
            var read = await Task.Run(() => Index.Update(entries, _cts.Token));
            bool differs;
            lock (_scanGate) { differs = read > 0 || entries.Count != _entries.Count || !entries.Select(e => e.Path).SequenceEqual(_entries.Select(e => e.Path)); _entries = entries; }
            if (differs) Changed?.Invoke();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        finally { _scanGate.Release(); }
    }

    public string? Full(string? rel) => VaultPaths.Resolve(Root, rel);
    public string? Rel(string full) => VaultPaths.ToRelative(Root, full);
    IReadOnlyList<string> FilesNow() => Entries.Where(e => !e.IsFolder).Select(e => e.Path).ToList();

    // ------------------------------------------------------------------ wiki links

    /// <summary>The note a [[link]] in <paramref name="fromRel"/> leads to, or null when there's none yet.</summary>
    public string? ResolveWiki(string fromRel, string target) => VaultLinks.Resolve(fromRel, new VaultLink(target, true), Index.NotePaths());

    /// <summary>Where a [[link]] to a note that doesn't exist yet would create it: "Projects/Alpha" from the vault's
    /// top, a bare name next to the note the link is in. Checks the name; returns (folder, name).</summary>
    public (string Folder, string Name) PlaceForNewLink(string fromRel, string target)
    {
        var clean = target.Replace('\\', '/').Trim('/');
        var name = clean.Split('/').Last().Trim();
        if (VaultPaths.NameProblem(name) is { } problem) throw new VaultOperationException($"“{target}” can't be a note's name: {problem}");
        if (System.IO.Path.HasExtension(name) && !VaultPaths.IsNote(name)) throw new VaultOperationException($"“{name}” isn't in this vault.");
        var folder = clean.Contains('/') ? clean[..clean.LastIndexOf('/')] : fromRel.Contains('/') ? fromRel[..fromRel.LastIndexOf('/')] : "";
        if (folder.Length > 0 && Full(folder) == null) throw new VaultOperationException($"“{target}” points outside the vault.");
        return (folder, name);
    }

    /// <summary>Creates the note a [[link]] points to (and its folder), with a heading; returns its vault path.</summary>
    public string CreateNoteForLink(string fromRel, string target)
    {
        var (folder, name) = PlaceForNewLink(fromRel, target);
        if (folder.Length > 0 && Full(folder) is { } dir) Directory.CreateDirectory(dir);
        var rel = Ops.CreateNote(folder, name, $"# {System.IO.Path.GetFileNameWithoutExtension(name)}\n\n");
        ScheduleRescan(0);
        return rel;
    }

    // ------------------------------------------------------------------ renames and moves keep links working

    Dictionary<string, string> Expand(IEnumerable<(string OldRel, string NewRel)> planned, IReadOnlyList<string> filesBefore)
    {
        var folders = new HashSet<string>(Entries.Where(e => e.IsFolder).Select(e => e.Path), StringComparer.OrdinalIgnoreCase);
        return VaultLinkRewriter.ExpandMoves(planned.Where(p => !string.Equals(p.OldRel, p.NewRel, StringComparison.Ordinal)).Select(p => (p.OldRel, p.NewRel, folders.Contains(p.OldRel))), filesBefore);
    }

    /// <summary>Notes that might link to something moving (they mention its name), or move themselves.</summary>
    IEnumerable<(string Note, string Text, LoadedDocument Doc)> Candidates(IReadOnlyDictionary<string, string> moves, IReadOnlyList<string> filesBefore, bool fromNewPlace)
    {
        var names = moves.Keys.Select(k => System.IO.Path.GetFileNameWithoutExtension(k)).Where(n => n.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        foreach (var note in filesBefore.Where(VaultPaths.IsNote))
        {
            var now = fromNewPlace && moves.TryGetValue(note, out var to) ? to : note;
            var full = Full(now);
            if (full == null || !File.Exists(full)) continue;
            LoadedDocument doc;
            try { if (new FileInfo(full).Length > 4_000_000) continue; doc = DocumentFile.Load(full); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidDataException or System.Text.DecoderFallbackException) { continue; }
            var text = doc.Markdown;
            var plain = text.Contains('\\') ? text.Replace("\\", "") : text;
            if (!moves.ContainsKey(note) && !names.Any(n => plain.Contains(n, StringComparison.OrdinalIgnoreCase) || text.Contains(Uri.EscapeDataString(n), StringComparison.OrdinalIgnoreCase))) continue;
            yield return (note, text, doc);
        }
    }

    /// <summary>How many links renaming / moving these would change (nothing is written).</summary>
    public LinkPlan PlanLinks(IReadOnlyList<(string OldRel, string NewRel)> planned)
    {
        var files = FilesNow();
        var moves = Expand(planned, files);
        if (moves.Count == 0) return new LinkPlan(0, []);
        int links = 0;
        var notes = new List<string>();
        foreach (var (note, text, _) in Candidates(moves, files, fromNewPlace: false))
        {
            var r = VaultLinkRewriter.Rewrite(text, note, moves, files);
            if (r.Changed == 0) continue;
            links += r.Changed; notes.Add(note);
        }
        return new LinkPlan(links, notes);
    }

    LinkResult UpdateLinks(IReadOnlyList<VaultMove> done, IReadOnlyList<string> filesBefore, IReadOnlySet<string> skipFull)
    {
        var moves = Expand(done.Select(m => (Rel(m.OldFull) ?? "", Rel(m.NewFull) ?? "")), filesBefore);
        if (moves.Count == 0) return LinkResult.None;
        int links = 0, notes = 0;
        var skipped = new List<string>();
        var updated = new List<string>();
        foreach (var (note, text, doc) in Candidates(moves, filesBefore, fromNewPlace: true))
        {
            var r = VaultLinkRewriter.Rewrite(text, note, moves, filesBefore);
            if (r.Changed == 0) continue;
            var now = moves.TryGetValue(note, out var to) ? to : note;
            if (skipFull.Contains(doc.Path)) { skipped.Add(now); continue; }
            try { DocumentFile.Save(doc.Path, r.Text, doc.Format, null); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { skipped.Add(now); continue; }
            links += r.Changed; notes++; updated.Add(doc.Path);
        }
        return new LinkResult(links, notes, skipped) { Updated = updated };
    }

    /// <summary>Renames a note or folder; with <paramref name="updateLinks"/>, links to it are rewritten (except in
    /// <paramref name="skip"/>: files open with unsaved changes).</summary>
    public (IReadOnlyList<VaultMove> Moves, LinkResult Links) Rename(string rel, string newName, bool updateLinks, IReadOnlySet<string>? skip = null)
    {
        if (VaultPaths.IsNote(rel) && !Directory.Exists(Full(rel) ?? "") && !VaultPaths.IsNote(newName) && !System.IO.Path.HasExtension(newName)) newName += System.IO.Path.GetExtension(rel);
        var before = FilesNow();
        var move = Ops.Rename(rel, newName);
        var links = updateLinks ? UpdateLinks([move], before, skip ?? new HashSet<string>()) : LinkResult.None;
        ScheduleRescan(0);
        return ([move], links);
    }

    public (IReadOnlyList<VaultMove> Moves, LinkResult Links) Move(IReadOnlyList<string> rels, string folderRel, bool updateLinks, IReadOnlySet<string>? skip = null)
    {
        var before = FilesNow();
        var moves = Ops.Move(rels, folderRel);
        var links = updateLinks ? UpdateLinks(moves, before, skip ?? new HashSet<string>()) : LinkResult.None;
        ScheduleRescan(0);
        return (moves, links);
    }

    /// <summary>Moves notes and folders to the Recycle Bin (Windows; elsewhere they're deleted). Returns how many.</summary>
    public int Delete(IEnumerable<string> rels)
    {
        var fulls = rels.Select(Full).Where(f => f != null && f != Root && (File.Exists(f) || Directory.Exists(f))).Cast<string>().Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        fulls = fulls.Where(f => !fulls.Any(o => f.StartsWith(o + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))).ToList();
        foreach (var f in fulls)
        {
            var folder = Directory.Exists(f);
            if (OperatingSystem.IsWindows())
            {
                if (folder) Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(f, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                else Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(f, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
            }
            else if (folder) Directory.Delete(f, recursive: true);
            else File.Delete(f);
        }
        ScheduleRescan(0);
        return fulls.Count;
    }

    public void Dispose()
    {
        _cts.Cancel();
        _watcher?.Dispose();
        _rescanTimer.Dispose();
    }
}
