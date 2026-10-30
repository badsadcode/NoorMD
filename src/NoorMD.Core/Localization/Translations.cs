using System.Text.Json;
using System.Text.RegularExpressions;

namespace NoorMD.Core.Localization;

/// <summary>
/// NoorMD in other languages. English is the key: a language is a JSON object of English text → its translation
/// (with "_language" naming it). Built-in ones ship in wwwroot/lang; your own (or your corrections) go in the
/// Translations folder and win over the built-in ones line by line. A missing or empty line stays English.
/// </summary>
public static partial class Translations
{
    public const long MaxFileBytes = 8 * 1024 * 1024;

    [GeneratedRegex("^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$")]
    private static partial Regex CodeRegex();

    /// <summary>A language's code as a file is named (pl, de, pt-BR …); English is "en".</summary>
    public static bool IsCode(string? code) => code != null && CodeRegex().IsMatch(code);

    /// <summary>A language file's lines (English → translation); what isn't a string, or is empty, is left out.</summary>
    public static Dictionary<string, string> Read(string path)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!File.Exists(path) || new FileInfo(path).Length > MaxFileBytes) return map;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllBytes(path), new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip });
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return map;
            foreach (var p in doc.RootElement.EnumerateObject())
                if (p.Value.ValueKind == JsonValueKind.String && p.Value.GetString() is { Length: > 0 } v && p.Name.Length <= 2000 && v.Length <= 4000) map[p.Name] = v;
        }
        catch (JsonException) { /* a broken file: no lines from it */ }
        return map;
    }

    /// <summary>A language: the built-in lines, with your own over them.</summary>
    public static Dictionary<string, string> Load(string code, string builtInDir, string userDir)
    {
        if (!IsCode(code) || code == "en") return new(StringComparer.Ordinal);
        var map = Read(Path.Combine(builtInDir, code + ".json"));
        foreach (var (k, v) in Read(Path.Combine(userDir, code + ".json"))) map[k] = v;
        return map;
    }

    public sealed record Language(string Code, string Name, bool BuiltIn, bool Yours, int Done, int Total);

    /// <summary>The languages there are: English, the built-in ones and your own, with how much of each is translated.</summary>
    public static List<Language> List(string builtInDir, string userDir)
    {
        var keys = Keys(builtInDir);
        var codes = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var dir in new[] { builtInDir, userDir })
            if (Directory.Exists(dir))
                foreach (var f in Directory.EnumerateFiles(dir, "*.json"))
                    if (Path.GetFileNameWithoutExtension(f) is var c && IsCode(c) && c != "en") codes.Add(c);
        var list = new List<Language> { new("en", "English", true, false, keys.Count, keys.Count) };
        foreach (var c in codes)
        {
            var lines = Load(c, builtInDir, userDir);
            var name = lines.TryGetValue("_language", out var n) ? n : c;
            list.Add(new(c, name, File.Exists(Path.Combine(builtInDir, c + ".json")), File.Exists(Path.Combine(userDir, c + ".json")), keys.Count(lines.ContainsKey), keys.Count));
        }
        return list;
    }

    /// <summary>Every English text NoorMD shows (from en.json, which scripts/i18n-extract.js writes).</summary>
    public static List<string> Keys(string builtInDir)
    {
        var path = Path.Combine(builtInDir, "en.json");
        if (!File.Exists(path)) return [];
        using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        return doc.RootElement.EnumerateObject().Select(p => p.Name).Where(k => !k.StartsWith('_')).ToList();
    }

    /// <summary>
    /// A file to translate: every English text with its translation so far (empty where there is none), the
    /// language's name first. Fill it in and put it in the Translations folder as its code (pl.json, it.json …).
    /// </summary>
    public static string Template(string code, string name, IEnumerable<string> keys, IReadOnlyDictionary<string, string> done)
    {
        var o = new System.Text.Json.Nodes.JsonObject
        {
            ["_language"] = done.TryGetValue("_language", out var n) ? n : name,
            ["_code"] = code,
            ["_note"] = "English → your language. Leave a line empty to keep it English. {0}, {1} … stand for numbers and names and may move. Put this file in NoorMD's Translations folder named as the language's code (for example it.json) and choose the language in Preferences.",
        };
        foreach (var k in keys) o[k] = done.TryGetValue(k, out var v) ? v : "";
        return o.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
    }
}

/// <summary>The app's own words (its windows and dialogs) in the language chosen when NoorMD started.</summary>
public static class Tr
{
    private static Dictionary<string, string> _lines = new(StringComparer.Ordinal);
    public static void Use(Dictionary<string, string> lines) => _lines = lines;
    public static string T(string en) => _lines.TryGetValue(en, out var t) ? t : en;
    /// <summary>A text with values in it ("{0} pictures"): the translation, then the values put in.</summary>
    public static string T(string en, params object?[] args) => string.Format(System.Globalization.CultureInfo.CurrentCulture, T(en), args);
}
