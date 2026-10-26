using System.IO;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Documents;
using NoorMD.Core.Export;
using NoorMD.Core.Recovery;
using NoorMD.Core.Snapshots;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>Opening, saving, exporting and the unsaved-changes rules. No path ever comes from the page
/// without validation: files are chosen in native dialogs, from the recent list, or by drag and drop.</summary>
public partial class MainWindow
{
    private const string MarkdownFilter = "Markdown (*.md;*.markdown)|*.md;*.markdown;*.mdown;*.mkd|Text files (*.txt)|*.txt|All files (*.*)|*.*";

    // ------------------------------------------------------------------ unsaved changes

    /// <summary>Returns true when it is OK to replace or close the current document.</summary>
    private async Task<bool> ConfirmDiscardAsync(string reason)
    {
        var st = await GetEditorStateAsync();
        if (st == null)
        {
            // The editor is not reachable (crashed renderer). The last autosave is in the recovery draft.
            if (!_session.Dirty) return true;
            return ThemedDialog.Confirm(this, "The editor is not responding",
                "NoorMD could not read the latest text from the editor. Everything up to the last autosave is kept in a recovery draft and will be offered next time.",
                reason == "closing" ? "Close anyway" : "Continue anyway");
        }
        if (!st.Dirty) return true;

        var name = _session.Path != null ? Path.GetFileName(_session.Path) : st.Title;
        var choice = ThemedDialog.Show(this, $"Save changes to “{name}”?",
            "Your changes will be lost if you don't save them.",
            [new DialogButton("Cancel", "cancel", Cancel: true), new DialogButton("Don't save", "discard"), new DialogButton("Save", "save", Primary: true)]);
        switch (choice)
        {
            case "save":
                return await SaveCoreAsync(saveAs: false, st);
            case "discard":
                _session.Dirty = false;
                _session.LastMarkdown = null;
                _recovery.DeleteOwn();
                return true;
            default:
                return false;
        }
    }

    // ------------------------------------------------------------------ new / open

    private async Task<object?> NewDocumentAsync(string markdown, string? title)
    {
        if (!await ConfirmDiscardAsync("new")) return new { cancelled = true };
        _session.ResetUntitled(title ?? "Untitled document");
        _recovery.DeleteOwn();
        _settings.LastDocumentPath = null;
        ScheduleSettingsSave();
        PushEvent("doc.load", DocumentPayload(markdown, dirty: false));
        UpdateWindowTitle();
        return new { opened = true };
    }

    private async Task<object?> OpenWithDialogAsync()
    {
        var dlg = new OpenFileDialog
        {
            Title = "Open Markdown file",
            Filter = MarkdownFilter,
            CheckFileExists = true,
            InitialDirectory = _session.Folder ?? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        };
        if (dlg.ShowDialog(this) != true) return new { cancelled = true };
        return await OpenPathAsync(dlg.FileName);
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

    internal async Task<object?> OpenPathAsync(string path)
    {
        if (_session.Path != null && string.Equals(Path.GetFullPath(path), _session.Path, StringComparison.OrdinalIgnoreCase) && !_session.Dirty)
        {
            PushNotice("That document is already open.");
            return new { opened = true };
        }
        LoadedDocument loaded;
        try { loaded = DocumentFile.Load(path); } // read first: a failed read must not cost the current document
        catch (Exception ex)
        {
            ThemedDialog.ShowError(this, "Could not open the file", FriendlyError(ex), path);
            return new { cancelled = true };
        }
        if (!await ConfirmDiscardAsync("open")) return new { cancelled = true };
        _recovery.DeleteOwn();
        PushEvent("doc.load", ApplyLoaded(loaded));
        return new { opened = true };
    }

    /// <summary>Reads a file and makes it the session's document; returns the doc.load payload.</summary>
    private object LoadFileIntoSession(string path, out LoadedDocument loaded)
    {
        loaded = DocumentFile.Load(path);
        return ApplyLoaded(loaded);
    }

    private object ApplyLoaded(LoadedDocument loaded)
    {
        _session.SetFile(loaded.Path, loaded.Format, loaded.Stamp);
        _session.Dirty = false;
        _session.LastMarkdown = null;
        _settings.AddRecent(loaded.Path);
        _settings.LastDocumentPath = loaded.Path;
        ScheduleSettingsSave();
        PushRecent();
        UpdateWindowTitle();
        return DocumentPayload(loaded.Markdown, dirty: false, warning: loaded.Warning);
    }

    private object DocumentPayload(string markdown, bool dirty, string? notice = null, string? warning = null) => new
    {
        markdown,
        path = _session.Path,
        fileName = _session.Path == null ? null : Path.GetFileName(_session.Path),
        title = _session.Title,
        dirty,
        encoding = _session.Format.EncodingName + (_session.Format.Bom ? " BOM" : ""),
        eol = _session.Format.Eol.ToString(),
        notice,
        warning,
    };

    private async Task<object?> ReloadFromDiskAsync()
    {
        if (_session.Path == null) throw new BridgeError("This document has not been saved yet.");
        var st = await GetEditorStateAsync();
        if (st is { Dirty: true } && !ThemedDialog.Confirm(this, "Reload from disk?", "Your unsaved changes in NoorMD will be replaced by the version on disk.", "Discard and reload"))
            return new { cancelled = true };
        try
        {
            var payload = LoadFileIntoSession(_session.Path, out _);
            _recovery.DeleteOwn();
            PushEvent("doc.load", payload);
            return new { opened = true };
        }
        catch (Exception ex) { throw new BridgeError(FriendlyError(ex)); }
    }

    private async Task<object?> RestoreRecoveryAsync(string? id)
    {
        var draft = id == null ? null : _recovery.LoadOrphan(id);
        if (draft == null) throw new BridgeError("That draft is no longer available.");
        if (!await ConfirmDiscardAsync("recover")) return new { restored = false };

        if (draft.Path != null && File.Exists(draft.Path))
            _session.SetFile(draft.Path, draft.ToFormat(), FileStamp.Read(draft.Path));
        else
        {
            _session.ResetUntitled(draft.Title ?? "Recovered document");
            if (draft.Path != null) PushNotice($"The original file “{Path.GetFileName(draft.Path)}” no longer exists. Use Save As to keep this text.");
        }
        _session.Dirty = true;
        _session.LastMarkdown = draft.Markdown;
        // Take ownership: write our own draft before deleting the orphan so the text always exists on disk.
        _recovery.SaveOwn(draft.Markdown, _session.Title, _session.Path, _session.Format);
        _recovery.DiscardOrphan(draft.Id);
        PushEvent("doc.load", DocumentPayload(draft.Markdown, dirty: true, notice: $"Recovered unsaved work from {draft.SavedUtc.ToLocalTime():g}. Save to keep it."));
        UpdateWindowTitle();
        return new { restored = true };
    }

    // ------------------------------------------------------------------ save

    private async Task<object?> SaveAsync(bool saveAs)
    {
        var st = await GetEditorStateAsync() ?? throw new BridgeError("The editor is not responding, so nothing was saved. Your text is kept in the recovery draft.");
        var saved = await SaveCoreAsync(saveAs, st);
        return saved ? new { saved = true, fileName = _session.FileName } : new { saved = false };
    }

    private async Task<bool> SaveCoreAsync(bool saveAs, EditorState st)
    {
        var path = _session.Path;
        if (!saveAs && path != null && !st.Dirty && _session.Stamp != null && FileStamp.Read(path) == _session.Stamp)
        {
            // Nothing was edited and the file is unchanged on disk: don't rewrite it. (Visual mode would
            // otherwise re-serialize the Markdown and change formatting in a file the user never touched.)
            PushEvent("doc.saved", new { gen = st.Gen, path, fileName = Path.GetFileName(path), title = _session.Title });
            return true;
        }
        if (saveAs || path == null)
        {
            path = AskSavePath("Save Markdown file", path ?? DocumentFile.SafeFileName(st.Title), MarkdownFilter, ".md");
            if (path == null) return false;
        }
        else
        {
            var onDisk = FileStamp.Read(path);
            if (_session.Stamp != null && onDisk != null && onDisk != _session.Stamp)
            {
                var choice = ThemedDialog.Show(this, "The file changed on disk",
                    $"“{Path.GetFileName(path)}” was modified by another program after you opened it. Overwrite it with your version?",
                    [new DialogButton("Cancel", "cancel", Cancel: true), new DialogButton("Save as…", "saveAs"), new DialogButton("Overwrite", "overwrite", Primary: true)]);
                if (choice == "cancel") return false;
                if (choice == "saveAs")
                {
                    path = AskSavePath("Save Markdown file", path, MarkdownFilter, ".md");
                    if (path == null) return false;
                }
            }
        }

        FileStamp stamp;
        try
        {
            var target = path;
            var format = _session.Format;
            stamp = await Task.Run(() => DocumentFile.Save(target, st.Markdown, format, App.Paths.BackupFor(target)));
        }
        catch (Exception ex)
        {
            Log.Error("Save failed", ex);
            ThemedDialog.ShowError(this, "Could not save", FriendlyError(ex) + "\n\nYour text is still in the editor and in the recovery draft. Try Save As to choose another location.", path);
            return false;
        }

        var oldKey = _session.SnapshotKey;
        _session.SetFile(path, _session.Format, stamp);
        if (oldKey != _session.SnapshotKey) _snapshots.Merge(oldKey, _session.SnapshotKey, _session.Path);
        _session.Dirty = false;
        _session.LastMarkdown = null;
        _recovery.DeleteOwn();
        _settings.AddRecent(path);
        _settings.LastDocumentPath = path;
        ScheduleSettingsSave();
        PushRecent();
        PushEvent("doc.saved", new
        {
            gen = st.Gen, path, fileName = Path.GetFileName(path), title = _session.Title,
            encoding = _session.Format.EncodingName + (_session.Format.Bom ? " BOM" : ""), eol = _session.Format.Eol.ToString(),
        });
        UpdateWindowTitle();
        return true;
    }

    private string? AskSavePath(string title, string suggested, string filter, string defaultExt)
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
                ? dir : _session.Folder ?? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        };
        return dlg.ShowDialog(this) == true ? dlg.FileName : null;
    }

    // ------------------------------------------------------------------ export

    private async Task<object?> ExportMarkdownCopyAsync()
    {
        var st = await GetEditorStateAsync() ?? throw new BridgeError("The editor is not responding.");
        var suggested = DocumentFile.SafeFileName(st.Title + " (copy)");
        var path = AskSavePath("Export a copy as Markdown", _session.Folder != null ? Path.Combine(_session.Folder, suggested) : suggested, MarkdownFilter, ".md");
        if (path == null) return null;
        if (_session.Path != null && string.Equals(Path.GetFullPath(path), _session.Path, StringComparison.OrdinalIgnoreCase))
            throw new BridgeError("Choose a different file — use Save (Ctrl+S) to update the open document.");
        var format = _session.Format;
        await Task.Run(() => DocumentFile.Save(path, st.Markdown, format, null));
        PushNotice("Markdown copy saved to " + path);
        return new { path };
    }

    private async Task<object?> ExportHtmlAsync(string title, string bodyHtml)
    {
        var suggested = DocumentFile.SafeFileName(title, ".html");
        var path = AskSavePath("Export HTML", _session.Folder != null ? Path.Combine(_session.Folder, suggested) : suggested, "HTML document (*.html)|*.html", ".html");
        if (path == null) return null;
        var html = HtmlExport.Build(title, bodyHtml);
        await Task.Run(() => AtomicFile.WriteAllText(path, html));
        return new { path };
    }

    private async Task<object?> ExportPdfAsync(string title)
    {
        var suggested = DocumentFile.SafeFileName(title, ".pdf");
        var path = AskSavePath("Export PDF", _session.Folder != null ? Path.Combine(_session.Folder, suggested) : suggested, "PDF document (*.pdf)|*.pdf", ".pdf");
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

    private async Task CheckExternalChangesAsync()
    {
        if (!_webReady || _session.Path == null || _docGate.CurrentCount == 0) return;
        var onDisk = FileStamp.Read(_session.Path);
        if (onDisk == null)
        {
            if (!_session.DeletionNoticeShown && !File.Exists(_session.Path))
            {
                _session.DeletionNoticeShown = true;
                PushNotice($"“{Path.GetFileName(_session.Path)}” was moved or deleted outside NoorMD. Save to write it again.");
            }
            return;
        }
        if (_session.Stamp == null || onDisk == _session.Stamp || onDisk == _session.AcknowledgedExternalStamp) return;

        if (!await _docGate.WaitAsync(0)) return;
        try
        {
            _session.AcknowledgedExternalStamp = onDisk;
            var dirty = _session.Dirty;
            var reload = ThemedDialog.Show(this, "File changed on disk",
                dirty
                    ? $"“{Path.GetFileName(_session.Path)}” was changed by another program. Reload it and lose your unsaved changes, or keep your version?"
                    : $"“{Path.GetFileName(_session.Path)}” was changed by another program. Reload the new version?",
                [new DialogButton("Keep my version", "keep", Cancel: true), new DialogButton("Reload", "reload", Primary: !dirty)]) == "reload";
            if (!reload) return;
            try
            {
                var payload = LoadFileIntoSession(_session.Path, out _);
                _recovery.DeleteOwn();
                PushEvent("doc.load", payload);
            }
            catch (Exception ex) { ThemedDialog.ShowError(this, "Could not reload", FriendlyError(ex)); }
        }
        finally { _docGate.Release(); }
    }
}
