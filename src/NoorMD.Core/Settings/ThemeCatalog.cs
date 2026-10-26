namespace NoorMD.Core.Settings;

/// <summary>Key colours of a theme, used for the native window chrome and WPF dialogs.</summary>
public sealed record ThemeInfo(string Id, string Label, bool IsDark, string Bg, string Panel, string Surface, string Surface2,
    string Border, string Text, string Muted, string Accent, string OnAccent);

/// <summary>
/// The themes NoorMD ships. The full palettes live in wwwroot/css/themes.css; this mirror must match it
/// (enforced by ThemeCatalogTests, which parses the CSS).
/// </summary>
public static class ThemeCatalog
{
    public static readonly IReadOnlyList<ThemeInfo> All =
    [
        new("dark", "Atelier Dark", true, "#0b0d12", "#11151d", "#181e29", "#212837", "#2a3240", "#e9edf5", "#8996aa", "#b19aff", "#211835"),
        new("light", "Atelier Light", false, "#f3f5f9", "#ffffff", "#f7f8fb", "#e9edf4", "#dae0e9", "#202838", "#5f6b80", "#6a4ed0", "#ffffff"),
        new("nocturne", "Nocturne", true, "#070b14", "#0c1220", "#121a2c", "#1a2438", "#223049", "#e4ecf7", "#8a9bb5", "#5fd4e6", "#04161b"),
        new("ember", "Ember", true, "#0f0c0a", "#16120f", "#201a15", "#2a221b", "#3a2f25", "#f2e9e1", "#a8978a", "#f2a65a", "#241404"),
        new("evergreen", "Evergreen", true, "#080f0c", "#0d1612", "#14201a", "#1b2a22", "#26382e", "#e3efe8", "#8ea89a", "#6fd6a0", "#05180e"),
        new("rosewood", "Rosewood", true, "#120a0f", "#191017", "#23171f", "#2e1f29", "#3d2a37", "#f3e6ee", "#ae94a5", "#f08bb4", "#2a0b19"),
        new("parchment", "Parchment", false, "#f1eadd", "#fbf7ef", "#f5efe3", "#ebe2d1", "#ddd1bc", "#2c241b", "#6b5d4c", "#9a4a1c", "#ffffff"),
        new("glacier", "Glacier", false, "#eef3f8", "#ffffff", "#f5f8fb", "#e4ecf4", "#d3dee9", "#15233a", "#526581", "#1f63c6", "#ffffff"),
        new("contrast", "High Contrast", true, "#000000", "#000000", "#0d0d0d", "#1a1a1a", "#8c8c8c", "#ffffff", "#d0d0d0", "#ffd84a", "#000000"),
    ];

    public static ThemeInfo Get(string? id) => All.FirstOrDefault(t => t.Id == id) ?? All[0];
    public static bool Exists(string? id) => All.Any(t => t.Id == id);
}
