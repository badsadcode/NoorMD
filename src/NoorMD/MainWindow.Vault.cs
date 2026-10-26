using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows.Threading;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Documents;
using NoorMD.Core.Security;
using NoorMD.Core.Settings;
using NoorMD.Core.Vaults;
using NoorMD.Host;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// Vaults: an ordinary folder opened as a workspace (explorer, search, backlinks, file operations). One Vault per
/// window; documents outside it work as before, and closing or switching a Vault never closes a tab. Nothing is
/// written into the Vault except the user's own notes and folders.
/// </summary>
public partial class MainWindow
{
    private sealed class VaultState(string root, VaultInfo info)
    {
        public string Root { get; } = root;
        public VaultInfo Info { get; } = info;
        public VaultIndex Index { get; } = new(root);
        public VaultFileOps Ops { get; } = new(root);
        public List<VaultEntry> Entries { get; set; } = [];
        public FileSystemWatcher? Watcher { get; set; }
        public CancellationTokenSource Cts { get; } = new();
        public Task Ready { get; set; } = Task.CompletedTask;
        public bool Indexed { get; set; }
    }

    private VaultState? _vault;
    private DispatcherTimer? _vaultRescanTimer;

    private async Task<object?> DispatchVaultAsync(BridgeRequest req)
    {
        switch (req.Type)
        {
            case "vault.open":
                {
                    var dlg = new OpenFolderDialog { Title = "Open a folder as a Vault", Multiselect = false };
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    return OpenVault(dlg.FolderName);
                }
            case "vault.openRecent":
                {
                    var path = req.GetString("path", 4096);
                    var known = _settings.Vaults.FirstOrDefault(v => string.Equals(v.Path, path, StringComparison.OrdinalIgnoreCase)) ?? throw new BridgeError("That Vault is not in the recent list.");
                    if (!Directory.Exists(known.Path))
                    {
                        if (ThemedDialog.Confirm(this, "Vault not found", $"“{known.Name}” was moved or deleted. Remove it from the list?", "Remove", known.Path))
                        {
                            _settings.Vaults.Remove(known);
                            ScheduleSettingsSave();
                            PushVaultChanged();
                        }
                        return new { cancelled = true };
                    }
                    return OpenVault(known.Path);
                }
            case "vault.create": return CreateVault(req.GetString("name", 200));
            case "vault.close": CloseVault(remember: true); return null;
            case "vault.reveal": OpenFolder(V().Root); return null;
            case "vault.tree": return TreePayload();
            case "vault.refresh": ScheduleRescan(0); return null;
            case "vault.settings.get": return new { attachments = V().Info.Attachments, excluded = V().Info.Excluded };
            case "vault.settings.set":
                {
                    var v = V();
                    if (req.GetString("attachments", 300) is { } att) v.Info.Attachments = att;
                    if (req.Payload.TryGetProperty("excluded", out var ex) && ex.ValueKind == JsonValueKind.Array)
                        v.Info.Excluded = ex.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList();
                    v.Info.Normalize();
                    ScheduleSettingsSave();
                    ScheduleRescan(0);
                    PushVaultChanged();
                    return new { attachments = v.Info.Attachments, excluded = v.Info.Excluded };
                }
            case "vault.openFile":
                {
                    var full = VaultFull(req.GetString("path", 1000));
                    if (!File.Exists(full)) throw new BridgeError("That file no longer exists.");
                    if (full.EndsWith(".noorsketch", StringComparison.OrdinalIgnoreCase)) { OpenSketch(full); return new { sketch = true }; }
                    if (!DocumentFile.IsOpenable(full)) { OpenExternal(full); return new { external = true }; }
                    return await WithDocGate(() => OpenPathAsync(full));
                }
            case "vault.search":
                {
                    var v = V();
                    var query = req.GetString("query", 200) ?? "";
                    await v.Ready;
                    var hits = await Task.Run(() => v.Index.Search(query, 300, v.Cts.Token));
                    return new { hits, indexed = v.Index.Count };
                }
            case "vault.backlinks":
                {
                    if (_vault is not { } v || TryTabFrom(req) is not { Path: { } path } || VaultPaths.ToRelative(v.Root, path) is not { } rel) return new { refs = Array.Empty<object>(), inVault = false };
                    await v.Ready;
                    return new { refs = await Task.Run(() => v.Index.Backlinks(rel)), inVault = true, path = rel };
                }
            case "vault.openWiki": return await OpenWikiAsync(req.GetString("target", 500) ?? "", TryTabFrom(req));
            case "vault.linkTo":
                {
                    var s = TabFrom(req);
                    var full = VaultFull(req.GetString("path", 1000));
                    if (s.Folder == null) throw new BridgeError("Save this document first, so the link can be relative to it.");
                    if (!LinkPaths.TryRelative(s.Folder, full, V().Root, out var link)) throw new BridgeError("This document is not inside the Vault.");
                    return new { link, title = Path.GetFileNameWithoutExtension(full) };
                }
            case "vault.newNote":
                {
                    var v = V();
                    var rel = VaultOp(() => v.Ops.CreateNote(req.GetString("folder", 1000) ?? "", req.GetString("name", 200)));
                    ScheduleRescan(0);
                    await WithDocGate(() => OpenPathAsync(VaultFull(rel)));
                    return new { path = rel };
                }
            case "vault.newFolder":
                {
                    var v = V();
                    var rel = VaultOp(() => v.Ops.CreateFolder(req.GetString("parent", 1000) ?? "", req.GetString("name", 200) ?? ""));
                    ScheduleRescan(0);
                    return new { path = rel };
                }
            case "vault.rename":
                {
                    var v = V();
                    var rel = req.GetString("path", 1000) ?? "";
                    var name = req.GetString("name", 200) ?? "";
                    if (VaultPaths.IsNote(rel) && !VaultPaths.IsNote(name) && !name.Contains('.')) name += Path.GetExtension(rel);
                    if (!ConfirmInboundLinks(v, [rel], "Rename")) return new { cancelled = true };
                    var move = VaultOp(() => v.Ops.Rename(rel, name));
                    FollowMoves([move]);
                    ScheduleRescan(0);
                    return new { path = v.Ops.Rel(move.NewFull) };
                }
            case "vault.move":
                {
                    var v = V();
                    var paths = StringList(req, "paths");
                    if (!ConfirmInboundLinks(v, paths, "Move")) return new { cancelled = true };
                    var moves = VaultOp(() => v.Ops.Move(paths, req.GetString("folder", 1000) ?? ""));
                    FollowMoves(moves);
                    ScheduleRescan(0);
                    return new { moved = moves.Count };
                }
            case "vault.duplicate":
                {
                    var v = V();
                    var rel = VaultOp(() => v.Ops.Duplicate(req.GetString("path", 1000) ?? ""));
                    ScheduleRescan(0);
                    return new { path = rel };
                }
            case "vault.delete": return await DeleteVaultItemsAsync(StringList(req, "paths"));
            case "vault.revealItem":
                {
                    var full = VaultFull(req.GetString("path", 1000));
                    Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{full}\"") { UseShellExecute = false });
                    return null;
                }
            case "vault.copyPath": CopyToClipboard(VaultFull(req.GetString("path", 1000))); return null;
            default: throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }

    private VaultState V() => _vault ?? throw new BridgeError("No Vault is open. Use Workspace → Open Folder as Vault.");

    private string VaultFull(string? rel) =>
        VaultPaths.Resolve(V().Root, rel) ?? throw new BridgeError("That path is not inside the Vault.");

    private static T VaultOp<T>(Func<T> op)
    {
        try { return op(); }
        catch (VaultOperationException ex) { throw new BridgeError(ex.Message); }
        catch (UnauthorizedAccessException ex) { throw new BridgeError("Windows denied access. " + ex.Message); }
        catch (IOException ex) { throw new BridgeError(ex.Message); }
    }

    private static List<string> StringList(BridgeRequest req, string name) =>
        req.Payload.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).Take(10_000).ToList()
            : [];

    // ------------------------------------------------------------------ open / create / close

    private object OpenVault(string path)
    {
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
        if (!Directory.Exists(root)) throw new BridgeError("That folder no longer exists.");
        if (Path.GetPathRoot(root) == root + Path.DirectorySeparatorChar || root == Path.GetPathRoot(root))
            throw new BridgeError("A whole drive can't be a Vault. Choose a folder.");
        if (_vault != null && string.Equals(_vault.Root, root, StringComparison.OrdinalIgnoreCase)) return new { opened = true, existing = true };
        CloseVault(remember: false);
        var info = _settings.TouchVault(root);
        _settings.LastVault = _persistSession ? root : _settings.LastVault;
        ScheduleSettingsSave();
        var v = new VaultState(root, info);
        _vault = v;
        v.Ready = RescanAsync(v);
        StartWatcher(v);
        PushVaultChanged();
        return new { opened = true };
    }

    private object CreateVault(string? name)
    {
        if (VaultPaths.NameProblem(name) is { } problem) throw new BridgeError(problem);
        var dlg = new OpenFolderDialog { Title = $"Where should the Vault “{name}” be created?", Multiselect = false };
        if (dlg.ShowDialog(this) != true) return new { cancelled = true };
        var root = Path.Combine(dlg.FolderName, name!.Trim());
        if (File.Exists(root) || (Directory.Exists(root) && Directory.EnumerateFileSystemEntries(root).Any()))
            throw new BridgeError($"“{name}” already exists in that folder. Choose another name, or open it with Open Folder as Vault.");
        Directory.CreateDirectory(root);
        var welcome = Path.Combine(root, "Welcome.md");
        File.WriteAllText(welcome, $"# {name}\n\nThis Vault is an ordinary folder. Every note is a plain Markdown file you can open in any editor.\n\n- Create notes and folders from the explorer on the left (right-click for more).\n- Search every note with Ctrl+Shift+F, jump to one with Ctrl+E.\n- Link notes with relative links like [this one](Welcome.md) or with [[Welcome]].\n", new System.Text.UTF8Encoding(false));
        var result = OpenVault(root);
        _ = Dispatcher.BeginInvoke(async () => await WithDocGate(() => OpenPathAsync(welcome)));
        return result;
    }

    private void CloseVault(bool remember)
    {
        if (_vault is not { } v) return;
        _vault = null;
        v.Cts.Cancel();
        v.Watcher?.Dispose();
        if (remember && _persistSession)
        {
            _settings.LastVault = null;
            ScheduleSettingsSave();
        }
        PushVaultChanged();
    }

    private object VaultPayload() => new
    {
        vault = _vault == null ? null : new { root = _vault.Root, name = _vault.Info.Name, attachments = _vault.Info.Attachments, excluded = _vault.Info.Excluded },
        recent = _settings.Vaults.Select(x => new { path = x.Path, name = x.Name }).ToList(),
    };

    private void PushVaultChanged() => PushEvent("vault.changed", VaultPayload());

    private object TreePayload()
    {
        var v = V();
        return new { root = v.Root, indexed = v.Indexed, entries = v.Entries.Select(e => new { p = e.Path, d = e.IsFolder, s = e.Size, m = e.ModifiedUtc }) };
    }

    // ------------------------------------------------------------------ scanning, watching

    /// <summary>Scans and indexes on a background thread; the editor and music never wait for it.</summary>
    private async Task RescanAsync(VaultState v)
    {
        try
        {
            var entries = await Task.Run(() => VaultScanner.Scan(v.Root, v.Info.Excluded, v.Cts.Token));
            if (_vault != v) return;
            v.Entries = entries;
            PushEvent("vault.tree", TreePayload());
            await Task.Run(() => v.Index.Update(entries, v.Cts.Token));
            if (_vault != v) return;
            v.Indexed = true;
            PushEvent("vault.indexed", new { notes = v.Index.Count });
            if (IsActive) await CheckExternalChangesAsync();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Log.Error("Vault scan failed", ex); }
    }

    private void StartWatcher(VaultState v)
    {
        try
        {
            var w = new FileSystemWatcher(v.Root) { IncludeSubdirectories = true, InternalBufferSize = 64 * 1024, NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size };
            FileSystemEventHandler changed = (_, e) => { if (!IgnoredChange(e.FullPath, v)) Dispatcher.BeginInvoke(() => ScheduleRescan(700)); };
            w.Created += changed; w.Deleted += changed; w.Changed += changed;
            w.Renamed += (_, e) => Dispatcher.BeginInvoke(() => ScheduleRescan(700));
            w.Error += (_, _) => Dispatcher.BeginInvoke(() => ScheduleRescan(700));
            w.EnableRaisingEvents = true;
            v.Watcher = w;
        }
        catch (Exception ex) { Log.Error("Watching the Vault failed; use Refresh", ex); }
    }

    private static bool IgnoredChange(string full, VaultState v)
    {
        var rel = VaultPaths.ToRelative(v.Root, full);
        return rel == null || rel.Split('/').Any(seg => VaultPaths.IsExcluded(seg, v.Info.Excluded)) || full.EndsWith(".noormd-tmp", StringComparison.OrdinalIgnoreCase);
    }

    private void ScheduleRescan(int ms)
    {
        if (_vault is not { } v) return;
        _vaultRescanTimer ??= new DispatcherTimer();
        _vaultRescanTimer.Stop();
        _vaultRescanTimer.Interval = TimeSpan.FromMilliseconds(Math.Max(1, ms));
        _vaultRescanTimer.Tick -= OnRescanTick;
        _vaultRescanTimer.Tick += OnRescanTick;
        _vaultRescanTimer.Start();
    }

    private void OnRescanTick(object? sender, EventArgs e)
    {
        _vaultRescanTimer?.Stop();
        if (_vault is { } v) v.Ready = RescanAsync(v);
    }

    // ------------------------------------------------------------------ operations that affect open documents

    /// <summary>Open tabs follow their files when a file or folder is renamed or moved inside NoorMD.</summary>
    private void FollowMoves(IEnumerable<VaultMove> moves)
    {
        foreach (var m in moves)
        {
            foreach (var s in OrderedTabs())
            {
                if (s.Path == null) continue;
                string? newPath = null;
                if (!m.IsFolder && string.Equals(s.Path, m.OldFull, StringComparison.OrdinalIgnoreCase)) newPath = m.NewFull;
                else if (m.IsFolder && s.Path.StartsWith(m.OldFull + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) newPath = m.NewFull + s.Path[m.OldFull.Length..];
                if (newPath == null) continue;
                var oldKey = s.SnapshotKey;
                s.SetFile(newPath, s.Format, FileStamp.Read(newPath) ?? s.Stamp);
                if (oldKey != s.SnapshotKey) _snapshots.Merge(oldKey, s.SnapshotKey, s.Path);
                _settings.AddRecent(newPath);
                PushEvent("doc.renamed", new { tabId = s.TabId, path = s.Path, fileName = Path.GetFileName(s.Path), title = s.Title });
            }
        }
        PersistSession();
        PushRecent();
        UpdateWindowTitle();
    }

    /// <summary>Links are not rewritten automatically (yet): say how many notes point at what is about to move.</summary>
    private bool ConfirmInboundLinks(VaultState v, IReadOnlyList<string> rels, string verb)
    {
        if (!v.Indexed) return true;
        var notes = v.Index.NotePaths();
        var targets = notes.Where(n => rels.Any(r => string.Equals(n, r, StringComparison.OrdinalIgnoreCase) || n.StartsWith(r + "/", StringComparison.OrdinalIgnoreCase))).ToList();
        if (targets.Count == 0 || targets.Count > 200) return true;
        var sources = targets.SelectMany(t => v.Index.Backlinks(t)).Select(r => r.Source).Where(src => !targets.Contains(src, StringComparer.OrdinalIgnoreCase)).Distinct().ToList();
        if (sources.Count == 0) return true;
        return ThemedDialog.Confirm(this, $"{verb} and break links?",
            $"{sources.Count} other note{(sources.Count == 1 ? "" : "s")} link{(sources.Count == 1 ? "s" : "")} here: {string.Join(", ", sources.Take(5))}{(sources.Count > 5 ? "…" : "")}.\n\nNoorMD does not rewrite links automatically yet, so those links will stop working until you update them.",
            verb + " anyway");
    }

    private async Task<object?> DeleteVaultItemsAsync(List<string> rels)
    {
        var v = V();
        var fulls = rels.Select(r => VaultPaths.Resolve(v.Root, r)).Where(f => f != null && f != v.Root && (File.Exists(f) || Directory.Exists(f))).Cast<string>().Distinct().ToList();
        if (fulls.Count == 0) return new { deleted = 0 };
        var label = fulls.Count == 1 ? $"“{Path.GetFileName(fulls[0])}”" : $"{fulls.Count} items";
        if (!ThemedDialog.Confirm(this, $"Delete {label}?", "It will be moved to the Windows Recycle Bin, where you can restore it.", "Move to Recycle Bin", fulls.Count == 1 ? fulls[0] : null)) return new { cancelled = true };

        // Open documents among them: unchanged ones are closed, ones with unsaved edits stay open (Save writes them again).
        var affected = OrderedTabs().Where(s => s.Path != null && fulls.Any(f => string.Equals(s.Path, f, StringComparison.OrdinalIgnoreCase) || s.Path.StartsWith(f + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))).ToList();
        try { await Task.Run(() => RecycleBin.Send(fulls)); }
        catch (Exception ex) { throw new BridgeError(FriendlyError(ex)); }
        int kept = 0;
        foreach (var s in affected)
        {
            var st = await GetEditorStateAsync(s.TabId);
            if (st?.Dirty ?? s.Dirty) { kept++; s.DeletionNoticeShown = true; continue; }
            RemoveTab(s);
            PushEvent("tab.closed", new { tabId = s.TabId });
        }
        if (_tabs.Count == 0)
        {
            var blank = AddTab();
            _activeTabId = blank.TabId;
            PushEvent("doc.load", DocumentPayload(blank, "", dirty: false));
        }
        if (kept > 0) PushNotice($"{kept} open document{(kept == 1 ? " has" : "s have")} unsaved changes and stay{(kept == 1 ? "s" : "")} open. Save to write {(kept == 1 ? "it" : "them")} again.");
        PersistSession();
        UpdateWindowTitle();
        ScheduleRescan(0);
        return new { deleted = fulls.Count };
    }

    private async Task<object?> OpenWikiAsync(string target, DocumentSession? from)
    {
        var v = V();
        await v.Ready;
        var fromRel = from?.Path != null ? VaultPaths.ToRelative(v.Root, from.Path) ?? "" : "";
        var rel = VaultLinks.Resolve(fromRel, new VaultLink(target, true), v.Index.NotePaths());
        if (rel != null) return await WithDocGate(() => OpenPathAsync(VaultFull(rel)));
        var name = target.Replace('\\', '/').Split('/').Last().Trim();
        if (VaultPaths.NameProblem(name) != null) throw new BridgeError($"“{target}” is not a valid note name.");
        if (!ThemedDialog.Confirm(this, "Create the note?", $"No note called “{name}” exists in this Vault yet. Create it next to the current note?", "Create note")) return new { cancelled = true };
        var folder = fromRel.Contains('/') ? fromRel[..fromRel.LastIndexOf('/')] : "";
        var created = VaultOp(() => v.Ops.CreateNote(folder, name, $"# {name}\n\n"));
        ScheduleRescan(0);
        return await WithDocGate(() => OpenPathAsync(VaultFull(created)));
    }

    /// <summary>The Vault a file belongs to (the open one), if any.</summary>
    private string? VaultRootFor(string? path) =>
        _vault is { } v && path != null && VaultPaths.ToRelative(v.Root, path) is { Length: > 0 } ? v.Root : null;
}
