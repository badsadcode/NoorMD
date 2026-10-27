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
    /// <summary>Where the sidebar and panels go (dock.js). The page validates the contents; here only the shape and size.</summary>
    public System.Text.Json.Nodes.JsonObject? Layout { get; set; }
    /// <summary>Layouts saved by name: [{ name, layout }].</summary>
    public System.Text.Json.Nodes.JsonArray? Layouts { get; set; }
    public string? LayoutName { get; set; }
    public bool ShowToolbar { get; set; } = true;
    public bool ToolbarLabels { get; set; }
    public bool ToolbarSmall { get; set; }
    public bool ZenToolbar { get; set; }
    /// <summary>Visible toolbar groups, in order (comma-separated ids).</summary>
    public string ToolbarGroups { get; set; } = DefaultToolbarGroups;

    public const string DefaultToolbarGroups = "document,writing,navigation,view,tools,media";
    private static readonly string[] ToolbarGroupIds = ["document", "writing", "navigation", "view", "tools", "media", "vault"];

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
                case "showToolbar" when p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False: ShowToolbar = p.Value.GetBoolean(); break;
                case "toolbarLabels" when p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False: ToolbarLabels = p.Value.GetBoolean(); break;
                case "toolbarSmall" when p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False: ToolbarSmall = p.Value.GetBoolean(); break;
                case "zenToolbar" when p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False: ZenToolbar = p.Value.GetBoolean(); break;
                case "toolbarGroups" when p.Value.ValueKind == JsonValueKind.String: ToolbarGroups = p.Value.GetString() ?? DefaultToolbarGroups; break;
                case "layout" when p.Value.ValueKind == JsonValueKind.Object && p.Value.GetRawText().Length <= 8_000:
                    Layout = System.Text.Json.Nodes.JsonNode.Parse(p.Value.GetRawText()) as System.Text.Json.Nodes.JsonObject; break;
                case "layouts" when p.Value.ValueKind == JsonValueKind.Array && p.Value.GetArrayLength() <= 40 && p.Value.GetRawText().Length <= 200_000:
                    Layouts = System.Text.Json.Nodes.JsonNode.Parse(p.Value.GetRawText()) as System.Text.Json.Nodes.JsonArray; break;
                case "layoutName" when p.Value.ValueKind is JsonValueKind.String or JsonValueKind.Null:
                    LayoutName = p.Value.ValueKind == JsonValueKind.Null ? null : p.Value.GetString() is { Length: <= 120 } n ? n : LayoutName; break;
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
        // Known ids only, each once; an id from a module a later build dropped is simply ignored. Empty is allowed (all hidden).
        ToolbarGroups = string.Join(',', (ToolbarGroups ?? DefaultToolbarGroups).Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Where(ToolbarGroupIds.Contains).Distinct().Take(ToolbarGroupIds.Length));
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

/// <summary>A Vault NoorMD has opened, with its per-Vault options (kept here, not inside the Vault).</summary>
public sealed class VaultInfo
{
    public string Path { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTime OpenedUtc { get; set; }
    /// <summary>Folder (Vault-relative) for pictures and sketches added to notes.</summary>
    public string Attachments { get; set; } = "attachments";
    /// <summary>Extra folder names to leave out of the explorer and search (dot-folders are always left out).</summary>
    public List<string> Excluded { get; set; } = [];

    public void Normalize()
    {
        Excluded = (Excluded ?? []).Where(x => !string.IsNullOrWhiteSpace(x) && x.Length <= 120 && Vaults.VaultPaths.NameProblem(x.Trim()) == null).Select(x => x.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Take(50).ToList();
        Attachments = string.IsNullOrWhiteSpace(Attachments) || Attachments.Split('/', '\\').Any(seg => Vaults.VaultPaths.NameProblem(seg) != null) ? "attachments" : Attachments.Replace('\\', '/').Trim('/');
    }
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
    public List<VaultInfo> Vaults { get; set; } = [];
    /// <summary>The Vault the main window had open (reopened on start when the session is restored).</summary>
    public string? LastVault { get; set; }

    public const int MaxVaults = 12;

    public VaultInfo TouchVault(string path)
    {
        var full = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(path));
        var info = Vaults.FirstOrDefault(v => string.Equals(v.Path, full, StringComparison.OrdinalIgnoreCase)) ?? new VaultInfo { Path = full };
        Vaults.Remove(info);
        info.Name = System.IO.Path.GetFileName(full);
        info.OpenedUtc = DateTime.UtcNow;
        info.Normalize();
        Vaults.Insert(0, info);
        if (Vaults.Count > MaxVaults) Vaults.RemoveRange(MaxVaults, Vaults.Count - MaxVaults);
        return info;
    }

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
            settings.Vaults ??= [];
            settings.Vaults.RemoveAll(v => v == null || string.IsNullOrWhiteSpace(v.Path) || !System.IO.Path.IsPathFullyQualified(v.Path));
            settings.Vaults.ForEach(v => v.Normalize());
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
