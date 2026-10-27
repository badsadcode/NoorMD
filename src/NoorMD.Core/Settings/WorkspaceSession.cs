using NoorMD.Core.Recovery;

namespace NoorMD.Core.Settings;

/// <summary>One document tab as remembered between runs.</summary>
public sealed class SessionTab
{
    public string TabId { get; set; } = "";
    /// <summary>Saved file; null for an untitled document.</summary>
    public string? Path { get; set; }
    /// <summary>Title of an untitled document.</summary>
    public string? Title { get; set; }
    /// <summary>Text of a clean untitled document (for example the sample). Unsaved edits live in recovery drafts instead.</summary>
    public string? Text { get; set; }
    public bool Pinned { get; set; }
    /// <summary>Where an untitled document's revision snapshots are kept, so they are still there after a restart.</summary>
    public string? SnapshotKey { get; set; }
    /// <summary>"wysiwyg", "markdown" or "split".</summary>
    public string? Mode { get; set; }
}

/// <summary>The open tabs of the main window: order, pinning, view mode and the selected tab.</summary>
public sealed class WorkspaceSession
{
    public const int MaxTabs = 100;
    public const int MaxUntitledText = 256 * 1024;
    private static readonly string[] Modes = ["wysiwyg", "markdown", "split"];

    public List<SessionTab> Tabs { get; set; } = [];
    public string? ActiveTabId { get; set; }

    /// <summary>Drops anything a hand-edited or damaged settings file could contain that the app must not trust.</summary>
    public void Normalize()
    {
        Tabs ??= [];
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Tabs = Tabs.Where(t => t != null && RecoveryStore.IsValidTabId(t.TabId) && seen.Add(t.TabId))
                   .Where(t => t.Path == null || (System.IO.Path.IsPathFullyQualified(t.Path) && paths.Add(t.Path)))
                   .Take(MaxTabs).ToList();
        foreach (var t in Tabs)
        {
            if (t.Mode != null && !Modes.Contains(t.Mode)) t.Mode = null;
            if (t.Title is { Length: > 200 }) t.Title = t.Title[..200];
            if (t.Path != null || t.Text is { Length: > MaxUntitledText }) t.Text = null;
        }
        if (ActiveTabId != null && !Tabs.Any(t => t.TabId == ActiveTabId)) ActiveTabId = null;
    }
}

/// <summary>What to do for one remembered tab on startup.</summary>
public sealed record RestoreStep(SessionTab Tab, string? DraftId, bool FileMissing);

/// <summary>Decides how a remembered session comes back, given the recovery drafts left by a crash.</summary>
public static class SessionRestore
{
    /// <summary>
    /// A tab whose unsaved draft survived (crash, power loss, Windows shutdown) gets that draft back. Other saved
    /// files are reopened from disk; a file that no longer exists is reported, not opened. Untitled tabs without a
    /// draft come back with their title and remembered text (empty unless it was, say, the sample).
    /// </summary>
    public static List<RestoreStep> Plan(WorkspaceSession? session, IEnumerable<RecoverySummary> orphans, Func<string, bool> fileExists)
    {
        var steps = new List<RestoreStep>();
        if (session == null) return steps;
        session.Normalize();
        // The newest draft per tab id wins (drafts from several crashed sessions can share a tab id).
        var drafts = orphans.Where(o => RecoveryStore.TabIdOf(o.Id) != null)
                            .GroupBy(o => RecoveryStore.TabIdOf(o.Id)!)
                            .ToDictionary(g => g.Key, g => g.OrderByDescending(o => o.SavedUtc).First().Id);
        foreach (var tab in session.Tabs)
        {
            if (drafts.TryGetValue(tab.TabId, out var draftId)) steps.Add(new RestoreStep(tab, draftId, false));
            else if (tab.Path != null) steps.Add(new RestoreStep(tab, null, !fileExists(tab.Path)));
            else steps.Add(new RestoreStep(tab, null, false));
        }
        return steps;
    }
}
