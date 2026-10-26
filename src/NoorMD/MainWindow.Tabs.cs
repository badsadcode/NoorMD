using System.IO;
using System.Text.Json;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Documents;
using NoorMD.Core.Recovery;
using NoorMD.Core.Settings;
using NoorMD.Host;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// Document tabs. Each tab is a <see cref="DocumentSession"/> with its own path, format, dirty state, recovery draft
/// and snapshot key, and its own editor on the page. The page owns the tab strip (order, pinning, which tab is
/// shown) and reports it with tabs.state; the host owns everything that touches files. Tab ids are created here.
/// </summary>
public partial class MainWindow
{
    private readonly Dictionary<string, DocumentSession> _tabs = new(StringComparer.Ordinal);
    private readonly List<string> _tabOrder = [];
    private string? _activeTabId;
    /// <summary>False for extra windows (New window): only the main window remembers its tabs.</summary>
    private readonly bool _persistSession = !Environment.GetCommandLineArgs().Contains("--new-window");

    private DocumentSession? ActiveSession => _activeTabId != null && _tabs.TryGetValue(_activeTabId, out var s) ? s : null;

    private IEnumerable<DocumentSession> OrderedTabs() => _tabOrder.Where(_tabs.ContainsKey).Select(id => _tabs[id]).ToList();

    private DocumentSession AddTab(string? tabId = null)
    {
        var id = tabId != null && RecoveryStore.IsValidTabId(tabId) && !_tabs.ContainsKey(tabId) ? tabId : Guid.NewGuid().ToString("N")[..16];
        var s = new DocumentSession(id);
        _tabs[id] = s;
        _tabOrder.Add(id);
        return s;
    }

    private void RemoveTab(DocumentSession s)
    {
        _tabs.Remove(s.TabId);
        _tabOrder.Remove(s.TabId);
        _recovery.DeleteOwn(s.TabId);
        if (_activeTabId == s.TabId) _activeTabId = _tabOrder.FirstOrDefault();
    }

    /// <summary>The tab a request is about. Requests name their tab; the shown tab is only a fallback.</summary>
    private DocumentSession TabFrom(BridgeRequest req)
    {
        var id = req.GetString("tabId", 32);
        if (id != null) return _tabs.TryGetValue(id, out var s) ? s : throw new BridgeError("That document is no longer open.");
        return ActiveSession ?? throw new BridgeError("No document is open.");
    }

    private DocumentSession? TryTabFrom(BridgeRequest req) =>
        req.GetString("tabId", 32) is { } id && _tabs.TryGetValue(id, out var s) ? s : null;

    private DocumentSession? FindTabByPath(string path)
    {
        string key;
        try { key = PathIdentity.Key(path); } catch (Exception) { return null; }
        return OrderedTabs().FirstOrDefault(s => PathIdentity.Same(s.PathKey, key));
    }

    /// <summary>An untouched, empty, untitled tab on screen: opening a file reuses it instead of leaving it behind.</summary>
    private async Task<DocumentSession?> ReusableBlankTabAsync()
    {
        var s = ActiveSession;
        if (s == null || s.Path != null || s.Dirty || s.Pinned) return null;
        var st = await GetEditorStateAsync(s.TabId);
        return st is { Dirty: false } && string.IsNullOrWhiteSpace(st.Markdown) ? s : null;
    }

    /// <summary>Asks the page to show a tab (before a prompt about it, or when a file is already open).</summary>
    private void SelectTab(DocumentSession s)
    {
        _activeTabId = s.TabId;
        PushEvent("tab.select", new { tabId = s.TabId });
        UpdateWindowTitle();
    }

    // ------------------------------------------------------------------ requests from the tab strip

    private void OnTabsState(BridgeRequest req)
    {
        if (req.Payload.TryGetProperty("tabs", out var list) && list.ValueKind == JsonValueKind.Array)
        {
            var order = new List<string>();
            foreach (var t in list.EnumerateArray())
            {
                if (t.ValueKind != JsonValueKind.Object || Json.OptString(t, "id", 32) is not { } id || !_tabs.TryGetValue(id, out var s) || order.Contains(id)) continue;
                order.Add(id);
                if (t.TryGetProperty("pinned", out var p) && p.ValueKind is JsonValueKind.True or JsonValueKind.False) s.Pinned = p.GetBoolean();
                if (Json.OptString(t, "mode", 16) is ("wysiwyg" or "markdown" or "split") and var mode) s.Mode = mode;
            }
            // Tabs the page has not heard of yet (a doc.load still in flight) keep their place at the end.
            order.AddRange(_tabOrder.Where(id => !order.Contains(id)));
            _tabOrder.Clear();
            _tabOrder.AddRange(order);
        }
        if (req.GetString("active", 32) is { } active && _tabs.ContainsKey(active)) _activeTabId = active;
        UpdateWindowTitle();
        PersistSession();
    }

    private async Task<object?> CloseTabAsync(DocumentSession s)
    {
        if (!await ConfirmDiscardAsync(s, "close")) return new { closed = false };
        RemoveTab(s);
        PushEvent("tab.closed", new { tabId = s.TabId });
        if (_tabs.Count == 0)
        {
            // There is always one document to type into.
            var blank = AddTab();
            _activeTabId = blank.TabId;
            PushEvent("doc.load", DocumentPayload(blank, "", dirty: false));
        }
        UpdateWindowTitle();
        PersistSession();
        return new { closed = true };
    }

    // ------------------------------------------------------------------ closing the window

    /// <summary>Returns true when every tab with unsaved changes has been saved or deliberately discarded.</summary>
    private async Task<bool> ConfirmCloseWindowAsync()
    {
        var dirty = new List<(DocumentSession Tab, EditorState? State)>();
        foreach (var s in OrderedTabs())
        {
            var st = await GetEditorStateAsync(s.TabId);
            s.SessionText = s.Path == null && st is { Dirty: false } && st.Markdown.Length <= WorkspaceSession.MaxUntitledText ? st.Markdown : null;
            if (st?.Dirty ?? s.Dirty) dirty.Add((s, st));
        }
        if (dirty.Count == 0) return true;
        if (dirty.Count == 1) return await ConfirmDiscardAsync(dirty[0].Tab, "closing");

        var names = string.Join("\n", dirty.Take(8).Select(d => "•  " + d.Tab.FileName)) + (dirty.Count > 8 ? $"\n…and {dirty.Count - 8} more" : "");
        var choice = ThemedDialog.Show(this, $"Save changes to {dirty.Count} documents?",
            names + "\n\nChanges you don't save will be lost.",
            [new DialogButton("Cancel", "cancel", Cancel: true), new DialogButton("Don't save", "discard"), new DialogButton("Review each…", "review"), new DialogButton("Save all", "save", Primary: true)]);
        switch (choice)
        {
            case "save":
                foreach (var (s, st) in dirty)
                {
                    var state = st ?? await GetEditorStateAsync(s.TabId);
                    if (state == null) continue; // unreachable editor: the recovery draft keeps the text
                    if (s.Path == null) SelectTab(s);
                    if (!await SaveCoreAsync(s, saveAs: false, state)) return false;
                }
                return true;
            case "review":
                foreach (var (s, _) in dirty)
                    if (!await ConfirmDiscardAsync(s, "closing")) return false;
                return true;
            case "discard":
                foreach (var (s, _) in dirty) MarkDiscarded(s);
                return true;
            default:
                return false;
        }
    }

    // ------------------------------------------------------------------ session (open tabs between runs)

    private void PersistSession()
    {
        if (!_persistSession) return;
        _settings.Session = new WorkspaceSession
        {
            ActiveTabId = _activeTabId,
            Tabs = OrderedTabs().Where(s => !s.Discarded).Select(s => new SessionTab
            {
                TabId = s.TabId,
                Path = s.Path,
                Title = s.Path == null ? s.UntitledTitle : null,
                Text = s.Path == null ? s.SessionText : null,
                Pinned = s.Pinned,
                Mode = s.Mode,
            }).ToList(),
        };
        ScheduleSettingsSave();
    }

    /// <summary>Brings back the previous session's tabs. A tab whose unsaved draft survived a crash gets that draft.</summary>
    private List<object> RestoreSession(out List<string> missing, out int recovered)
    {
        missing = [];
        recovered = 0;
        var payloads = new List<object>();
        var session = _settings.Session;
        if (session == null && _settings.LastDocumentPath is { } last) // settings from 1.x / 2.0 previews
            session = new WorkspaceSession { Tabs = [new SessionTab { TabId = Guid.NewGuid().ToString("N")[..16], Path = last }] };
        foreach (var step in SessionRestore.Plan(session, _recovery.ListOrphans(), File.Exists))
        {
            var tab = step.Tab;
            try
            {
                if (step.DraftId != null && _recovery.LoadOrphan(step.DraftId) is { } draft)
                {
                    var s = AddTab(tab.TabId);
                    s.Pinned = tab.Pinned; s.Mode = tab.Mode;
                    AdoptDraft(s, draft);
                    payloads.Add(DocumentPayload(s, draft.Markdown, dirty: true, background: true));
                    recovered++;
                }
                else if (tab.Path != null)
                {
                    if (step.FileMissing || FindTabByPath(tab.Path) != null) { if (step.FileMissing) missing.Add(tab.Path); continue; }
                    var loaded = DocumentFile.Load(tab.Path);
                    var s = AddTab(tab.TabId);
                    s.Pinned = tab.Pinned; s.Mode = tab.Mode;
                    s.SetFile(loaded.Path, loaded.Format, loaded.Stamp);
                    payloads.Add(DocumentPayload(s, loaded.Markdown, dirty: false, warning: loaded.Warning, background: true));
                }
                else
                {
                    var s = AddTab(tab.TabId);
                    s.Pinned = tab.Pinned; s.Mode = tab.Mode;
                    s.ResetUntitled(tab.Title ?? "Untitled document");
                    s.SessionText = tab.Text;
                    payloads.Add(DocumentPayload(s, tab.Text ?? "", dirty: false, background: true));
                }
            }
            catch (Exception ex)
            {
                Log.Error("Restoring tab failed: " + tab.Path, ex);
                if (tab.Path != null) missing.Add(tab.Path);
            }
        }
        if (session?.ActiveTabId is { } active && _tabs.ContainsKey(active)) _activeTabId = active;
        return payloads;
    }

    /// <summary>The doc.load payloads for all tabs, used when the renderer restarts after a crash.</summary>
    private List<object> PayloadsAfterRendererRestart()
    {
        var payloads = new List<object>();
        foreach (var s in OrderedTabs())
        {
            if (s.Dirty && s.LastMarkdown != null)
                payloads.Add(DocumentPayload(s, s.LastMarkdown, dirty: true, notice: "Editor restored from the last autosave.", background: true));
            else if (s.Path != null && File.Exists(s.Path))
            {
                try { payloads.Add(DocumentPayload(s, ApplyLoadedQuiet(s, DocumentFile.Load(s.Path)), dirty: false, background: true)); }
                catch (Exception ex) { Log.Error("Reloading " + s.Path + " failed", ex); }
            }
            else payloads.Add(DocumentPayload(s, s.SessionText ?? "", dirty: false, background: true));
        }
        return payloads;
    }

    private static string ApplyLoadedQuiet(DocumentSession s, LoadedDocument loaded)
    {
        s.SetFile(loaded.Path, loaded.Format, loaded.Stamp);
        s.Dirty = false;
        s.LastMarkdown = null;
        return loaded.Markdown;
    }
}
