namespace NoorMD.Core;

/// <summary>
/// Where NoorMD keeps its own data. Nothing is written next to the executable, so the app also
/// runs from read-only locations such as Program Files or a zip extracted to a USB stick.
/// </summary>
public sealed class AppPaths
{
    public string Roaming { get; }
    public string Local { get; }
    public string SettingsFile => Path.Combine(Roaming, "settings.json");
    public string Recovery => Path.Combine(Local, "Recovery");
    public string Snapshots => Path.Combine(Local, "Snapshots");
    public string Backups => Path.Combine(Local, "Backups");
    public string WebViewData => Path.Combine(Local, "WebView2");
    public string Logs => Path.Combine(Local, "Logs");

    public AppPaths(string roaming, string local)
    {
        Roaming = roaming;
        Local = local;
        foreach (var dir in new[] { Roaming, Local, Recovery, Snapshots, Backups, Logs })
            Directory.CreateDirectory(dir);
    }

    public static AppPaths ForCurrentUser() => new(
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "NoorMD"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NoorMD"));

    /// <summary>Per-file copy of the previous version, refreshed on every save.</summary>
    public string BackupFor(string documentPath)
    {
        var key = KeyFragment(documentPath);
        return Path.Combine(Backups, $"{key}-{Path.GetFileName(documentPath)}.bak");
    }

    private static string KeyFragment(string path) =>
        NoorMD.Core.Snapshots.SnapshotStore.KeyForPath(path)["doc-".Length..][..12];
}
