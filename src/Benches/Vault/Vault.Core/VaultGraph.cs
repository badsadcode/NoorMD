using System.Text.RegularExpressions;

namespace Vault.Core;

/// <summary>A note in the map: its path, how many links touch it, its tags.</summary>
public sealed record GraphNode(string Path, string Name, int Links, IReadOnlyList<string> Tags, bool Missing = false);
/// <summary>The vault as a map: notes and the links between them (each pair once, whichever way it points).</summary>
public sealed record VaultGraph(IReadOnlyList<GraphNode> Nodes, IReadOnlyList<(string From, string To)> Edges);
/// <summary>A heading inside a note (for [[Note#Heading]] links).</summary>
public sealed record NoteHeading(int Level, string Text, int Line);

/// <summary>What a vault's notes say about each other: links (with aliases), the map, headings, front matter.</summary>
public static partial class VaultNotes
{
    /// <summary>The front matter at the top of a note (between --- lines), as key → values. Lists can be [a, b] or
    /// "- a" lines; quotes are taken off.</summary>
    public static Dictionary<string, List<string>> FrontMatter(string text)
    {
        var result = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        if (!text.StartsWith("---\n", StringComparison.Ordinal) && !text.StartsWith("---\r\n", StringComparison.Ordinal)) return result;
        var lines = text.Replace("\r\n", "\n").Split('\n');
        string? listKey = null;
        for (int i = 1; i < lines.Length && i < 400; i++)
        {
            var line = lines[i];
            if (line.Trim() == "---") break;
            var item = ListItem().Match(line);
            if (item.Success && listKey != null) { Add(result, listKey, Unquote(item.Groups[1].Value)); continue; }
            var kv = KeyValue().Match(line);
            if (!kv.Success) { listKey = null; continue; }
            var key = kv.Groups[1].Value; var value = kv.Groups[2].Value.Trim();
            if (!result.ContainsKey(key)) result[key] = [];
            if (value.Length == 0) { listKey = key; continue; }
            listKey = null;
            if (value.StartsWith('[') && value.EndsWith(']'))
                foreach (var part in value[1..^1].Split(',')) Add(result, key, Unquote(part));
            else Add(result, key, Unquote(value));
        }
        return result;
    }
    static void Add(Dictionary<string, List<string>> d, string key, string value) { if (value.Length == 0) return; if (!d.TryGetValue(key, out var l)) d[key] = l = []; l.Add(value); }
    static string Unquote(string s) { s = s.Trim(); return s.Length >= 2 && (s[0] == '"' && s[^1] == '"' || s[0] == '\'' && s[^1] == '\'') ? s[1..^1] : s; }
    [GeneratedRegex(@"^\s*-\s+(.+?)\s*$")] private static partial Regex ListItem();
    [GeneratedRegex(@"^([A-Za-z][\w -]*?)\s*:\s*(.*)$")] private static partial Regex KeyValue();

    /// <summary>A note's other names (front matter "aliases:" or "alias:").</summary>
    public static IReadOnlyList<string> Aliases(string text)
    {
        var fm = FrontMatter(text);
        var list = new List<string>();
        if (fm.TryGetValue("aliases", out var a)) list.AddRange(a);
        if (fm.TryGetValue("alias", out var b)) list.AddRange(b);
        return list.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>ATX headings (# …) outside code blocks and front matter.</summary>
    public static IReadOnlyList<NoteHeading> Headings(string text)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var output = new List<NoteHeading>();
        int start = 0;
        if (lines.Length > 0 && lines[0] == "---") { var end = Array.IndexOf(lines, "---", 1); if (end > 0) start = end + 1; }
        string? fence = null;
        for (int i = start; i < lines.Length; i++)
        {
            var t = lines[i].TrimStart();
            if (t.StartsWith("```", StringComparison.Ordinal) || t.StartsWith("~~~", StringComparison.Ordinal)) { var f = t[..3]; fence = fence == null ? f : fence == f ? null : fence; continue; }
            if (fence != null) continue;
            var m = Heading().Match(lines[i]);
            if (m.Success) output.Add(new NoteHeading(m.Groups[1].Value.Length, m.Groups[2].Value.Trim(), i + 1));
        }
        return output;
    }
    [GeneratedRegex(@"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$")] private static partial Regex Heading();

    /// <summary>Every alias in the vault → the note it names (first one wins when two notes share an alias).</summary>
    public static Dictionary<string, string> AliasMap(VaultIndex index)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in index.NotePaths().OrderBy(p => p, StringComparer.OrdinalIgnoreCase))
            foreach (var a in Aliases(index.TextOf(p) ?? "")) map.TryAdd(a, p);
        return map;
    }

    /// <summary>Where a link leads: by name or path (as always), else by alias.</summary>
    public static string? Resolve(string fromNote, VaultLink link, IReadOnlyCollection<string> notes, IReadOnlyDictionary<string, string>? aliases)
    {
        var r = VaultLinks.Resolve(fromNote, link, notes);
        if (r != null || !link.Wiki || aliases == null) return r;
        return aliases.TryGetValue(link.Target.Trim(), out var p) ? p : null;
    }

    /// <summary>The vault as a map. Links to notes that don't exist yet appear as "missing" notes (to make later).</summary>
    public static VaultGraph Graph(VaultIndex index, bool includeMissing = true, int maxNodes = 4000)
    {
        var notes = index.NotePaths();
        var aliases = AliasMap(index);
        var edges = new HashSet<(string, string)>();
        var missing = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var n in notes)
        {
            var text = WithoutCode(index.TextOf(n) ?? "");
            foreach (var link in VaultLinks.Extract(text))
            {
                var to = Resolve(n, link, notes, aliases);
                if (to == null)
                {
                    if (!includeMissing || !link.Wiki) continue;
                    var name = link.Target.Replace('\\', '/').Trim('/');
                    if (name.Length == 0 || name.Contains("://")) continue;
                    to = "?" + name;   // a note to make
                    missing.Add(to);
                }
                if (string.Equals(to, n, StringComparison.OrdinalIgnoreCase)) continue;
                var pair = string.CompareOrdinal(n, to) < 0 ? (n, to) : (to, n);
                edges.Add(pair);
            }
        }
        var degree = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var (a, b) in edges) { degree[a] = degree.GetValueOrDefault(a) + 1; degree[b] = degree.GetValueOrDefault(b) + 1; }
        var nodes = notes.Select(p => new GraphNode(p, Path.GetFileNameWithoutExtension(p), degree.GetValueOrDefault(p), index.TagsOf(p)))
            .Concat(missing.Select(m => new GraphNode(m, m[1..].Split('/').Last(), degree.GetValueOrDefault(m), [], Missing: true)))
            .OrderByDescending(n => n.Links).Take(maxNodes).ToList();
        var kept = new HashSet<string>(nodes.Select(n => n.Path), StringComparer.OrdinalIgnoreCase);
        return new VaultGraph(nodes, edges.Where(e => kept.Contains(e.Item1) && kept.Contains(e.Item2)).ToList());
    }

    /// <summary>The notes around one: those it links to and those linking to it, <paramref name="depth"/> steps out.</summary>
    public static VaultGraph Around(VaultGraph all, string center, int depth)
    {
        var keep = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { center };
        var frontier = new HashSet<string>(keep, StringComparer.OrdinalIgnoreCase);
        for (int d = 0; d < Math.Clamp(depth, 1, 3); d++)
        {
            var next = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (a, b) in all.Edges)
            {
                if (frontier.Contains(a) && keep.Add(b)) next.Add(b);
                if (frontier.Contains(b) && keep.Add(a)) next.Add(a);
            }
            frontier = next;
        }
        return new VaultGraph(all.Nodes.Where(n => keep.Contains(n.Path)).ToList(), all.Edges.Where(e => keep.Contains(e.From) && keep.Contains(e.To)).ToList());
    }

    /// <summary>The text with code blocks and `code spans` blanked out (lines kept), so links shown as examples in code
    /// don't count as links.</summary>
    public static string WithoutCode(string text)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        string? fence = null;
        for (int i = 0; i < lines.Length; i++)
        {
            var t = lines[i].TrimStart();
            if (t.StartsWith("```", StringComparison.Ordinal) || t.StartsWith("~~~", StringComparison.Ordinal)) { var f = t[..3]; fence = fence == null ? f : fence == f ? null : fence; lines[i] = ""; continue; }
            if (fence != null) { lines[i] = ""; continue; }
            if (lines[i].Contains('`')) lines[i] = CodeSpan().Replace(lines[i], m => new string(' ', m.Length));
        }
        return string.Join('\n', lines);
    }
    [GeneratedRegex(@"(`+)[^`]*?\1")] private static partial Regex CodeSpan();

    /// <summary>Fills a template's blanks: {{title}}, {{date}}, {{time}}, {{date:yyyy-MM-dd}}.</summary>
    public static string FillTemplate(string template, string title, DateTime now) =>
        DateBlank().Replace(template.Replace("{{title}}", title).Replace("{{date}}", now.ToString("yyyy-MM-dd")).Replace("{{time}}", now.ToString("HH:mm")),
            m => { try { return now.ToString(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture); } catch (FormatException) { return m.Value; } });
    [GeneratedRegex(@"\{\{date:([^}]{1,40})\}\}")] private static partial Regex DateBlank();
}
