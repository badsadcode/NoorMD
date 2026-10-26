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
using NoorMD.Ui;

namespace NoorMD;

/// <summary>Bridge message dispatch (protocol v1, see docs/BRIDGE.md). Every request is validated here.</summary>
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

            // --- documents
            case "doc.new": return await WithDocGate(() => NewDocumentAsync(req.GetString("markdown", 1_000_000) ?? "", req.GetString("title", 200)));
            case "doc.open": return await WithDocGate(() => OpenWithDialogAsync());
            case "doc.openRecent": return await WithDocGate(() => OpenRecentAsync(req.GetString("path", 4096)));
            case "doc.save": return await WithDocGate(() => SaveAsync(saveAs: false));
            case "doc.saveAs": return await WithDocGate(() => SaveAsync(saveAs: true));
            case "doc.reload": return await WithDocGate(ReloadFromDiskAsync);
            case "doc.reveal": RevealInExplorer(); return null;

            // --- export
            case "export.markdown": return await WithDocGate(ExportMarkdownCopyAsync);
            case "export.html": return await WithDocGate(() => ExportHtmlAsync(req.GetString("title", 300) ?? _session.Title, req.GetString("bodyHtml") ?? ""));
            case "export.pdf": return await WithDocGate(() => ExportPdfAsync(req.GetString("title", 300) ?? _session.Title));
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
            case "snapshots.list": return _snapshots.List(_session.SnapshotKey);
            case "snapshots.create": return await CreateSnapshotAsync(req.GetString("label", 200) ?? "Snapshot");
            case "snapshots.get":
                return _snapshots.Get(_session.SnapshotKey, req.GetString("id", 64) ?? "") ?? throw new BridgeError("Snapshot not found.");
            case "snapshots.delete":
                _snapshots.Delete(_session.SnapshotKey, req.GetString("id", 64) ?? "");
                return null;

            // --- shell
            case "clipboard.copyText": CopyToClipboard(req.GetString("text", (int)TextFileCodec.MaxFileBytes) ?? throw new BridgeError("Nothing to copy.")); return null;
            case "link.open": await HandleLinkAsync(req.GetString("href", 4096) ?? ""); return null;
            case "app.openDataFolder": OpenFolder(App.Paths.Local); return null;
            case "app.openLicenses": OpenFolder(Path.Combine(AppContext.BaseDirectory, "licenses")); return null;
            case "app.newWindow": Process.Start(new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false }); return null;
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
        object? document = null;
        string? startupError = null;

        if (_readyCount > 1)
        {
            // The renderer was reloaded (e.g. after a crash): put the user's text back.
            document = _session.Dirty && _session.LastMarkdown != null
                ? DocumentPayload(_session.LastMarkdown, dirty: true, notice: "Editor restored from the last autosave.")
                : _session.Path != null && File.Exists(_session.Path) ? LoadFileIntoSession(_session.Path, out _) : null;
        }
        else
        {
            var path = _startupFile;
            _startupFile = null;
            if (path == null && _settings.Prefs.RestoreSession && _settings.LastDocumentPath is { } last && File.Exists(last)) path = last;
            if (path != null)
            {
                try { document = LoadFileIntoSession(path, out _); }
                catch (Exception ex) { startupError = $"Could not open \"{path}\": {FriendlyError(ex)}"; Log.Error(startupError, ex); }
            }
        }

        if (startupError != null) _ = Dispatcher.BeginInvoke(() => PushEvent("error", new { text = startupError }));
        if (SelfTestDir != null && _readyCount == 1) _ = Dispatcher.BeginInvoke(async () => await RunSelfTestAsync());
        await Task.CompletedTask;
        return new
        {
            prefs = _settings.Prefs,
            recent = RecentForPage(),
            document,
            recovery = _readyCount == 1 ? _recovery.ListOrphans() : new List<RecoverySummary>(),
        };
    }

    private void OnDocState(BridgeRequest req)
    {
        if (req.Payload.TryGetProperty("dirty", out var d) && d.ValueKind is JsonValueKind.True or JsonValueKind.False) _session.Dirty = d.GetBoolean();
        if (_session.Path == null && req.GetString("title", 200) is { } t) _session.UntitledTitle = t;
        UpdateWindowTitle();
    }

    private void OnDocChanged(BridgeRequest req)
    {
        var markdown = req.GetString("markdown", (int)TextFileCodec.MaxFileBytes);
        if (markdown == null) return;
        OnDocState(req);
        if (_session.Dirty)
        {
            _session.LastMarkdown = markdown;
            try { _recovery.SaveOwn(markdown, _session.Title, _session.Path, _session.Format); }
            catch (Exception ex) { Log.Error("Writing recovery draft failed", ex); }
        }
        else
        {
            _session.LastMarkdown = null;
            _recovery.DeleteOwn();
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
        var doc = paths.FirstOrDefault(DocumentFile.IsOpenable);
        if (doc != null)
        {
            if (paths.Count > 1) PushNotice("Opened the first Markdown file. NoorMD edits one document per window.");
            return await WithDocGate(() => OpenPathAsync(doc));
        }
        var image = paths.FirstOrDefault(p => AssetResolver.ImageExtensions.Contains(Path.GetExtension(p)));
        if (image != null && _session.Folder is { } folder && Path.GetFullPath(image).StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
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

    private async Task<object?> CreateSnapshotAsync(string label)
    {
        var st = await GetEditorStateAsync() ?? throw new BridgeError("The editor is not responding.");
        return _snapshots.Create(_session.SnapshotKey, st.Markdown, label, st.Title, _session.Path);
    }

    internal async Task HandleLinkAsync(string href)
    {
        var decision = LinkPolicy.Classify(href, _session.Folder);
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

    private void RevealInExplorer()
    {
        if (_session.Path == null) throw new BridgeError("This document has not been saved yet.");
        Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{_session.Path}\"") { UseShellExecute = false });
    }

    private static void OpenFolder(string folder)
    {
        Directory.CreateDirectory(folder);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{folder}\"") { UseShellExecute = false });
    }

    // ------------------------------------------------------------------ messaging helpers

    private async Task<EditorState?> GetEditorStateAsync()
    {
        try
        {
            var json = await Core.ExecuteScriptAsync("window.NoorMD ? window.NoorMD.flush() : null");
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
