using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace NoorMD.Core.Stream;

/// <summary>A supporter. <see cref="Until"/> is set when they stopped supporting; they stay in the list as history.</summary>
public sealed record Supporter(string Name, string? Channel = null, string? Tier = null, DateOnly? Since = null, DateOnly? Until = null, string? Note = null)
{
    public bool Active => Until == null;
}

/// <summary>
/// The supporters list, kept as an ordinary Markdown note (a table) in the Vault, so it is readable and editable
/// anywhere. Parsing keeps any text around the table; writing replaces only the table.
/// </summary>
public static class SupportersFile
{
    public const string Header = "| Name | Channel | Tier | Since | Until | Note |";
    private const string Rule = "|---|---|---|---|---|---|";

    public static string Template =>
        "---\nnoormd: supporters\n---\n# Supporters\n\nThe people who keep the streams going. NoorMD's credits roll shows everyone without an *Until* date.\n\n" + Header + "\n" + Rule + "\n";

    /// <summary>Only http(s) links are kept as channel links (overlays render them as text, never as clickable script).</summary>
    public static string? CleanLink(string? s)
    {
        s = s?.Trim();
        if (string.IsNullOrEmpty(s)) return null;
        if (!s.Contains("://", StringComparison.Ordinal) && Regex.IsMatch(s, @"^(www\.|youtube\.com/|youtu\.be/|twitch\.tv/|m\.youtube\.com/)", RegexOptions.IgnoreCase)) s = "https://" + s;
        if (s.StartsWith('@') && s.Length > 1 && !s.Contains(' ')) return "https://www.youtube.com/" + s;
        return Uri.TryCreate(s, UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp) ? u.ToString() : null;
    }

    public static IReadOnlyList<Supporter> Parse(string markdown)
    {
        var list = new List<Supporter>();
        var (start, end) = FindTable(markdown.Replace("\r\n", "\n").Split('\n'));
        if (start < 0) return list;
        var lines = markdown.Replace("\r\n", "\n").Split('\n');
        for (var i = start + 2; i < end; i++)
        {
            var cells = Cells(lines[i]);
            if (cells.Count == 0 || string.IsNullOrWhiteSpace(cells[0])) continue;
            string? C(int k) => k < cells.Count && !string.IsNullOrWhiteSpace(cells[k]) ? cells[k].Trim() : null;
            list.Add(new Supporter(cells[0].Trim(), CleanLink(StripLink(C(1))), C(2), Date(C(3)), Date(C(4)), C(5)));
        }
        return list;
    }

    /// <summary>Writes the list into the note: replaces the existing table, or appends one when there is none.</summary>
    public static string Write(string? markdown, IEnumerable<Supporter> supporters)
    {
        var sb = new StringBuilder();
        sb.Append(Header).Append('\n').Append(Rule).Append('\n');
        foreach (var s in supporters)
            sb.Append("| ").Append(Esc(s.Name)).Append(" | ").Append(Esc(s.Channel)).Append(" | ").Append(Esc(s.Tier)).Append(" | ")
              .Append(s.Since?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "").Append(" | ")
              .Append(s.Until?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "").Append(" | ").Append(Esc(s.Note)).Append(" |\n");
        var table = sb.ToString().TrimEnd('\n');
        if (string.IsNullOrWhiteSpace(markdown)) return Template.Replace(Header + "\n" + Rule + "\n", table + "\n");
        var crlf = markdown.Contains("\r\n", StringComparison.Ordinal);
        var lines = markdown.Replace("\r\n", "\n").Split('\n').ToList();
        var (start, end) = FindTable(lines.ToArray());
        string result;
        if (start < 0) result = markdown.Replace("\r\n", "\n").TrimEnd('\n') + "\n\n" + table + "\n";
        else
        {
            lines.RemoveRange(start, end - start);
            lines.Insert(start, table);
            result = string.Join('\n', lines);
        }
        return crlf ? result.Replace("\n", "\r\n") : result;
    }

    private static (int Start, int End) FindTable(string[] lines)
    {
        for (var i = 0; i + 1 < lines.Length; i++)
        {
            var c = Cells(lines[i]);
            if (c.Count >= 2 && c[0].Trim().Equals("Name", StringComparison.OrdinalIgnoreCase) && Regex.IsMatch(lines[i + 1].Trim(), @"^\|?\s*:?-{3,}"))
            {
                var end = i + 2;
                while (end < lines.Length && lines[end].TrimStart().StartsWith('|')) end++;
                return (i, end);
            }
        }
        return (-1, -1);
    }

    private static List<string> Cells(string line)
    {
        var t = line.Trim();
        if (!t.StartsWith('|')) return [];
        var cells = new List<string>();
        var cur = new StringBuilder();
        for (var i = 1; i < t.Length; i++)
        {
            if (t[i] == '\\' && i + 1 < t.Length && t[i + 1] == '|') { cur.Append('|'); i++; }
            else if (t[i] == '|') { cells.Add(cur.ToString()); cur.Clear(); }
            else cur.Append(t[i]);
        }
        if (cur.ToString().Trim().Length > 0) cells.Add(cur.ToString());
        return cells;
    }

    private static string Esc(string? s) => (s ?? "").Replace("\r", " ").Replace("\n", " ").Replace("|", "\\|").Trim();
    private static string? StripLink(string? s) => s != null && Regex.Match(s, @"^\[[^\]]*\]\(([^)]+)\)$") is { Success: true } m ? m.Groups[1].Value : s?.Trim('<', '>');

    private static DateOnly? Date(string? s) =>
        DateOnly.TryParseExact(s?.Trim(), ["yyyy-MM-dd", "yyyy-M-d", "dd.MM.yyyy", "d.M.yyyy", "yyyy/MM/dd"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d
        : DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var dt) ? DateOnly.FromDateTime(dt) : null;

    // ------------------------------------------------------------------ import from a pasted export

    private static readonly string[] NameHeads = ["name", "member", "display name", "displayname", "username", "user", "supporter", "patron", "nick", "nickname"];
    private static readonly string[] LinkHeads = ["channel", "link", "url", "profile", "link to profile", "channel url", "youtube", "twitch"];
    private static readonly string[] TierHeads = ["tier", "level", "current level", "membership", "plan", "reward"];
    private static readonly string[] SinceHeads = ["since", "joined", "member since", "start", "start date", "date", "last update"];

    /// <summary>
    /// Reads a pasted export: CSV/TSV/semicolon with or without a header (YouTube members, Patreon, Ko-fi…), or plain
    /// lines like "Name https://youtube.com/@name". Unknown columns are ignored.
    /// </summary>
    public static IReadOnlyList<Supporter> Import(string text)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToList();
        if (lines.Count == 0) return [];
        var sep = new[] { '\t', ';', ',' }.FirstOrDefault(c => lines.Take(5).All(l => l.Contains(c)));
        var result = new List<Supporter>();
        if (sep != default)
        {
            var rows = lines.Select(l => SplitCsv(l, sep)).ToList();
            var head = rows[0].Select(h => h.Trim().ToLowerInvariant()).ToList();
            int Find(string[] names) => head.FindIndex(h => names.Contains(h));
            int n = Find(NameHeads), lk = Find(LinkHeads), t = Find(TierHeads), s = Find(SinceHeads);
            var hasHeader = n >= 0 || lk >= 0;
            if (!hasHeader) { n = 0; lk = -1; }
            foreach (var r in rows.Skip(hasHeader ? 1 : 0))
            {
                string? C(int k) => k >= 0 && k < r.Count && !string.IsNullOrWhiteSpace(r[k]) ? r[k].Trim() : null;
                var link = CleanLink(C(lk)) ?? r.Select(CleanLink).FirstOrDefault(x => x != null);
                var name = C(n < 0 ? 0 : n);
                if (name == null || CleanLink(name) != null && link == CleanLink(name)) name = link != null ? NameFromLink(link) : null;
                if (string.IsNullOrWhiteSpace(name)) continue;
                result.Add(new Supporter(name!, link, C(t), Date(C(s))));
            }
        }
        else
        {
            foreach (var l in lines)
            {
                var m = Regex.Match(l, @"(https?://\S+|@[\w.\-]+)");
                var link = m.Success ? CleanLink(m.Value) : null;
                var name = (m.Success ? l.Remove(m.Index, m.Length) : l).Trim(' ', '-', '–', '—', ':', ',', '|', '\t');
                if (name.Length == 0 && link != null) name = NameFromLink(link);
                if (name.Length > 0) result.Add(new Supporter(name, link));
            }
        }
        return result.GroupBy(x => x.Name.ToLowerInvariant()).Select(g => g.First()).ToList();
    }

    private static string NameFromLink(string link)
    {
        var path = new Uri(link).AbsolutePath.Trim('/');
        var last = path.Split('/').LastOrDefault(x => x.Length > 0) ?? link;
        return Uri.UnescapeDataString(last.TrimStart('@'));
    }

    private static List<string> SplitCsv(string line, char sep)
    {
        var cells = new List<string>();
        var cur = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < line.Length && line[i + 1] == '"') { cur.Append('"'); i++; }
                else if (c == '"') quoted = false;
                else cur.Append(c);
            }
            else if (c == '"') quoted = true;
            else if (c == sep) { cells.Add(cur.ToString()); cur.Clear(); }
            else cur.Append(c);
        }
        cells.Add(cur.ToString());
        return cells;
    }

    /// <summary>The result of merging an import into the list, for a preview before anything is saved.</summary>
    public sealed record MergeResult(IReadOnlyList<Supporter> Merged, IReadOnlyList<string> Added, IReadOnlyList<string> Updated, IReadOnlyList<string> Returned, IReadOnlyList<string> Left);

    /// <summary>
    /// Merges imported supporters (matched by channel link, then by name). New people are added from today; people who
    /// had left and appear again are active again. With <paramref name="markMissingAsLeft"/>, active people missing from
    /// the import get today's date as Until (they stay in the list as history).
    /// </summary>
    public static MergeResult Merge(IReadOnlyList<Supporter> current, IReadOnlyList<Supporter> imported, bool markMissingAsLeft, DateOnly today)
    {
        var merged = current.ToList();
        List<string> added = [], updated = [], returned = [], left = [];
        var seen = new HashSet<int>();
        foreach (var imp in imported)
        {
            var i = merged.FindIndex(s => imp.Channel != null && s.Channel != null && string.Equals(s.Channel.TrimEnd('/'), imp.Channel.TrimEnd('/'), StringComparison.OrdinalIgnoreCase));
            if (i < 0) i = merged.FindIndex(s => string.Equals(s.Name, imp.Name, StringComparison.CurrentCultureIgnoreCase));
            if (i < 0)
            {
                merged.Add(new Supporter(imp.Name, imp.Channel, imp.Tier, imp.Since ?? today));
                seen.Add(merged.Count - 1);
                added.Add(imp.Name);
                continue;
            }
            seen.Add(i);
            var s = merged[i];
            var next = s with { Channel = imp.Channel ?? s.Channel, Tier = imp.Tier ?? s.Tier, Until = null, Since = s.Since ?? imp.Since ?? today };
            if (!s.Active) returned.Add(s.Name);
            else if (next != s) updated.Add(s.Name);
            merged[i] = next;
        }
        if (markMissingAsLeft)
            for (var i = 0; i < merged.Count; i++)
                if (!seen.Contains(i) && merged[i].Active) { merged[i] = merged[i] with { Until = today }; left.Add(merged[i].Name); }
        return new MergeResult(merged, added, updated, returned, left);
    }
}
