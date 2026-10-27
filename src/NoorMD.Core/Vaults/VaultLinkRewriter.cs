using System.Text;
using System.Text.RegularExpressions;

namespace NoorMD.Core.Vaults;

/// <summary>
/// Keeps links working when notes or files are renamed or moved inside a Vault. Given the moves (old Vault path →
/// new Vault path, files only), it rewrites a note's Markdown links and images (relative paths) and its [[wiki links]]
/// so they point at the same things afterwards. A note that moves itself has its own relative links adjusted too.
/// Only links that resolved before the move are touched; external links, anchors and code blocks are left alone.
/// </summary>
public static partial class VaultLinkRewriter
{
    [GeneratedRegex(@"(!?\[(?:[^\]\\]|\\.)*\]\()(\s*)(<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)((?:\s+""[^""\n]*"")?\s*\))")]
    private static partial Regex MdLinkRx();

    [GeneratedRegex(@"(!?\[\[)([^\]\|#\n]+)((?:#[^\]\|\n]*)?(?:\|[^\]\n]*)?\]\])")]
    private static partial Regex WikiLinkRx();

    [GeneratedRegex(@"(?<!\\)(\\?!)?\\\[\\\[((?:[^\]\n\\]|\\[^\n])+?)\\\]\\\]")]
    private static partial Regex EscapedWikiRx();

    public sealed record Result(string Text, int Changed);

    /// <param name="text">The note's Markdown.</param>
    /// <param name="noteBefore">The note's Vault path before the moves.</param>
    /// <param name="moves">Old → new Vault path for every moved file (notes and attachments).</param>
    /// <param name="filesBefore">Every file in the Vault before the moves (Vault paths).</param>
    public static Result Rewrite(string text, string noteBefore, IReadOnlyDictionary<string, string> moves, IReadOnlyCollection<string> filesBefore)
    {
        var notesBefore = filesBefore.Where(VaultPaths.IsNote).ToList();
        var notesAfter = notesBefore.Select(n => Moved(moves, n)).ToList();
        var noteAfter = Moved(moves, noteBefore);
        var files = new HashSet<string>(filesBefore, StringComparer.OrdinalIgnoreCase);
        var filesAfter = filesBefore.Select(f => Moved(moves, f)).ToList();
        var changed = 0;
        var sb = new StringBuilder(text.Length + 64);
        foreach (var (segment, isCode) in Segments(text))
        {
            if (isCode) { sb.Append(segment); continue; }
            var s = MdLinkRx().Replace(segment, m =>
            {
                var raw = m.Groups[3].Value;
                var angle = raw.StartsWith('<');
                var target = angle ? raw[1..^1] : raw;
                var hash = target.IndexOf('#');
                var path = hash >= 0 ? target[..hash] : target;
                var anchor = hash >= 0 ? target[hash..] : "";
                if (path.Length == 0 || path.Contains("://") || path.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase) || path.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return m.Value;
                string decoded;
                try { decoded = Uri.UnescapeDataString(path); } catch (UriFormatException) { return m.Value; }
                var resolved = ResolveRelative(noteBefore, decoded);
                if (resolved == null || !files.Contains(resolved)) return m.Value;
                var targetAfter = Moved(moves, resolved);
                if (string.Equals(targetAfter, resolved, StringComparison.Ordinal) && string.Equals(noteAfter, noteBefore, StringComparison.Ordinal)) return m.Value;
                var rel = decoded.StartsWith('/') ? "/" + targetAfter : Relative(noteAfter, targetAfter);
                // Keep the link's style: angle brackets as written; otherwise spaces need %20 to stay a valid link.
                var written = angle ? "<" + rel + anchor + ">" : (path.Contains('%') || rel.Contains(' ') ? Encode(rel) : rel) + anchor;
                if (written == raw) return m.Value;
                changed++;
                return m.Groups[1].Value + m.Groups[2].Value + written + m.Groups[4].Value;
            });
            string? NewWikiTarget(string trimmed)
            {
                var resolved = ResolveWiki(noteBefore, trimmed, notesBefore, filesBefore);
                if (resolved == null) return null;
                var targetAfter = Moved(moves, resolved);
                var hasExt = System.IO.Path.HasExtension(trimmed) && (VaultPaths.IsNote(trimmed) || !VaultPaths.IsNote(resolved));
                var byPath = trimmed.Contains('/') || trimmed.Contains('\\');
                string Form(string p, bool path) { var t = path ? p : p[(p.LastIndexOf('/') + 1)..]; return hasExt ? t : t[..^System.IO.Path.GetExtension(t).Length]; }
                // The shortest form that still finds the same note from where the linking note will be.
                var candidate = Form(targetAfter, byPath);
                if (!string.Equals(ResolveWiki(noteAfter, candidate, notesAfter, filesAfter), targetAfter, StringComparison.OrdinalIgnoreCase))
                    candidate = Form(targetAfter, true);
                return string.Equals(candidate, trimmed, StringComparison.Ordinal) ? null : candidate;
            }
            s = WikiLinkRx().Replace(s, m =>
            {
                if (NewWikiTarget(m.Groups[2].Value.Trim()) is not { } candidate) return m.Value;
                changed++;
                return m.Groups[1].Value + candidate + m.Groups[3].Value;
            });
            // \[\[Note\]\] (brackets escaped by an editor): rewritten as a plain [[wiki link]] when it changes.
            s = EscapedWikiRx().Replace(s, m =>
            {
                var (target, rest) = VaultLinks.SplitWiki(VaultLinks.Unescape(m.Groups[2].Value));
                if (target.Length == 0 || NewWikiTarget(target) is not { } candidate) return m.Value;
                changed++;
                return (m.Groups[1].Success ? "!" : "") + "[[" + candidate + rest + "]]";
            });
            sb.Append(s);
        }
        return new Result(changed == 0 ? text : sb.ToString(), changed);
    }

    /// <summary>Expands folder moves to every file inside them (Vault paths).</summary>
    public static Dictionary<string, string> ExpandMoves(IEnumerable<(string OldRel, string NewRel, bool IsFolder)> moves, IEnumerable<string> filesBefore)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var files = filesBefore.ToList();
        foreach (var (oldRel, newRel, isFolder) in moves)
        {
            if (!isFolder) { map[oldRel] = newRel; continue; }
            foreach (var f in files.Where(f => f.StartsWith(oldRel + "/", StringComparison.OrdinalIgnoreCase)))
                map[f] = newRel + f[oldRel.Length..];
        }
        return map;
    }

    /// <summary>A wiki link's target: a note (VaultLinks rules) or, for ![[photo.png]] and the like, any file by path or name.</summary>
    internal static string? ResolveWiki(string fromNote, string target, IReadOnlyCollection<string> notes, IReadOnlyCollection<string> files)
    {
        var t = target.Replace('\\', '/').Trim('/');
        var ext = System.IO.Path.GetExtension(t);
        var note = VaultLinks.Resolve(fromNote, new VaultLink(t, true), notes); // also notes with dots in the name ("v1.2 notes")
        if (note != null || ext.Length == 0 || VaultPaths.IsNote(t)) return note;
        var exact = files.FirstOrDefault(f => string.Equals(f, t, StringComparison.OrdinalIgnoreCase));
        if (exact != null) return exact;
        var fromFolder = fromNote.Contains('/') ? fromNote[..fromNote.LastIndexOf('/')] : "";
        return files.Where(f => f.EndsWith("/" + t, StringComparison.OrdinalIgnoreCase))
            .OrderBy(f => f.StartsWith(fromFolder + "/", StringComparison.OrdinalIgnoreCase) || fromFolder.Length == 0 ? 0 : 1)
            .ThenBy(f => f.Count(c => c == '/')).ThenBy(f => f.Length).FirstOrDefault();
    }

    private static string Moved(IReadOnlyDictionary<string, string> moves, string path) => moves.TryGetValue(path, out var to) ? to : path;

    private static string? ResolveRelative(string fromNote, string decoded)
    {
        var parts = (fromNote.Contains('/') ? fromNote[..fromNote.LastIndexOf('/')] : "").Split('/', StringSplitOptions.RemoveEmptyEntries).ToList();
        if (decoded.StartsWith('/')) parts.Clear();
        foreach (var seg in decoded.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (seg == ".") continue;
            if (seg == "..") { if (parts.Count == 0) return null; parts.RemoveAt(parts.Count - 1); continue; }
            parts.Add(seg);
        }
        return parts.Count == 0 ? null : string.Join('/', parts);
    }

    /// <summary>The path from a note's folder to a target ("../Images/a.png", "Sub/b.md", "c.md").</summary>
    public static string Relative(string fromNote, string target)
    {
        var from = fromNote.Contains('/') ? fromNote[..fromNote.LastIndexOf('/')].Split('/') : [];
        var to = target.Split('/');
        var common = 0;
        while (common < from.Length && common < to.Length - 1 && string.Equals(from[common], to[common], StringComparison.OrdinalIgnoreCase)) common++;
        var up = Enumerable.Repeat("..", from.Length - common);
        return string.Join('/', up.Concat(to.Skip(common)));
    }

    private static string Encode(string path) => string.Join('/', path.Split('/').Select(p => p == ".." ? p : Uri.EscapeDataString(p)));

    /// <summary>Splits text into prose and code (fenced blocks and inline `code`), so links in code are never changed.</summary>
    private static IEnumerable<(string Text, bool Code)> Segments(string text)
    {
        var sb = new StringBuilder();
        string? fence = null;
        foreach (var line in SplitKeepingEnds(text))
        {
            var t = line.TrimStart();
            if (fence == null && (t.StartsWith("```") || t.StartsWith("~~~")))
            {
                if (sb.Length > 0) { foreach (var s in Inline(sb.ToString())) yield return s; sb.Clear(); }
                fence = t[..3];
                yield return (line, true);
                continue;
            }
            if (fence != null)
            {
                if (t.StartsWith(fence)) fence = null;
                yield return (line, true);
                continue;
            }
            sb.Append(line);
            // Inline `code` never spans a blank line (CommonMark), so one stray backtick can't hide later paragraphs' links.
            if (t.Trim().Length == 0) { foreach (var s in Inline(sb.ToString())) yield return s; sb.Clear(); }
        }
        if (sb.Length > 0) foreach (var s in Inline(sb.ToString())) yield return s;
    }

    private static IEnumerable<(string, bool)> Inline(string text)
    {
        var i = 0;
        while (i < text.Length)
        {
            var open = text.IndexOf('`', i);
            if (open < 0) { yield return (text[i..], false); yield break; }
            var ticks = 1;
            while (open + ticks < text.Length && text[open + ticks] == '`') ticks++;
            var marker = new string('`', ticks);
            var close = text.IndexOf(marker, open + ticks, StringComparison.Ordinal);
            if (close < 0) { yield return (text[i..], false); yield break; }
            if (open > i) yield return (text[i..open], false);
            yield return (text[open..(close + ticks)], true);
            i = close + ticks;
        }
    }

    private static IEnumerable<string> SplitKeepingEnds(string text)
    {
        var start = 0;
        for (var i = 0; i < text.Length; i++)
            if (text[i] == '\n') { yield return text[start..(i + 1)]; start = i + 1; }
        if (start < text.Length) yield return text[start..];
    }
}
