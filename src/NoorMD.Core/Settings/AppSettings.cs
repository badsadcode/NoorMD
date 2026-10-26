using System.Text.Json;
using System.Text.Json.Serialization;
using NoorMD.Core.Documents;

namespace NoorMD.Core.Settings;

/// <summary>Editor preferences shared with the web UI (serialized camelCase).</summary>
public sealed class EditorPrefs
{
    public string Theme { get; set; } = "dark";
    public string FontFamily { get; set; } = "inter";
    public int FontSize { get; set; } = 16;
    public string LineWidth { get; set; } = "comfortable";
    public string OpenMode { get; set; } = "visual";
    public int SidebarWidth { get; set; } = 256;
    public bool SidebarCollapsed { get; set; }
    public double SplitRatio { get; set; } = 0.5;
    public int GoalWords { get; set; } = 750;
    public bool RestoreSession { get; set; } = true;
    public bool Spellcheck { get; set; } = true;
    public bool Compact { get; set; }
    public int SourceFontSize { get; set; } = 14;
    public bool LineNumbers { get; set; } = true;
    public bool WordWrap { get; set; } = true;
    public bool SyncScroll { get; set; }
    public bool ShowMusic { get; set; } = true;
    public bool MiniPlayer { get; set; } = true;
    public int MusicWidth { get; set; } = 400;

    private static readonly string[] Fonts = ["inter", "system", "serif", "mono"];
    private static readonly string[] Widths = ["comfortable", "wide", "full"];
    private static readonly string[] OpenModes = ["visual", "markdown"];

    /// <summary>Applies a partial update from the web UI. Unknown keys and invalid values are ignored.</summary>
    public void Apply(JsonElement patch)
    {
        if (patch.ValueKind != JsonValueKind.Object) return;
        foreach (var p in patch.EnumerateObject())
        {
            switch (p.Name)
            {
                case "theme": Theme = Pick(p.Value, ThemeCatalog.All.Select(t => t.Id).ToArray(), Theme); break;
                case "fontFamily": FontFamily = Pick(p.Value, Fonts, FontFamily); break;
                case "lineWidth": LineWidth = Pick(p.Value, Widths, LineWidth); break;
                case "openMode": OpenMode = Pick(p.Value, OpenModes, OpenMode); break;
                case "fontSize" when Bridge.Json.TryInt(p.Value, out var size): FontSize = size; break;
                case "sidebarWidth" when Bridge.Json.TryInt(p.Value, out var w): SidebarWidth = w; break;
                case "goalWords" when Bridge.Json.TryInt(p.Value, out var g): GoalWords = g; break;
                case "splitRatio" when Bridge.Json.TryDouble(p.Value, out var r): SplitRatio = r; break;
                case "sidebarCollapsed" when p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False: SidebarCollapsed = p.Value.GetBoolean(); break;
                case "restoreSession" when p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False: RestoreSession = p.Value.GetBoolean(); break;
                case "spellcheck" when p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False: Spellcheck = p.Value.GetBoolean(); break;
                case "compact" when p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False: Compact = p.Value.GetBoolean(); break;
                case "sourceFontSize" when Bridge.Json.TryInt(p.Value, out var ss): SourceFontSize = ss; break;
                case "lineNumbers" when p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False: LineNumbers = p.Value.GetBoolean(); break;
                case "wordWrap" when p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False: WordWrap = p.Value.GetBoolean(); break;
                case "showMusic" when p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False: ShowMusic = p.Value.GetBoolean(); break;
                case "miniPlayer" when p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False: MiniPlayer = p.Value.GetBoolean(); break;
                case "musicWidth" when Bridge.Json.TryInt(p.Value, out var mw): MusicWidth = mw; break;
                case "syncScroll" when p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False: SyncScroll = p.Value.GetBoolean(); break;
            }
        }
        Normalize();
    }

    public void Normalize()
    {
        if (!ThemeCatalog.Exists(Theme)) Theme = "dark";
        if (!Fonts.Contains(FontFamily)) FontFamily = "inter";
        if (!Widths.Contains(LineWidth)) LineWidth = "comfortable";
        if (!OpenModes.Contains(OpenMode)) OpenMode = "visual";
        FontSize = Math.Clamp(FontSize, 12, 26);
        SourceFontSize = Math.Clamp(SourceFontSize, 11, 22);
        MusicWidth = Math.Clamp(MusicWidth, 300, 640);
        SidebarWidth = Math.Clamp(SidebarWidth, 200, 420);
        GoalWords = Math.Clamp(GoalWords, 1, 1_000_000);
        SplitRatio = double.IsFinite(SplitRatio) ? Math.Clamp(SplitRatio, 0.3, 0.7) : 0.5;
    }

    private static string Pick(JsonElement v, string[] allowed, string fallback) =>
        v.ValueKind == JsonValueKind.String && allowed.Contains(v.GetString()) ? v.GetString()! : fallback;
}

public sealed class RecentFile
{
    public string Path { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTime OpenedUtc { get; set; }
}

public sealed class WindowPlacement
{
    public double Left { get; set; }
    public double Top { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
    public bool Maximized { get; set; }
}

public sealed class AppSettings
{
    public const int MaxRecent = 15;

    public int Version { get; set; } = 1;
    public EditorPrefs Prefs { get; set; } = new();
    public List<RecentFile> Recent { get; set; } = [];
    public WindowPlacement? Window { get; set; }
    /// <summary>Kept for settings written by 1.x; the open tabs are in <see cref="Session"/>.</summary>
    public string? LastDocumentPath { get; set; }
    public WorkspaceSession? Session { get; set; }

    public void AddRecent(string path)
    {
        var full = System.IO.Path.GetFullPath(path);
        Recent.RemoveAll(r => string.Equals(r.Path, full, StringComparison.OrdinalIgnoreCase));
        Recent.Insert(0, new RecentFile { Path = full, Name = System.IO.Path.GetFileName(full), OpenedUtc = DateTime.UtcNow });
        if (Recent.Count > MaxRecent) Recent.RemoveRange(MaxRecent, Recent.Count - MaxRecent);
    }

    public bool IsRecent(string path) =>
        Recent.Any(r => string.Equals(r.Path, path, StringComparison.OrdinalIgnoreCase));

    public void RemoveRecent(string path) =>
        Recent.RemoveAll(r => string.Equals(r.Path, path, StringComparison.OrdinalIgnoreCase));
}

/// <summary>Loads and saves settings.json. A corrupt file is moved aside instead of being overwritten.</summary>
public sealed class SettingsStore(string filePath)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public string FilePath { get; } = filePath;

    public AppSettings Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return new AppSettings();
            var settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath), Json) ?? new AppSettings();
            settings.Prefs ??= new EditorPrefs();
            settings.Recent ??= [];
            settings.Prefs.Normalize();
            settings.Recent.RemoveAll(r => string.IsNullOrWhiteSpace(r.Path));
            settings.Session?.Normalize();
            return settings;
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException)
        {
            try { File.Move(FilePath, FilePath + $".corrupt-{DateTime.UtcNow:yyyyMMddHHmmss}", overwrite: true); } catch { }
            return new AppSettings();
        }
    }

    public void Save(AppSettings settings) =>
        AtomicFile.WriteAllText(FilePath, JsonSerializer.Serialize(settings, Json));
}
