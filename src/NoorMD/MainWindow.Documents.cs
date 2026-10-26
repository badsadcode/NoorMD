using System.IO;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Documents;
using NoorMD.Core.Export;
using NoorMD.Core.Snapshots;
using NoorMD.Host;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>Opening, saving, exporting and the unsaved-changes rules. No path ever comes from the page
/// without validation: files are chosen in native dialogs, from the recent list, or by drag and drop.
/// Every operation works on one named tab; the text it writes is read from that tab's own editor.</summary>
public partial class MainWindow
{
    private const string MarkdownFilter = "Markdown (*.md;*.markdown)|*.md;*.markdown;*.mdown;*.mkd|Text files (*.txt)|*.txt|All files (*.*)|*.*";

    // ------------------------------------------------------------------ unsaved changes

    /// <summary>Returns true when it is OK to replace or close the tab's document (Save / Don't save / Cancel).</summary>
    private async Task<bool> ConfirmDiscardAsync(DocumentSession s, string reason)
    {
        var st = await GetEditorStateAsync(s.TabId);
        if (st == null)
        {
            // The editor is not reachable (crashed renderer). The last autosave is in the recovery draft.
            if (!s.Dirty) return true;
            return ThemedDialog.Confirm(this, "The editor is not responding",
                "NoorMD could not read the latest text from the editor. Everything up to the last autosave is kept in a recovery draft and will be offered next time.",
                reason == "closing" ? "Close anyway" : "Continue anyway");
        }
        if (!st.Dirty) return true;

        SelectTab(s);
        var choice = ThemedDialog.Show(this, $"Save changes to “{s.FileName}”?",
            "Your changes will be lost if you don't save them.",
            [new DialogButton("Cancel", "cancel", Cancel: true), new DialogButton("Don't save", "discard"), new DialogButton("Save", "save", Primary: true)],
            s.Path);
        switch (choice)
        {
            case "save":
                return await SaveCoreAsync(s, saveAs: false, st);
            case "discard":
                MarkDiscarded(s);
                return true;
            default:
                return false;
        }
    }

    private void MarkDiscarded(DocumentSession s)
    {
        s.Dirty = false;
        s.LastMarkdown = null;
        if (s.Path == null) s.Discarded = true;
        _recovery.DeleteOwn(s.TabId);
    }

    // ------------------------------------------------------------------ new / open

    private async Task<object?> NewDocumentAsync(string markdown, string? title, bool reuseBlank)
    {
        var s = (reuseBlank ? await ReusableBlankTabAsync() : null) ?? AddTab();
        s.ResetUntitled(title ?? "Untitled document");
        _recovery.DeleteOwn(s.TabId);
        PushEvent("doc.load", DocumentPayload(s, markdown, dirty: false));
        PersistSession();
        return new { opened = true, tabId = s.TabId };
    }

    private async Task<object?> OpenWithDialogAsync()
    {
        var dlg = new OpenFileDialog
        {
            Title = "Open Markdown files",
            Filter = MarkdownFilter,
            CheckFileExists = true,
            Multiselect = true,
            InitialDirectory = ActiveSession?.Folder ?? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        };
        if (dlg.ShowDialog(this) != true) return new { cancelled = true };
        object? last = null;
        foreach (var file in dlg.FileNames) last = await OpenPathAsync(file);
        return last;
    }

    private async Task<object?> OpenRecentAsync(string? path)
    {
        if (path == null || !_settings.IsRecent(path)) throw new BridgeError("That file is not in the recent list.");
        if (!File.Exists(path))
        {
            if (ThemedDialog.Confirm(this, "File not found", $"“{Path.GetFileName(path)}” was moved or deleted. Remove it from the recent list?", "Remove", path))
            {
                _settings.RemoveRecent(path);
                ScheduleSettingsSave();
                PushRecent();
            }
            return new { cancelled = true };
        }
        return await OpenPathAsync(path);
    }

    /// <summary>Opens a file in a new tab, or selects the tab that already has it open.</summary>
    internal async Task<object?> OpenPathAsync(string path)
    {
        var existing = FindTabByPath(path);
        if (existing != null)
        {
            SelectTab(existing);
            return new { opened = true, existing = true, tabId = existing.TabId };
        }
        LoadedDocument loaded;
        try { loaded = DocumentFile.Load(path); }
        catch (Exception ex)
        {
            ThemedDialog.ShowError(this, "Could not open the file", FriendlyError(ex), path);
            return new { cancelled = true };
        }
        var s = await ReusableBlankTabAsync() ?? AddTab();
        _recovery.DeleteOwn(s.TabId);
        PushEvent("doc.load", ApplyLoaded(s, loaded));
        return new { opened = true, tabId = s.TabId };
    }

    private object ApplyLoaded(DocumentSession s, LoadedDocument loaded)
    {
        s.SetFile(loaded.Path, loaded.Format, loaded.Stamp);
        s.Dirty = false;
        s.LastMarkdown = null;
        s.Discarded = false;
        _settings.AddRecent(loaded.Path);
        _settings.LastDocumentPath = loaded.Path;
        PersistSession();
        PushRecent();
        UpdateWindowTitle();
        return DocumentPayload(s, loaded.Markdown, dirty: false, warning: loaded.Warning);
    }

    /// <summary>The doc.load payload for a tab. The page creates the tab if it doesn't have it yet.</summary>
    private object DocumentPayload(DocumentSession s, string markdown, bool dirty, string? notice = null, string? warning = null, bool background = false) => new
    {
        tabId = s.TabId,
        markdown,
        path = s.Path,
        fileName = s.Path == null ? null : Path.GetFileName(s.Path),
        title = s.Title,
        dirty,
        encoding = s.Format.EncodingName + (s.Format.Bom ? " BOM" : ""),
        eol = s.Format.Eol.ToString(),
        pinned = s.Pinned,
        mode = s.Mode,
        notice,
        warning,
        background,
    };

    private async Task<object?> ReloadFromDiskAsync(DocumentSession s)
    {
        if (s.Path == null) throw new BridgeError("This document has not been saved yet.");
        var st = await GetEditorStateAsync(s.TabId);
        if (st is { Dirty: true } && !ThemedDialog.Confirm(this, "Reload from disk?", $"Your unsaved changes to “{s.FileName}” will be replaced by the version on disk.", "Discard and reload"))
            return new { cancelled = true };
        try
        {
            var payload = ApplyLoaded(s, DocumentFile.Load(s.Path));
            _recovery.DeleteOwn(s.TabId);
            PushEvent("doc.load", payload);
            return new { opened = true };
        }
        catch (Exception ex) { throw new BridgeError(FriendlyError(ex)); }
    }

    private async Task<object?> RestoreRecoveryAsync(string? id)
    {
        var draft = id == null ? null : _recovery.LoadOrphan(id);
        if (draft == null) throw new BridgeError("That draft is no longer available.");

        // A draft of a file that is already open replaces that tab's text (after asking, if it has edits of its own).
        var target = draft.Path != null ? FindTabByPath(draft.Path) : null;
        if (target != null && !await ConfirmDiscardAsync(target, "recover")) return new { restored = false };
        target ??= await ReusableBlankTabAsync() ?? AddTab();
        AdoptDraft(target, draft);
        PushEvent("doc.load", DocumentPayload(target, draft.Markdown, dirty: true, notice: $"Recovered unsaved work from {draft.SavedUtc.ToLocalTime():g}. Save to keep it."));
        UpdateWindowTitle();
        return new { restored = true, tabId = target.TabId };
    }

    /// <summary>Makes an orphaned draft this tab's document. Our own draft is written before the orphan is deleted,
    /// so the text exists on disk at every moment.</summary>
    private void AdoptDraft(DocumentSession s, Core.Recovery.RecoveryDraft draft)
    {
        if (draft.Path != null && File.Exists(draft.Path))
            s.SetFile(draft.Path, draft.ToFormat(), FileStamp.Read(draft.Path));
        else
        {
            s.ResetUntitled(draft.Title ?? "Recovered document");
            if (draft.Path != null) PushNotice($"The original file “{Path.GetFileName(draft.Path)}” no longer exists. Use Save As to keep this text.");
        }
        s.Dirty = true;
        s.Discarded = false;
        s.LastMarkdown = draft.Markdown;
        _recovery.SaveOwn(s.TabId, draft.Markdown, s.Title, s.Path, s.Format);
        _recovery.DiscardOrphan(draft.Id);
        PersistSession();
    }

    // ------------------------------------------------------------------ save

    private async Task<object?> SaveAsync(DocumentSession s, bool saveAs)
    {
        var st = await GetEditorStateAsync(s.TabId) ?? throw new BridgeError("The editor is not responding, so nothing was saved. Your text is kept in the recovery draft.");
        var saved = await SaveCoreAsync(s, saveAs, st);
        return saved ? new { saved = true, fileName = s.FileName } : new { saved = false };
    }

    /// <summary>Saves every tab with unsaved changes, in tab order. Stops at the first one the user cancels.</summary>
    private async Task<object?> SaveAllAsync()
    {
        int saved = 0;
        foreach (var s in OrderedTabs())
        {
            var st = await GetEditorStateAsync(s.TabId);
            if (st is not { Dirty: true }) continue;
            if (s.Path == null) SelectTab(s); // Save As dialog: show which document it is for
            if (!await SaveCoreAsync(s, saveAs: false, st)) return new { saved, cancelled = true };
            saved++;
        }
        return new { saved };
    }

    private async Task<bool> SaveCoreAsync(DocumentSession s, bool saveAs, EditorState st)
    {
        var path = s.Path;
        if (!saveAs && path != null && !st.Dirty && s.Stamp != null && FileStamp.Read(path) == s.Stamp)
        {
            // Nothing was edited and the file is unchanged on disk: don't rewrite it. (Visual mode would
            // otherwise re-serialize the Markdown and change formatting in a file the user never touched.)
            PushEvent("doc.saved", new { tabId = s.TabId, gen = st.Gen, path, fileName = Path.GetFileName(path), title = s.Title });
            return true;
        }
        if (saveAs || path == null)
        {
            path = AskSavePath("Save Markdown file", path ?? DocumentFile.SafeFileName(st.Title), MarkdownFilter, ".md", s);
            if (path == null) return false;
        }
        else
        {
            var onDisk = FileStamp.Read(path);
            if (s.Stamp != null && onDisk != null && onDisk != s.Stamp)
            {
                var choice = ThemedDialog.Show(this, "The file changed on disk",
                    $"“{Path.GetFileName(path)}” was modified by another program after you opened it. Overwrite it with your version?",
                    [new DialogButton("Cancel", "cancel", Cancel: true), new DialogButton("Save as…", "saveAs"), new DialogButton("Overwrite", "overwrite", Primary: true)]);
                if (choice == "cancel") return false;
                if (choice == "saveAs")
                {
                    path = AskSavePath("Save Markdown file", path, MarkdownFilter, ".md", s);
                    if (path == null) return false;
                }
            }
        }

        // Saving under the name of a file another tab has open would leave two tabs editing one file.
        var other = FindTabByPath(path);
        if (other != null && other != s)
        {
            ThemedDialog.ShowError(this, "That file is open in another tab", $"“{Path.GetFileName(path)}” is already open. Close that tab first, or choose a different name.", path);
            return false;
        }

        FileStamp stamp;
        try
        {
            var target = path;
            var format = s.Format;
            stamp = await Task.Run(() => DocumentFile.Save(target, st.Markdown, format, App.Paths.BackupFor(target)));
        }
        catch (Exception ex)
        {
            Log.Error("Save failed", ex);
            ThemedDialog.ShowError(this, "Could not save", FriendlyError(ex) + "\n\nYour text is still in the editor and in the recovery draft. Try Save As to choose another location.", path);
            return false;
        }

        var oldKey = s.SnapshotKey;
        s.SetFile(path, s.Format, stamp);
        if (oldKey != s.SnapshotKey) _snapshots.Merge(oldKey, s.SnapshotKey, s.Path);
        s.Dirty = false;
        s.Discarded = false;
        s.LastMarkdown = null;
        _recovery.DeleteOwn(s.TabId);
        _settings.AddRecent(path);
        _settings.LastDocumentPath = path;
        PersistSession();
        PushRecent();
        PushEvent("doc.saved", new
        {
            tabId = s.TabId, gen = st.Gen, path, fileName = Path.GetFileName(path), title = s.Title,
            encoding = s.Format.EncodingName + (s.Format.Bom ? " BOM" : ""), eol = s.Format.Eol.ToString(),
        });
        UpdateWindowTitle();
        return true;
    }

    private string? AskSavePath(string title, string suggested, string filter, string defaultExt, DocumentSession? s = null)
    {
        var dlg = new SaveFileDialog
        {
            Title = title,
            Filter = filter,
            DefaultExt = defaultExt,
            AddExtension = true,
            OverwritePrompt = true,
            FileName = Path.GetFileName(suggested),
            InitialDirectory = Path.GetDirectoryName(suggested) is { Length: > 0 } dir && Directory.Exists(dir)
                ? dir : (s ?? ActiveSession)?.Folder ?? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        };
        return dlg.ShowDialog(this) == true ? dlg.FileName : null;
    }

    // ------------------------------------------------------------------ export

    private async Task<object?> ExportMarkdownCopyAsync(DocumentSession s)
    {
        var st = await GetEditorStateAsync(s.TabId) ?? throw new BridgeError("The editor is not responding.");
        var suggested = DocumentFile.SafeFileName(st.Title + " (copy)");
        var path = AskSavePath("Export a copy as Markdown", s.Folder != null ? Path.Combine(s.Folder, suggested) : suggested, MarkdownFilter, ".md", s);
        if (path == null) return null;
        if (FindTabByPath(path) != null)
            throw new BridgeError("That file is open in NoorMD — choose a different file. Use Save (Ctrl+S) to update an open document.");
        var format = s.Format;
        await Task.Run(() => DocumentFile.Save(path, st.Markdown, format, null));
        PushNotice("Markdown copy saved to " + path);
        return new { path };
    }

    private async Task<object?> ExportHtmlAsync(DocumentSession s, string title, string bodyHtml)
    {
        var suggested = DocumentFile.SafeFileName(title, ".html");
        var path = AskSavePath("Export HTML", s.Folder != null ? Path.Combine(s.Folder, suggested) : suggested, "HTML document (*.html)|*.html", ".html", s);
        if (path == null) return null;
        var html = HtmlExport.Build(title, bodyHtml);
        await Task.Run(() => AtomicFile.WriteAllText(path, html));
        return new { path };
    }

    private async Task<object?> ExportPdfAsync(DocumentSession s, string title)
    {
        var suggested = DocumentFile.SafeFileName(title, ".pdf");
        var path = AskSavePath("Export PDF", s.Folder != null ? Path.Combine(s.Folder, suggested) : suggested, "PDF document (*.pdf)|*.pdf", ".pdf", s);
        if (path == null) return null;
        var settings = Core.Environment.CreatePrintSettings();
        settings.ShouldPrintHeaderAndFooter = false;
        settings.ShouldPrintBackgrounds = true;
        var tmp = Path.Combine(Path.GetDirectoryName(path)!, $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.noormd-tmp");
        try
        {
            if (!await Core.PrintToPdfAsync(tmp, settings)) throw new BridgeError("WebView2 could not create the PDF.");
            File.Move(tmp, path, overwrite: true);
        }
        finally { try { if (File.Exists(tmp)) File.Delete(tmp); } catch { } }
        return new { path };
    }

    // ------------------------------------------------------------------ external changes

    /// <summary>Checks every open file (not just the visible one) when the window regains focus.</summary>
    private async Task CheckExternalChangesAsync()
    {
        if (!_webReady || _docGate.CurrentCount == 0) return;
        if (!await _docGate.WaitAsync(0)) return;
        try
        {
            foreach (var s in OrderedTabs())
            {
                if (s.Path == null || !_tabs.ContainsKey(s.TabId)) continue;
                var onDisk = FileStamp.Read(s.Path);
                if (onDisk == null)
                {
                    if (!s.DeletionNoticeShown && !File.Exists(s.Path))
                    {
                        s.DeletionNoticeShown = true;
                        PushNotice($"“{Path.GetFileName(s.Path)}” was moved or deleted outside NoorMD. Save to write it again.");
                    }
                    continue;
                }
                if (s.Stamp == null || onDisk == s.Stamp || onDisk == s.AcknowledgedExternalStamp) continue;

                s.AcknowledgedExternalStamp = onDisk;
                SelectTab(s);
                var st = await GetEditorStateAsync(s.TabId);
                var dirty = st?.Dirty ?? s.Dirty;
                var reload = ThemedDialog.Show(this, "File changed on disk",
                    dirty
                        ? $"“{Path.GetFileName(s.Path)}” was changed by another program. Reload it and lose your unsaved changes, or keep your version?"
                        : $"“{Path.GetFileName(s.Path)}” was changed by another program. Reload the new version?",
                    [new DialogButton("Keep my version", "keep", Cancel: true), new DialogButton("Reload", "reload", Primary: !dirty)], s.Path) == "reload";
                if (!reload) continue;
                try
                {
                    var payload = ApplyLoaded(s, DocumentFile.Load(s.Path));
                    _recovery.DeleteOwn(s.TabId);
                    PushEvent("doc.load", payload);
                }
                catch (Exception ex) { ThemedDialog.ShowError(this, "Could not reload", FriendlyError(ex)); }
            }
        }
        finally { _docGate.Release(); }
    }
}
