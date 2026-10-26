using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Documents;
using NoorMD.Core.Recovery;
using NoorMD.Core.Security;
using NoorMD.Core.Settings;
using NoorMD.Host;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>Bridge message dispatch (protocol v2, see docs/BRIDGE.md). Every request is validated here.
/// Document requests carry the tabId they are about.</summary>
public partial class MainWindow
{
    /// <summary>Thrown by a handler to send a user-readable error back to the page.</summary>
    private sealed class BridgeError(string message) : Exception(message);

    private sealed record EditorState(string Markdown, string Title, bool Dirty, long Gen, string Mode);

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // Only the app page may talk to the host.
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || !AssetResolver.IsAppPage(source)) return;
        if (!BridgeProtocol.TryParse(e.WebMessageAsJson, out var req, out var error) || req == null)
        {
            Log.Error("Rejected bridge message: " + error);
            return;
        }

        try
        {
            object? result = req.Type switch
            {
                "files.dropped" => await OnFilesDroppedAsync(e.AdditionalObjects),
                _ => await DispatchAsync(req),
            };
            if (req.Id is long id) Reply(id, result);
        }
        catch (BridgeError ex)
        {
            if (req.Id is long id) PostRaw(BridgeProtocol.ReplyError(id, ex.Message));
        }
        catch (Exception ex)
        {
            Log.Error($"Bridge request {req.Type} failed", ex);
            if (req.Id is long id) PostRaw(BridgeProtocol.ReplyError(id, FriendlyError(ex)));
        }
    }

    private async Task<object?> DispatchAsync(BridgeRequest req)
    {
        switch (req.Type)
        {
            // --- lifecycle / notifications (posted without an id)
            case "app.ready": return await OnReadyAsync();
            case "doc.state": OnDocState(req); return null;
            case "doc.changed": OnDocChanged(req); return null;
            case "prefs.set": OnPrefsSet(req); return null;

            // --- documents and tabs
            case "doc.new": return await WithDocGate(() => NewDocumentAsync(req.GetString("markdown", 1_000_000) ?? "", req.GetString("title", 200), Json.IsTrue(req.Payload, "reuseBlank")));
            case "doc.open": return await WithDocGate(() => OpenWithDialogAsync());
            case "doc.openRecent": return await WithDocGate(() => OpenRecentAsync(req.GetString("path", 4096)));
            case "doc.save": return await WithDocGate(() => SaveAsync(TabFrom(req), saveAs: false));
            case "doc.saveAs": return await WithDocGate(() => SaveAsync(TabFrom(req), saveAs: true));
            case "doc.saveAll": return await WithDocGate(SaveAllAsync);
            case "doc.reload": return await WithDocGate(() => ReloadFromDiskAsync(TabFrom(req)));
            case "doc.reveal": RevealInExplorer(TabFrom(req)); return null;
            case "doc.copyPath":
                CopyToClipboard(TabFrom(req).Path ?? throw new BridgeError("This document has not been saved yet."));
                return null;
            case "tabs.state": OnTabsState(req); return null;
            case "tab.close": return await WithDocGate(() => CloseTabAsync(TabFrom(req)));

            // --- export
            case "export.markdown": return await WithDocGate(() => ExportMarkdownCopyAsync(TabFrom(req)));
            case "export.html": { var s = TabFrom(req); return await WithDocGate(() => ExportHtmlAsync(s, req.GetString("title", 300) ?? s.Title, req.GetString("bodyHtml") ?? "")); }
            case "export.pdf": { var s = TabFrom(req); return await WithDocGate(() => ExportPdfAsync(s, req.GetString("title", 300) ?? s.Title)); }
            case "print": Core.ShowPrintUI(CoreWebView2PrintDialogKind.System); return null;

            // --- recent files, recovery, snapshots
            case "recent.clear":
                _settings.Recent.Clear();
                ScheduleSettingsSave();
                PushRecent();
                return null;
            case "recovery.list": return _recovery.ListOrphans();
            case "recovery.restore": return await WithDocGate(() => RestoreRecoveryAsync(req.GetString("id", 64)));
            case "recovery.discard":
                if (!_recovery.DiscardOrphan(req.GetString("id", 64) ?? "")) throw new BridgeError("That draft is no longer available.");
                return null;
            case "recovery.clearAll": return new { deleted = _recovery.DiscardAllOrphans() };
            case "snapshots.list": return _snapshots.List(TabFrom(req).SnapshotKey);
            case "snapshots.create": return await CreateSnapshotAsync(TabFrom(req), req.GetString("label", 200) ?? "Snapshot");
            case "snapshots.get":
                return _snapshots.Get(TabFrom(req).SnapshotKey, req.GetString("id", 64) ?? "") ?? throw new BridgeError("Snapshot not found.");
            case "snapshots.delete":
                _snapshots.Delete(TabFrom(req).SnapshotKey, req.GetString("id", 64) ?? "");
                return null;

            // --- shell
            case "clipboard.copyText": CopyToClipboard(req.GetString("text", (int)TextFileCodec.MaxFileBytes) ?? throw new BridgeError("Nothing to copy.")); return null;
            case "link.open": await HandleLinkAsync(req.GetString("href", 4096) ?? "", TryTabFrom(req)); return null;
            case "app.openDataFolder": OpenFolder(App.Paths.Local); return null;
            case "app.openLicenses": OpenFolder(Path.Combine(AppContext.BaseDirectory, "licenses")); return null;
            case "app.newWindow": Process.Start(new ProcessStartInfo(Environment.ProcessPath!, "--new-window") { UseShellExecute = false }); return null;
            case "app.about":
                return new
                {
                    version = typeof(App).Assembly.GetName().Version?.ToString(3),
                    build = $"{typeof(App).Assembly.GetName().Version?.ToString(3)} ({File.GetLastWriteTimeUtc(typeof(App).Assembly.Location):yyyy-MM-dd}, {(Environment.Is64BitProcess ? "x64" : "x86")})",
                    runtime = RuntimeInformation.FrameworkDescription,
                    webView2 = Core.Environment.BrowserVersionString,
                };
            case var music when music.StartsWith("music.", StringComparison.Ordinal):
                return await DispatchMusicAsync(req);
            default:
                throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }

    private async Task<object?> WithDocGate(Func<Task<object?>> action)
    {
        // One document operation at a time (e.g. a second Ctrl+O while a dialog is open is ignored).
        if (!await _docGate.WaitAsync(0)) return new { busy = true };
        try { return await action(); }
        finally { _docGate.Release(); }
    }

    // ------------------------------------------------------------------ handlers

    private async Task<object?> OnReadyAsync()
    {
        _webReady = true;
        _readyCount++;
        var tabs = new List<object>();
        var notices = new List<string>();
        var welcome = false;

        if (_readyCount > 1)
        {
            // The renderer was reloaded (e.g. after a crash): put every tab's text back.
            tabs = PayloadsAfterRendererRestart();
        }
        else
        {
            if (_persistSession && _settings.Prefs.RestoreSession)
            {
                tabs = RestoreSession(out var missing, out var recovered);
                if (recovered > 0) notices.Add(recovered == 1 ? "Recovered unsaved work in 1 document. Save to keep it." : $"Recovered unsaved work in {recovered} documents. Save to keep it.");
                if (missing.Count > 0)
                    notices.Add((missing.Count == 1 ? "A file from your last session was not found: " : $"{missing.Count} files from your last session were not found: ")
                        + string.Join(", ", missing.Take(5).Select(Path.GetFileName)) + (missing.Count > 5 ? "…" : "") + ". It may have been moved, renamed or deleted.");
            }
            var path = _startupFile;
            _startupFile = null;
            if (path != null)
            {
                try
                {
                    var existing = FindTabByPath(path);
                    if (existing != null) _activeTabId = existing.TabId;
                    else
                    {
                        var loaded = DocumentFile.Load(path);
                        var s = AddTab();
                        tabs.Add(ApplyLoaded(s, loaded));
                        _activeTabId = s.TabId;
                    }
                }
                catch (Exception ex)
                {
                    var msg = $"Could not open \"{path}\": {FriendlyError(ex)}";
                    Log.Error(msg, ex);
                    _ = Dispatcher.BeginInvoke(() => PushEvent("error", new { text = msg }));
                }
            }
            if (_tabs.Count == 0)
            {
                var blank = AddTab();
                tabs.Add(DocumentPayload(blank, "", dirty: false));
                welcome = true;
            }
            _activeTabId ??= _tabOrder[0];
            PersistSession();
        }

        foreach (var n in notices) _ = Dispatcher.BeginInvoke(() => PushEvent("notice", new { text = n, ms = 7000 }));
        if (SelfTestDir != null && _readyCount == 1) _ = Dispatcher.BeginInvoke(async () => await RunSelfTestAsync());
        UpdateWindowTitle();
        await Task.CompletedTask;
        return new
        {
            prefs = _settings.Prefs,
            recent = RecentForPage(),
            tabs,
            activeTabId = _activeTabId,
            welcome,
            recovery = _readyCount == 1 ? _recovery.ListOrphans() : new List<RecoverySummary>(),
        };
    }

    private void OnDocState(BridgeRequest req)
    {
        var s = TryTabFrom(req);
        if (s == null) return; // the tab was closed while the message was on its way
        if (req.Payload.TryGetProperty("dirty", out var d) && d.ValueKind is JsonValueKind.True or JsonValueKind.False) s.Dirty = d.GetBoolean();
        if (s.Path == null && req.GetString("title", 200) is { } t) s.UntitledTitle = t;
        UpdateWindowTitle();
    }

    private void OnDocChanged(BridgeRequest req)
    {
        var s = TryTabFrom(req);
        var markdown = req.GetString("markdown", (int)TextFileCodec.MaxFileBytes);
        if (s == null || markdown == null) return;
        OnDocState(req);
        if (s.Dirty)
        {
            s.LastMarkdown = markdown;
            try { _recovery.SaveOwn(s.TabId, markdown, s.Title, s.Path, s.Format); }
            catch (Exception ex) { Log.Error("Writing recovery draft failed", ex); }
        }
        else
        {
            s.LastMarkdown = null;
            _recovery.DeleteOwn(s.TabId);
        }
    }

    private void OnPrefsSet(BridgeRequest req)
    {
        var oldTheme = _settings.Prefs.Theme;
        _settings.Prefs.Apply(req.Payload);
        if (_settings.Prefs.Theme != oldTheme)
        {
            ThemeManager.Apply(_settings.Prefs.Theme);
            Web.DefaultBackgroundColor = ToDrawing(ThemeManager.Background(_settings.Prefs.Theme));
        }
        ScheduleSettingsSave();
    }

    private async Task<object?> OnFilesDroppedAsync(IReadOnlyList<object>? objects)
    {
        var paths = (objects ?? Array.Empty<object>()).OfType<CoreWebView2File>().Select(f => f.Path).Where(p => !string.IsNullOrEmpty(p)).ToList();
        if (paths.Count == 0) return null;
        var docs = paths.Where(DocumentFile.IsOpenable).Take(50).ToList();
        if (docs.Count > 0)
        {
            return await WithDocGate(async () =>
            {
                object? last = null;
                foreach (var doc in docs) last = await OpenPathAsync(doc);
                return last;
            });
        }
        var image = paths.FirstOrDefault(p => AssetResolver.ImageExtensions.Contains(Path.GetExtension(p)));
        if (image != null && ActiveSession?.Folder is { } folder && Path.GetFullPath(image).StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        {
            var rel = Path.GetRelativePath(folder, image).Replace('\\', '/');
            var encoded = string.Join('/', rel.Split('/').Select(Uri.EscapeDataString));
            PushEvent("insert.text", new { markdown = $"![{Path.GetFileNameWithoutExtension(image)}]({encoded})" });
            return null;
        }
        PushNotice(image != null
            ? "Images can be inserted by dropping them from the document's own folder (or a subfolder), so the link keeps working. Save the document first if it is new."
            : "Only Markdown (.md, .markdown) and text (.txt) files can be opened.");
        return null;
    }

    private async Task<object?> CreateSnapshotAsync(DocumentSession s, string label)
    {
        var st = await GetEditorStateAsync(s.TabId) ?? throw new BridgeError("The editor is not responding.");
        return _snapshots.Create(s.SnapshotKey, st.Markdown, label, st.Title, s.Path);
    }

    /// <summary>A link clicked in a document; relative links resolve against that document's folder.</summary>
    internal async Task HandleLinkAsync(string href, DocumentSession? from = null)
    {
        var decision = LinkPolicy.Classify(href, (from ?? ActiveSession)?.Folder);
        switch (decision.Kind)
        {
            case LinkKind.External:
                if (ThemedDialog.Confirm(this, "Open link in your browser?", "This link leads outside NoorMD:", "Open link", decision.Target))
                    OpenExternal(decision.Target);
                break;
            case LinkKind.LocalDocument:
                if (!ThemedDialog.Confirm(this, "Open linked document?", $"Open \"{Path.GetFileName(decision.Target)}\" in NoorMD?", "Open", decision.Target)) return;
                await WithDocGate(() => OpenPathAsync(decision.Target));
                break;
            default:
                PushNotice(decision.Reason);
                break;
        }
    }

    private static void CopyToClipboard(string text)
    {
        // The clipboard can be briefly locked by another app (clipboard managers, RDP); retry a few times.
        for (int attempt = 0; ; attempt++)
        {
            try { System.Windows.Clipboard.SetText(text.Replace("\n", Environment.NewLine), System.Windows.TextDataFormat.UnicodeText); return; }
            catch (System.Runtime.InteropServices.COMException) when (attempt < 4) { Thread.Sleep(60); }
            catch (System.Runtime.InteropServices.COMException) { throw new BridgeError("The clipboard is in use by another program. Try again."); }
        }
    }

    private static void RevealInExplorer(DocumentSession s)
    {
        if (s.Path == null) throw new BridgeError("This document has not been saved yet.");
        Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{s.Path}\"") { UseShellExecute = false });
    }

    private static void OpenFolder(string folder)
    {
        Directory.CreateDirectory(folder);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{folder}\"") { UseShellExecute = false });
    }

    // ------------------------------------------------------------------ messaging helpers

    /// <summary>Reads one tab's current text straight from its editor, including keystrokes not yet sent as doc.changed.</summary>
    private async Task<EditorState?> GetEditorStateAsync(string tabId)
    {
        if (!RecoveryStore.IsValidTabId(tabId)) return null;
        try
        {
            var json = await Core.ExecuteScriptAsync($"window.NoorMD ? window.NoorMD.flush('{tabId}') : null");
            if (string.IsNullOrEmpty(json) || json == "null") return null;
            return JsonSerializer.Deserialize<EditorState>(json, SettingsStore.Json);
        }
        catch (Exception ex)
        {
            Log.Error("Reading editor state failed", ex);
            return null;
        }
    }

    private void Reply(long id, object? result) => PostRaw(BridgeProtocol.Reply(id, result));
    internal void PushEvent(string name, object? payload) => PostRaw(BridgeProtocol.Event(name, payload));
    internal void PushNotice(string text) => PushEvent("notice", new { text, ms = 5000 });
    private void PushRecent() => PushEvent("recent.changed", new { recent = RecentForPage() });

    private void PostRaw(string json)
    {
        try { Core?.PostWebMessageAsJson(json); }
        catch (Exception ex) { Log.Error("Posting to editor failed", ex); }
    }

    private object RecentForPage() => _settings.Recent.Select(r => new { path = r.Path, name = r.Name }).ToList();

    private static string FriendlyError(Exception ex) => ex switch
    {
        UnauthorizedAccessException => ex.Message.Contains("read-only", StringComparison.OrdinalIgnoreCase) ? ex.Message : "Windows denied access to this file or folder. " + ex.Message,
        PathTooLongException => "The file path is too long.",
        DirectoryNotFoundException => "The folder no longer exists. " + ex.Message,
        FileNotFoundException => ex.Message,
        IOException io when (io.HResult & 0xFFFF) is 32 or 33 => "The file is locked by another program. Close it there and try again.",
        IOException io when (io.HResult & 0xFFFF) is 112 => "There is not enough disk space.",
        _ => ex.Message,
    };
}
