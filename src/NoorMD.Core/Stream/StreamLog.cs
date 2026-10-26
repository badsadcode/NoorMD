using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace NoorMD.Core.Stream;

public sealed record TrackMark(double Offset, string Text);

/// <summary>One stream, as written to a note in the Vault's stream folder.</summary>
public sealed record StreamEntry
{
    public string Title { get; init; } = "";
    public DateOnly Date { get; init; }
    public int? Number { get; init; }
    public string Description { get; init; } = "";
    public IReadOnlyList<string> Keywords { get; init; } = [];
    /// <summary>Path of the thumbnail relative to the note (e.g. "../attachments/thumb.png").</summary>
    public string? Thumbnail { get; init; }
    public string? Url { get; init; }
    public IReadOnlyList<TrackMark> Tracklist { get; init; } = [];
    public string Notes { get; init; } = "";
    /// <summary>Path of the note relative to the Vault root (set when read from disk).</summary>
    public string? Path { get; init; }
}

/// <summary>
/// The local stream history: one Markdown note per stream with YAML front matter (title, date, number, keywords,
/// thumbnail, url) and readable sections (description, tracklist, notes). Templates fill titles and descriptions.
/// NoorMD never publishes anything: titles and descriptions are copied for the user to paste.
/// </summary>
public static class StreamLog
{
    private static readonly Regex Placeholder = new(@"\{(\w+)(?::([^}]+))?\}", RegexOptions.CultureInvariant);

    /// <summary>Fills {name} and {date:format} placeholders. Unknown placeholders stay as they are, so typos are visible.</summary>
    public static string Fill(string template, IReadOnlyDictionary<string, string?> values, DateOnly date)
    {
        return Placeholder.Replace(template ?? "", m =>
        {
            var key = m.Groups[1].Value.ToLowerInvariant();
            if (key == "date")
            {
                var fmt = m.Groups[2].Success ? m.Groups[2].Value : "yyyy-MM-dd";
                try { return date.ToString(fmt, CultureInfo.CurrentCulture); } catch (FormatException) { return m.Value; }
            }
            return values.TryGetValue(key, out var v) ? v ?? "" : m.Value;
        });
    }

    public static string Stamp(double seconds)
    {
        var t = TimeSpan.FromSeconds(Math.Max(0, Math.Floor(seconds)));
        return $"{(int)t.TotalHours:00}:{t.Minutes:00}:{t.Seconds:00}";
    }

    /// <summary>
    /// The tracklist as YouTube-style chapters ("00:00 Title"). YouTube needs the first at 00:00 and ≥ 10 s each, so
    /// tracks shorter than 10 s are dropped and the first is moved to 0.
    /// </summary>
    public static string Chapters(IReadOnlyList<TrackMark> marks)
    {
        var list = new List<TrackMark>();
        foreach (var m in marks.OrderBy(x => x.Offset))
        {
            if (list.Count > 0 && m.Offset - list[^1].Offset < 10) list[^1] = list[^1] with { Text = m.Text };
            else list.Add(m);
        }
        if (list.Count > 0) list[0] = list[0] with { Offset = 0 };
        var hours = list.Count > 0 && list[^1].Offset >= 3600;
        return string.Join("\n", list.Select(m =>
        {
            var t = TimeSpan.FromSeconds(Math.Floor(m.Offset));
            return (hours ? $"{(int)t.TotalHours}:{t.Minutes:00}:{t.Seconds:00}" : $"{(int)t.TotalMinutes:00}:{t.Seconds:00}") + " " + m.Text;
        }));
    }

    public static string Serialize(StreamEntry e)
    {
        var sb = new StringBuilder("---\n");
        sb.Append("title: ").Append(Yaml(e.Title)).Append('\n');
        sb.Append("date: ").Append(e.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).Append('\n');
        if (e.Number is int n) sb.Append("stream: ").Append(n.ToString(CultureInfo.InvariantCulture)).Append('\n');
        if (e.Keywords.Count > 0) sb.Append("keywords: [").Append(string.Join(", ", e.Keywords.Select(Yaml))).Append("]\n");
        if (!string.IsNullOrWhiteSpace(e.Thumbnail)) sb.Append("thumbnail: ").Append(Yaml(e.Thumbnail!)).Append('\n');
        if (!string.IsNullOrWhiteSpace(e.Url)) sb.Append("url: ").Append(Yaml(e.Url!)).Append('\n');
        sb.Append("noormd: stream\n---\n\n# ").Append(e.Title.Length > 0 ? e.Title : "Stream " + e.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).Append("\n\n");
        if (!string.IsNullOrWhiteSpace(e.Thumbnail)) sb.Append("![Thumbnail](").Append(LinkTarget(e.Thumbnail!)).Append(")\n\n");
        sb.Append("## Description\n\n").Append(e.Description.Trim()).Append("\n\n");
        if (e.Keywords.Count > 0) sb.Append("## Keywords\n\n").Append(string.Join(", ", e.Keywords)).Append("\n\n");
        if (e.Tracklist.Count > 0)
        {
            sb.Append("## Tracklist\n\n");
            foreach (var t in e.Tracklist) sb.Append("- ").Append(Stamp(t.Offset)).Append(' ').Append(t.Text.Replace("\n", " ")).Append('\n');
            sb.Append('\n');
        }
        sb.Append("## Notes\n\n").Append(e.Notes.Trim()).Append('\n');
        return sb.ToString();
    }

    private static string LinkTarget(string path) => path.Contains(' ') ? "<" + path + ">" : path;

    private static string Yaml(string s) =>
        s.Length > 0 && !Regex.IsMatch(s, @"[:#\[\]{},""'&*!|>%@`]|^\s|\s$|^(true|false|null|yes|no|~)$|^[-?\d]", RegexOptions.IgnoreCase)
            ? s : "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n") + "\"";

    /// <summary>Reads a stream note back. Front matter wins for the fields it has; sections fill the rest.</summary>
    public static StreamEntry? Parse(string markdown, string? path = null)
    {
        var text = markdown.Replace("\r\n", "\n");
        var fm = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var body = text;
        if (text.StartsWith("---\n", StringComparison.Ordinal))
        {
            var end = text.IndexOf("\n---", 4, StringComparison.Ordinal);
            if (end > 0)
            {
                foreach (var line in text[4..end].Split('\n'))
                {
                    var i = line.IndexOf(':');
                    if (i > 0) fm[line[..i].Trim()] = line[(i + 1)..].Trim();
                }
                body = text[(end + 4)..];
            }
        }
        if (!fm.TryGetValue("noormd", out var kind) || kind != "stream") return null;
        string Section(string name)
        {
            var m = Regex.Match(body, $@"^## {Regex.Escape(name)}\s*\n(.*?)(?=^## |\z)", RegexOptions.Multiline | RegexOptions.Singleline);
            return m.Success ? m.Groups[1].Value.Trim() : "";
        }
        var tracks = new List<TrackMark>();
        foreach (var line in Section("Tracklist").Split('\n'))
        {
            var m = Regex.Match(line.Trim(), @"^-\s*(\d+):(\d\d):(\d\d)\s+(.*)$");
            if (m.Success) tracks.Add(new TrackMark(int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) * 3600 + int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture) * 60 + int.Parse(m.Groups[3].Value, CultureInfo.InvariantCulture), m.Groups[4].Value));
        }
        return new StreamEntry
        {
            Title = Unyaml(fm.GetValueOrDefault("title")) ?? "",
            Date = DateOnly.TryParseExact(fm.GetValueOrDefault("date"), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : DateOnly.MinValue,
            Number = int.TryParse(fm.GetValueOrDefault("stream"), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : null,
            Keywords = ParseList(fm.GetValueOrDefault("keywords")),
            Thumbnail = Unyaml(fm.GetValueOrDefault("thumbnail")),
            Url = Unyaml(fm.GetValueOrDefault("url")),
            Description = Section("Description"),
            Tracklist = tracks,
            Notes = Section("Notes"),
            Path = path,
        };
    }

    private static string? Unyaml(string? s)
    {
        if (string.IsNullOrEmpty(s)) return null;
        if (s.Length >= 2 && s[0] == '"' && s[^1] == '"') return Regex.Unescape(s[1..^1]);
        if (s.Length >= 2 && s[0] == '\'' && s[^1] == '\'') return s[1..^1].Replace("''", "'");
        return s;
    }

    private static IReadOnlyList<string> ParseList(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return [];
        s = s.Trim();
        if (s.StartsWith('[') && s.EndsWith(']')) s = s[1..^1];
        var items = new List<string>();
        foreach (Match m in Regex.Matches(s, @"\s*(?:""((?:[^""\\]|\\.)*)""|'([^']*)'|([^,]+))"))
        {
            var v = m.Groups[1].Success ? Regex.Unescape(m.Groups[1].Value) : m.Groups[2].Success ? m.Groups[2].Value : m.Groups[3].Value.Trim();
            if (v.Length > 0) items.Add(v);
        }
        return items;
    }

    /// <summary>Splits keywords typed as "a, b; c" or one per line; trims, removes duplicates, keeps order.</summary>
    public static IReadOnlyList<string> Keywords(string? text) =>
        (text ?? "").Split([',', ';', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(k => k.TrimStart('#')).Where(k => k.Length > 0).Distinct(StringComparer.CurrentCultureIgnoreCase).ToList();

    /// <summary>File name for a stream note: "2026-10-26 Stream 12 – Title.md", safe for Windows.</summary>
    public static string FileName(StreamEntry e)
    {
        var raw = $"{e.Date:yyyy-MM-dd} {(e.Number is int n ? $"#{n} " : "")}{e.Title}".Trim();
        var clean = new string(raw.Select(c => "<>:\"/\\|?*".Contains(c) || char.IsControl(c) ? '-' : c).ToArray()).Trim(' ', '.');
        if (clean.Length > 120) clean = clean[..120].TrimEnd(' ', '.');
        return clean + ".md";
    }
}
