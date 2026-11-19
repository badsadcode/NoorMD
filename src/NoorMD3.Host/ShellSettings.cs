using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD3.Host;

/// <summary>The shell's own settings (3.0 keeps them apart from 2.0's): the look, which benches are open, the layout.</summary>
public sealed class ShellSettings
{
    public static readonly string[] Themes = ["dark", "light", "nocturne", "ember", "evergreen", "rosewood", "parchment", "glacier", "contrast"];

    public string Theme { get; set; } = "dark";
    /// <summary><c>title</c> (the main menu in the title bar) or <c>row</c> (its own row under it).</summary>
    public string MenuPosition { get; set; } = "title";
    /// <summary>Bench id → <c>roomy</c> / <c>compact</c>, when the user chose other than the bench's own.</summary>
    public Dictionary<string, string> Density { get; set; } = [];
    /// <summary>The open benches, in tab order, and the one in front: the session that comes back.</summary>
    public List<string> OpenBenches { get; set; } = [];
    public string? ActiveBench { get; set; }
    /// <summary>Bench id → its layout (side widths, hidden panels…), kept as the page wrote it.</summary>
    public Dictionary<string, JsonElement> Layouts { get; set; } = [];
    /// <summary>True once Home has been shown at the first start.</summary>
    public bool Welcomed { get; set; }

    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    /// <summary>The settings, put right where they can't be used (an unknown theme, a bench id that isn't one).</summary>
    public ShellSettings Checked()
    {
        if (!Themes.Contains(Theme)) Theme = "dark";
        if (MenuPosition is not ("title" or "row")) MenuPosition = "title";
        Density = (Density ?? []).Where(kv => BenchIds.IsValid(kv.Key) && kv.Value is "roomy" or "compact").ToDictionary(kv => kv.Key, kv => kv.Value);
        OpenBenches = (OpenBenches ?? []).Where(BenchIds.IsValid).Distinct().Take(64).ToList();
        if (ActiveBench != null && !BenchIds.IsValid(ActiveBench) && ActiveBench != "home") ActiveBench = null;
        Layouts = (Layouts ?? []).Where(kv => BenchIds.IsValid(kv.Key) && kv.Value.ValueKind == JsonValueKind.Object && kv.Value.GetRawText().Length < 64_000).ToDictionary(kv => kv.Key, kv => kv.Value.Clone());
        return this;
    }

    public static ShellSettings Load(string path)
    {
        try
        {
            if (File.Exists(path)) return (JsonSerializer.Deserialize<ShellSettings>(File.ReadAllText(path), Json) ?? new()).Checked();
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException)
        {
            // A damaged settings file is set aside, not lost: the app starts with defaults.
            try { File.Copy(path, path + ".broken", overwrite: true); } catch (IOException) { }
        }
        return new ShellSettings().Checked();
    }

    /// <summary>Saved through a temporary file, so a crash mid-write never leaves half a file.</summary>
    public void Save(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(this, Json));
        File.Move(tmp, path, overwrite: true);
    }

    public JsonElement ToJson() => JsonSerializer.SerializeToElement(this, Json);
    public static ShellSettings FromJson(JsonElement e) => (e.Deserialize<ShellSettings>(Json) ?? new()).Checked();
}

public static class BenchIds
{
    /// <summary>Lower case letters, digits and dots, starting with a letter: <c>noor.markdown</c>.</summary>
    public static bool IsValid(string? id) => id is { Length: > 0 and <= 64 } && char.IsAsciiLetterLower(id[0]) && id.All(c => char.IsAsciiLetterLower(c) || char.IsAsciiDigit(c) || c == '.') && !id.EndsWith('.') && !id.Contains("..");
}
