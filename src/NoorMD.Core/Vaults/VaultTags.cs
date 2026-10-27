using System.Text.RegularExpressions;

namespace NoorMD.Core.Vaults;

/// <summary>
/// Tags in notes, the way Obsidian writes them: #tag in the text (letters, digits, _, -, and / for nested tags such as
/// #project/alpha) and `tags:` in the front matter (a [list], a comma list or "- item" lines). Headings ("# Title"),
/// links to anchors (page#part), code and plain numbers (#123) are not tags. Tags compare without case.
/// </summary>
public static partial class VaultTags
{
    [GeneratedRegex(@"(?<![\p{L}\p{N}_&/#\]\)\(`])#([\p{L}\p{N}_\-/]*[\p{L}_\-][\p{L}\p{N}_\-/]*)")]
    private static partial Regex InlineTag();

    public static IReadOnlyList<string> Extract(string text)
    {
        var found = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Add(string raw)
        {
            var t = raw.Trim().TrimStart('#').Trim('/').Trim();
            if (t.Length == 0 || t.Length > 100 || t.Any(char.IsWhiteSpace) || t.All(char.IsAsciiDigit)) return;
            if (seen.Add(t)) found.Add(t);
        }
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var start = 0;
        if (lines.Length > 0 && lines[0].Trim() == "---")
        {
            var end = Array.FindIndex(lines, 1, l => l.Trim() is "---" or "...");
            if (end > 0)
            {
                for (var i = 1; i < end; i++)
                {
                    var m = Regex.Match(lines[i], @"^(tags?)\s*:\s*(.*)$", RegexOptions.IgnoreCase);
                    if (!m.Success) continue;
                    var value = m.Groups[2].Value.Trim();
                    if (value.Length > 0)
                        foreach (var part in value.Trim('[', ']').Split(',', StringSplitOptions.RemoveEmptyEntries)) Add(part.Trim().Trim('"', '\''));
                    else
                        for (var j = i + 1; j < end && Regex.IsMatch(lines[j], @"^\s*-\s+"); j++) Add(Regex.Replace(lines[j], @"^\s*-\s+", "").Trim().Trim('"', '\''));
                }
                start = end + 1;
            }
        }
        string? fence = null;
        for (var i = start; i < lines.Length; i++)
        {
            var line = lines[i];
            var t = line.TrimStart();
            if (fence != null) { if (t.StartsWith(fence)) fence = null; continue; }
            if (t.StartsWith("```") || t.StartsWith("~~~")) { fence = t[..3]; continue; }
            if (line.StartsWith("    ") || line.StartsWith('\t')) continue; // indented code
            foreach (Match m in InlineTag().Matches(StripInlineCode(line))) Add(m.Groups[1].Value);
        }
        return found;
    }

    /// <summary>True when a note's tag is the tag asked for or nested under it (#project matches #project/alpha).</summary>
    public static bool Matches(string noteTag, string wanted) =>
        string.Equals(noteTag, wanted, StringComparison.OrdinalIgnoreCase) || noteTag.StartsWith(wanted.TrimEnd('/') + "/", StringComparison.OrdinalIgnoreCase);

    private static string StripInlineCode(string line)
    {
        if (!line.Contains('`')) return line;
        return Regex.Replace(line, @"(`+)(.+?)\1", m => new string(' ', m.Length));
    }
}
