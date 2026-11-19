using System.Text.RegularExpressions;

namespace Vault.Core;

/// <summary>A place where a note is named without a link (an "unlinked mention").</summary>
public sealed record Mention(string Source, int Line, int Column, int Length, string Text, string Snippet);
/// <summary>A link going out of a note: where it points (the note, or null when there's none yet).</summary>
public sealed record OutgoingLink(string Target, string? Resolved, int Line);

/// <summary>Searching with operators, unlinked mentions, outgoing links: what a vault's notes say about each other,
/// one step beyond plain links.</summary>
public static partial class VaultQuery
{
    sealed record Term(string Kind, string Value, bool Not);

    /// <summary>Splits a query into terms: words, "exact phrases", tag:x / #x, path:x, file:x, key:value (a property),
    /// and -anything to leave out.</summary>
    static List<Term> Parse(string query)
    {
        var terms = new List<Term>();
        foreach (Match m in Token().Matches(query))
        {
            var t = m.Value;
            var not = t.StartsWith('-') && t.Length > 1;
            if (not) t = t[1..];
            if (t.StartsWith('"')) { var p = t.Trim('"'); if (p.Length > 0) terms.Add(new Term("phrase", TextFold.Fold(p), not)); continue; }
            if (t.StartsWith('#') && t.Length > 1) { terms.Add(new Term("tag", t[1..], not)); continue; }
            var colon = t.IndexOf(':');
            if (colon > 0 && colon < t.Length - 1)
            {
                var key = t[..colon].ToLowerInvariant(); var value = t[(colon + 1)..].Trim('"');
                terms.Add(key switch
                {
                    "tag" => new Term("tag", value.TrimStart('#'), not),
                    "path" => new Term("path", TextFold.Fold(value), not),
                    "file" => new Term("file", TextFold.Fold(value), not),
                    _ => new Term("prop:" + key, TextFold.Fold(value), not),
                });
                continue;
            }
            terms.Add(new Term("word", TextFold.Fold(t), not));
        }
        return terms;
    }
    [GeneratedRegex(@"-?""[^""]*""|-?[^\s""]+(?::""[^""]*"")?")] private static partial Regex Token();

    /// <summary>Notes matching the query (every term must hold; -terms must not). Name matches first, then a hit per
    /// matching line (up to three a note). A query of only filters (tag:, path:…) lists the notes.</summary>
    public static List<VaultSearchHit> Search(VaultIndex index, string query, int limit = 200)
    {
        var terms = Parse(query);
        if (terms.Count == 0) return [];
        var textTerms = terms.Where(t => !t.Not && t.Kind is "word" or "phrase").Select(t => t.Value).ToList();
        var nameHits = new List<VaultSearchHit>();
        var lineHits = new List<VaultSearchHit>();
        foreach (var path in index.NotePaths().OrderBy(p => p, Comparer<string>.Create(VaultScanner.NaturalCompare)))
        {
            var text = index.TextOf(path) ?? "";
            var folded = TextFold.Fold(text);
            var name = Path.GetFileNameWithoutExtension(path);
            var foldedName = TextFold.Fold(name);
            var foldedPath = TextFold.Fold(path);
            Dictionary<string, List<string>>? props = null;
            bool Holds(Term t) => t.Kind switch
            {
                "word" or "phrase" => folded.Contains(t.Value) || foldedName.Contains(t.Value),
                "tag" => index.TagsOf(path).Any(x => VaultTags.Matches(x, t.Value)),
                "path" => foldedPath.Contains(t.Value),
                "file" => foldedName.Contains(t.Value),
                _ => (props ??= VaultNotes.FrontMatter(text)).TryGetValue(t.Kind[5..], out var vals) && vals.Any(v => TextFold.Fold(v).Contains(t.Value)),
            };
            if (!terms.All(t => Holds(t) != t.Not)) continue;
            if (textTerms.Count == 0 || textTerms.All(foldedName.Contains)) { nameHits.Add(new VaultSearchHit(path, name, 0, Path.GetDirectoryName(path)?.Replace('\\', '/') ?? "", true)); continue; }
            var lines = text.Split('\n');
            int shown = 0;
            for (int i = 0; i < lines.Length && shown < 3; i++)
            {
                var fl = TextFold.Fold(lines[i]);
                if (!textTerms.Any(fl.Contains)) continue;
                lineHits.Add(new VaultSearchHit(path, name, i + 1, Snip(lines[i]), false));
                shown++;
            }
            if (shown == 0) lineHits.Add(new VaultSearchHit(path, name, 0, "", false));
            if (nameHits.Count + lineHits.Count >= limit) break;
        }
        return nameHits.Concat(lineHits).Take(limit).ToList();
    }

    static string Snip(string line) { var t = line.Trim(); return t.Length > 160 ? t[..160] + "…" : t; }

    /// <summary>Places where other notes name this one (or one of its aliases) as plain text, outside links and code.
    /// Whole words only; names shorter than 3 letters are skipped (too many false hits).</summary>
    public static List<Mention> UnlinkedMentions(VaultIndex index, string target, int limit = 200)
    {
        var names = new[] { Path.GetFileNameWithoutExtension(target) }.Concat(VaultNotes.Aliases(index.TextOf(target) ?? ""))
            .Where(n => n.Trim().Length >= 3).Distinct(StringComparer.OrdinalIgnoreCase).OrderByDescending(n => n.Length).ToList();
        if (names.Count == 0) return [];
        var pattern = new Regex(@"(?<![\p{L}\p{N}_])(" + string.Join('|', names.Select(Regex.Escape)) + @")(?![\p{L}\p{N}_])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var result = new List<Mention>();
        foreach (var path in index.NotePaths().OrderBy(p => p, Comparer<string>.Create(VaultScanner.NaturalCompare)))
        {
            if (string.Equals(path, target, StringComparison.OrdinalIgnoreCase)) continue;
            var raw = index.TextOf(path) ?? "";
            var masked = MaskLinks(VaultNotes.WithoutCode(raw)).Split('\n');
            var lines = raw.Replace("\r\n", "\n").Split('\n');
            var body = BodyStart(lines);
            for (int i = body; i < masked.Length && i < lines.Length; i++)
            {
                foreach (Match m in pattern.Matches(masked[i]))
                {
                    result.Add(new Mention(path, i + 1, m.Index, m.Length, lines[i].Substring(m.Index, m.Length), Snip(lines[i])));
                    if (result.Count >= limit) return result;
                    break;   // one per line
                }
            }
        }
        return result;
    }
    static int BodyStart(string[] lines)
    {
        if (lines.Length == 0 || lines[0] != "---") return 0;
        var end = Array.IndexOf(lines, "---", 1);
        return end > 0 ? end + 1 : 0;
    }

    /// <summary>The text with [[wiki links]], [md](links), ![images] and URLs blanked out (same length, lines kept).</summary>
    public static string MaskLinks(string text) =>
        Masks().Replace(text, m => new string(' ', m.Length));
    [GeneratedRegex(@"!?\[\[[^\]\n]*\]\]|!?\[[^\]\n]*\]\([^)\n]*\)|<?https?://[^\s>)]+>?|\[[^\]\n]*\]\[[^\]\n]*\]")] private static partial Regex Masks();

    /// <summary>Turns one unlinked mention into a link: the words at (line, column) become [[Note]] (or
    /// [[Note|words]] when they're spelt differently). Null when the text there isn't what was found any more.</summary>
    public static string? LinkMention(string text, int line, int column, string expected, string noteName)
    {
        var lines = text.Replace("\r\n", "\n").Split('\n');
        if (line < 1 || line > lines.Length) return null;
        var l = lines[line - 1];
        if (column < 0 || column + expected.Length > l.Length || !string.Equals(l.Substring(column, expected.Length), expected, StringComparison.Ordinal)) return null;
        var link = string.Equals(expected, noteName, StringComparison.Ordinal) ? $"[[{noteName}]]" : $"[[{noteName}|{expected}]]";
        lines[line - 1] = l[..column] + link + l[(column + expected.Length)..];
        return string.Join('\n', lines);
    }

    /// <summary>Notes linking to <paramref name="target"/>: by name, path or alias, outside code (one hit per line).</summary>
    public static List<VaultLinkRef> Backlinks(VaultIndex index, string target)
    {
        var notes = index.NotePaths();
        var aliases = VaultNotes.AliasMap(index);
        var refs = new List<VaultLinkRef>();
        foreach (var n in notes.OrderBy(p => p, Comparer<string>.Create(VaultScanner.NaturalCompare)))
        {
            if (string.Equals(n, target, StringComparison.OrdinalIgnoreCase)) continue;
            var raw = (index.TextOf(n) ?? "").Replace("\r\n", "\n").Split('\n');
            var lines = VaultNotes.WithoutCode(string.Join('\n', raw)).Split('\n');
            for (int i = 0; i < lines.Length && i < raw.Length; i++)
                if (VaultLinks.Extract(lines[i]).Any(l => string.Equals(VaultNotes.Resolve(n, l, notes, aliases), target, StringComparison.OrdinalIgnoreCase)))
                    refs.Add(new VaultLinkRef(n, i + 1, Snip(raw[i])));
        }
        return refs;
    }

    /// <summary>The links going out of a note, each with the note it reaches (null: not made yet), outside code.</summary>
    public static List<OutgoingLink> Outgoing(VaultIndex index, string note)
    {
        var text = VaultNotes.WithoutCode(index.TextOf(note) ?? "");
        var notes = index.NotePaths();
        var aliases = VaultNotes.AliasMap(index);
        var result = new List<OutgoingLink>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var lines = text.Split('\n');
        for (int i = 0; i < lines.Length; i++)
            foreach (var link in VaultLinks.Extract(lines[i]))
            {
                if (link.Target.Contains("://") || link.Target.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase)) continue;
                var resolved = VaultNotes.Resolve(note, link, notes, aliases);
                if (resolved == null && !link.Wiki && !VaultPaths.IsNote(Uri.UnescapeDataString(link.Target.Split('#')[0]))) continue;   // a picture, a PDF…
                if (seen.Add(resolved ?? "?" + link.Target)) result.Add(new OutgoingLink(link.Target, resolved, i + 1));
            }
        return result;
    }
}
