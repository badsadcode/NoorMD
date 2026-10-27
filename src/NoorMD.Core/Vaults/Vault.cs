using System.Globalization;
using System.Text;
using NoorMD.Core.Documents;

namespace NoorMD.Core.Vaults;

/// <summary>One file or folder in a Vault, by path relative to the Vault root ("/" separators).</summary>
public sealed record VaultEntry(string Path, bool IsFolder, long Size, DateTime ModifiedUtc)
{
    public string Name => Path[(Path.LastIndexOf('/') + 1)..];
    public string Parent => Path.Contains('/') ? Path[..Path.LastIndexOf('/')] : "";
}

/// <summary>
/// A Vault is an ordinary folder. Nothing is written into it by NoorMD except the user's own notes and folders,
/// and folders that belong to other tools (.git, .obsidian, …) are left alone and not shown.
/// </summary>
public static class VaultPaths
{
    public static readonly string[] DefaultExcluded = [".git", ".obsidian", ".noormd", ".trash", ".vs", ".vscode", ".idea", "node_modules", "$RECYCLE.BIN", "System Volume Information"];
    public static readonly string[] NoteExtensions = [".md", ".markdown", ".mdown", ".mkd"];
    private static readonly char[] Invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    private static readonly string[] Reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"];

    public static bool IsNote(string path) => NoteExtensions.Contains(System.IO.Path.GetExtension(path), StringComparer.OrdinalIgnoreCase);

    /// <summary>Hidden (dot) entries, other tools' folders and the user's extra folder names are not part of the Vault view or index.</summary>
    public static bool IsExcluded(string name, IReadOnlyCollection<string> excluded) =>
        name.StartsWith('.') || DefaultExcluded.Contains(name, StringComparer.OrdinalIgnoreCase) || excluded.Contains(name, StringComparer.OrdinalIgnoreCase);

    /// <summary>A full path for a Vault-relative path; null if it is malformed or would leave the Vault.</summary>
    public static string? Resolve(string root, string? relative)
    {
        if (relative == null || relative.Length > 1000 || relative.Contains('\0') || relative.Contains(':')) return null;
        var rel = relative.Replace('\\', '/').Trim('/');
        var fullRoot = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(root));
        if (rel.Length == 0) return fullRoot;
        if (rel.Split('/').Any(s => s is "" or "." or "..")) return null;
        var full = System.IO.Path.GetFullPath(System.IO.Path.Combine(fullRoot, rel.Replace('/', System.IO.Path.DirectorySeparatorChar)));
        return full.StartsWith(fullRoot + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ? full : null;
    }

    /// <summary>The Vault-relative path of a full path inside the Vault, or null.</summary>
    public static string? ToRelative(string root, string full)
    {
        var r = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(root));
        var f = System.IO.Path.GetFullPath(full);
        if (string.Equals(r, System.IO.Path.TrimEndingDirectorySeparator(f), StringComparison.OrdinalIgnoreCase)) return "";
        return f.StartsWith(r + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ? f[(r.Length + 1)..].Replace('\\', '/') : null;
    }

    /// <summary>Why a name can't be used for a file or folder on Windows, or null if it can.</summary>
    public static string? NameProblem(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "Enter a name.";
        if (name.Length > 200) return "The name is too long.";
        if (name.IndexOfAny(Invalid) >= 0 || name.Any(char.IsControl)) return "Names can't contain < > : \" / \\ | ? *";
        if (name.EndsWith('.') || name.EndsWith(' ')) return "Names can't end with a dot or a space.";
        if (name is "." or "..") return "That name is reserved.";
        var stem = name.Split('.')[0].Trim();
        if (Reserved.Contains(stem, StringComparer.OrdinalIgnoreCase)) return $"“{stem}” is reserved by Windows.";
        return null;
    }

    /// <summary>"Untitled.md", "Untitled 2.md", … — the first name not taken in the folder.</summary>
    public static string UniqueName(string folder, string baseName, string extension)
    {
        for (int i = 1; i < 10_000; i++)
        {
            var name = (i == 1 ? baseName : $"{baseName} {i}") + extension;
            var full = System.IO.Path.Combine(folder, name);
            if (!File.Exists(full) && !Directory.Exists(full)) return name;
        }
        return $"{baseName} {Guid.NewGuid():N}{extension}";
    }
}

/// <summary>Lists a Vault folder tree. Symbolic links and junctions are listed but never followed.</summary>
public static class VaultScanner
{
    public const int MaxEntries = 200_000;

    public static List<VaultEntry> Scan(string root, IReadOnlyCollection<string> excluded, CancellationToken ct = default)
    {
        var list = new List<VaultEntry>();
        var fullRoot = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(root));
        var stack = new Stack<(string Full, string Rel)>();
        stack.Push((fullRoot, ""));
        var options = new EnumerationOptions { IgnoreInaccessible = true, RecurseSubdirectories = false, AttributesToSkip = 0, ReturnSpecialDirectories = false };
        while (stack.Count > 0 && list.Count < MaxEntries)
        {
            ct.ThrowIfCancellationRequested();
            var (dir, rel) = stack.Pop();
            IEnumerable<FileSystemInfo> items;
            try { items = new DirectoryInfo(dir).EnumerateFileSystemInfos("*", options).ToList(); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { continue; }
            foreach (var item in items)
            {
                if (VaultPaths.IsExcluded(item.Name, excluded)) continue;
                if (item.Attributes.HasFlag(FileAttributes.Hidden) && item.Attributes.HasFlag(FileAttributes.System)) continue;
                var childRel = rel.Length == 0 ? item.Name : rel + "/" + item.Name;
                if (item is DirectoryInfo d)
                {
                    list.Add(new VaultEntry(childRel, true, 0, d.LastWriteTimeUtc));
                    if (!d.Attributes.HasFlag(FileAttributes.ReparsePoint)) stack.Push((d.FullName, childRel)); // never follow links out of the Vault
                }
                else if (item is FileInfo f)
                {
                    if (f.Attributes.HasFlag(FileAttributes.ReparsePoint)) continue;
                    list.Add(new VaultEntry(childRel, false, f.Length, f.LastWriteTimeUtc));
                }
            }
        }
        list.Sort((a, b) => NaturalCompare(a.Path, b.Path));
        return list;
    }

    /// <summary>"Note 2" before "Note 10", case-insensitive.</summary>
    public static int NaturalCompare(string? a, string? b)
    {
        a ??= ""; b ??= "";
        int i = 0, j = 0;
        while (i < a.Length && j < b.Length)
        {
            if (char.IsDigit(a[i]) && char.IsDigit(b[j]))
            {
                int si = i, sj = j;
                while (i < a.Length && char.IsDigit(a[i])) i++;
                while (j < b.Length && char.IsDigit(b[j])) j++;
                var na = a[si..i].TrimStart('0'); var nb = b[sj..j].TrimStart('0');
                if (na.Length != nb.Length) return na.Length.CompareTo(nb.Length);
                var c = string.CompareOrdinal(na, nb);
                if (c != 0) return c;
            }
            else
            {
                // '/' sorts first so a folder's contents stay together, right after the folder.
                if (a[i] == '/' || b[j] == '/') { if (a[i] != b[j]) return a[i] == '/' ? -1 : 1; i++; j++; continue; }
                var c = string.Compare(a[i].ToString(), b[j].ToString(), CultureInfo.InvariantCulture, CompareOptions.IgnoreCase);
                if (c != 0) return c;
                i++; j++;
            }
        }
        return (a.Length - i).CompareTo(b.Length - j);
    }
}

/// <summary>Search text folding: case, Polish and other diacritics are ignored ("zolw" finds "Żółw").</summary>
public static class TextFold
{
    public static string Fold(string s)
    {
        var d = s.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(d.Length);
        foreach (var c in d)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            sb.Append(c switch { 'ł' or 'Ł' => 'l', 'ß' => 's', 'đ' or 'Đ' => 'd', 'ø' or 'Ø' => 'o', _ => char.ToLowerInvariant(c) });
        }
        return sb.ToString();
    }
}

public sealed record VaultSearchHit(string Path, string Name, int Line, string Snippet, bool NameMatch);
public sealed record VaultLinkRef(string Source, int Line, string Snippet);
public sealed record VaultTagCount(string Tag, int Count);

/// <summary>
/// In-memory text index of a Vault's notes, for search and backlinks. It is a cache: rebuilt from the files at any
/// time, never written into the Vault, and never needed to open a document.
/// </summary>
public sealed class VaultIndex
{
    public const long MaxNoteBytes = 2 * 1024 * 1024;
    private sealed record Note(string Path, DateTime Modified, long Size, string Text, string[] FoldedLines, IReadOnlyList<string> Tags);

    private readonly Dictionary<string, Note> _notes = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _lock = new();
    public string Root { get; }

    public VaultIndex(string root) => Root = root;

    public int Count { get { lock (_lock) return _notes.Count; } }

    /// <summary>Reads notes that are new or changed since the last update and forgets removed ones. Returns notes read.</summary>
    public int Update(IReadOnlyList<VaultEntry> entries, CancellationToken ct = default)
    {
        var notes = entries.Where(e => !e.IsFolder && VaultPaths.IsNote(e.Path)).ToList();
        int read = 0;
        lock (_lock)
        {
            var keep = new HashSet<string>(notes.Select(n => n.Path), StringComparer.OrdinalIgnoreCase);
            foreach (var gone in _notes.Keys.Where(k => !keep.Contains(k)).ToList()) _notes.Remove(gone);
        }
        foreach (var e in notes)
        {
            ct.ThrowIfCancellationRequested();
            lock (_lock) { if (_notes.TryGetValue(e.Path, out var old) && old.Modified == e.ModifiedUtc && old.Size == e.Size) continue; }
            var text = "";
            if (e.Size <= MaxNoteBytes && VaultPaths.Resolve(Root, e.Path) is { } full)
            {
                try { text = TextFileCodec.NormalizeNewlines(TextFileCodec.Decode(File.ReadAllBytes(full)).Text); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { continue; } // locked: try again next time
            }
            var note = new Note(e.Path, e.ModifiedUtc, e.Size, text, text.Split('\n').Select(TextFold.Fold).ToArray(), VaultTags.Extract(text));
            lock (_lock) _notes[e.Path] = note;
            read++;
        }
        return read;
    }

    /// <summary>Notes whose name matches come first, then content matches (one hit per matching line).</summary>
    public List<VaultSearchHit> Search(string query, int limit = 200, CancellationToken ct = default)
    {
        var terms = TextFold.Fold(query).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var hits = new List<VaultSearchHit>();
        if (terms.Length == 0) return hits;
        List<Note> notes;
        lock (_lock) notes = _notes.Values.ToList();
        notes.Sort((a, b) => VaultScanner.NaturalCompare(a.Path, b.Path));
        foreach (var n in notes)
        {
            var name = n.Path[(n.Path.LastIndexOf('/') + 1)..];
            var folded = TextFold.Fold(n.Path);
            if (terms.All(folded.Contains)) hits.Add(new VaultSearchHit(n.Path, name, 0, n.Path, true));
        }
        foreach (var n in notes)
        {
            ct.ThrowIfCancellationRequested();
            var name = n.Path[(n.Path.LastIndexOf('/') + 1)..];
            // Every term must occur somewhere in the note; lines that contain any of them are shown.
            if (!terms.All(t => n.FoldedLines.Any(l => l.Contains(t, StringComparison.Ordinal)))) continue;
            var lines = n.Text.Split('\n');
            int perNote = 0;
            for (int i = 0; i < n.FoldedLines.Length && perNote < 5; i++)
            {
                if (!terms.Any(t => n.FoldedLines[i].Contains(t, StringComparison.Ordinal))) continue;
                hits.Add(new VaultSearchHit(n.Path, name, i + 1, Snippet(lines[i]), false));
                perNote++;
                if (hits.Count >= limit) return hits;
            }
        }
        return hits;
    }

    private static string Snippet(string line)
    {
        var s = line.Trim();
        return s.Length > 220 ? s[..220] + "…" : s;
    }

    /// <summary>Notes that link to <paramref name="target"/> with a relative Markdown link or a [[wiki link]].</summary>
    public List<VaultLinkRef> Backlinks(string target)
    {
        List<Note> notes;
        lock (_lock) notes = _notes.Values.ToList();
        var allNotes = notes.Select(n => n.Path).ToList();
        var refs = new List<VaultLinkRef>();
        foreach (var n in notes.OrderBy(n => n.Path, Comparer<string>.Create(VaultScanner.NaturalCompare)))
        {
            if (string.Equals(n.Path, target, StringComparison.OrdinalIgnoreCase)) continue;
            var lines = n.Text.Split('\n');
            for (int i = 0; i < lines.Length; i++)
            {
                foreach (var link in VaultLinks.Extract(lines[i]))
                {
                    var resolved = VaultLinks.Resolve(n.Path, link, allNotes);
                    if (resolved != null && string.Equals(resolved, target, StringComparison.OrdinalIgnoreCase))
                    {
                        refs.Add(new VaultLinkRef(n.Path, i + 1, Snippet(lines[i])));
                        goto nextLine;
                    }
                }
            nextLine:;
            }
        }
        return refs;
    }

    public IReadOnlyList<string> NotePaths() { lock (_lock) return _notes.Keys.ToList(); }

    /// <summary>Every tag in the Vault with the number of notes using it (the spelling used most often wins).</summary>
    public List<VaultTagCount> Tags()
    {
        lock (_lock)
        {
            return _notes.Values.SelectMany(n => n.Tags).GroupBy(t => t, StringComparer.OrdinalIgnoreCase)
                .Select(g => new VaultTagCount(g.GroupBy(x => x, StringComparer.Ordinal).OrderByDescending(x => x.Count()).First().Key, g.Count()))
                .OrderBy(t => t.Tag, StringComparer.CurrentCultureIgnoreCase).ToList();
        }
    }

    /// <summary>Notes tagged with a tag or a tag nested under it, by path.</summary>
    public List<string> Tagged(string tag)
    {
        lock (_lock)
            return _notes.Values.Where(n => n.Tags.Any(t => VaultTags.Matches(t, tag))).Select(n => n.Path)
                .OrderBy(p => p, Comparer<string>.Create(VaultScanner.NaturalCompare)).ToList();
    }

    /// <summary>The tags of one note (for the document sidebar).</summary>
    public IReadOnlyList<string> TagsOf(string path) { lock (_lock) return _notes.TryGetValue(path, out var n) ? n.Tags : []; }
}

/// <summary>A link found in Markdown text.</summary>
public sealed record VaultLink(string Target, bool Wiki);

/// <summary>Finds and resolves links between notes: relative Markdown links and Obsidian-style [[wiki links]].</summary>
public static class VaultLinks
{
    private static readonly System.Text.RegularExpressions.Regex MdLink = new(@"(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+""[^""]*"")?\s*\)", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex WikiLink = new(@"(?<!!)\[\[([^\]\|#]+)(?:#[^\]\|]*)?(?:\|[^\]]*)?\]\]", System.Text.RegularExpressions.RegexOptions.Compiled);

    public static IEnumerable<VaultLink> Extract(string text)
    {
        foreach (System.Text.RegularExpressions.Match m in MdLink.Matches(text)) yield return new VaultLink(m.Groups[1].Value, false);
        foreach (System.Text.RegularExpressions.Match m in WikiLink.Matches(text)) yield return new VaultLink(m.Groups[1].Value.Trim(), true);
    }

    /// <summary>
    /// The Vault-relative note a link points at, or null (external, missing or ambiguous). A wiki link names a note by
    /// file name (with or without ".md") or by Vault path; if several notes share the name, the one nearest to the
    /// linking note wins, then the shortest path — the same rule Obsidian uses.
    /// </summary>
    public static string? Resolve(string fromNote, VaultLink link, IReadOnlyCollection<string> notes)
    {
        var target = link.Target;
        if (link.Wiki)
        {
            var t = target.Replace('\\', '/').Trim('/');
            if (t.Length == 0) return null;
            var withExt = VaultPaths.IsNote(t) ? t : t + ".md";
            var exact = notes.FirstOrDefault(n => string.Equals(n, withExt, StringComparison.OrdinalIgnoreCase));
            if (exact != null) return exact;
            var byName = notes.Where(n => n.EndsWith("/" + withExt, StringComparison.OrdinalIgnoreCase) || string.Equals(n, withExt, StringComparison.OrdinalIgnoreCase)).ToList();
            if (byName.Count == 0) return null;
            var fromFolder = fromNote.Contains('/') ? fromNote[..fromNote.LastIndexOf('/')] : "";
            return byName.OrderBy(n => n.StartsWith(fromFolder + "/", StringComparison.OrdinalIgnoreCase) || fromFolder.Length == 0 ? 0 : 1)
                         .ThenBy(n => n.Count(c => c == '/')).ThenBy(n => n.Length).First();
        }
        if (target.Contains("://") || target.StartsWith('#') || target.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase)) return null;
        var hash = target.IndexOf('#');
        if (hash >= 0) target = target[..hash];
        string decoded;
        try { decoded = Uri.UnescapeDataString(target); } catch (UriFormatException) { return null; }
        if (!VaultPaths.IsNote(decoded)) return null;
        var parts = (fromNote.Contains('/') ? fromNote[..fromNote.LastIndexOf('/')] : "").Split('/', StringSplitOptions.RemoveEmptyEntries).ToList();
        if (decoded.StartsWith('/')) parts.Clear();
        foreach (var seg in decoded.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (seg == ".") continue;
            if (seg == "..") { if (parts.Count == 0) return null; parts.RemoveAt(parts.Count - 1); continue; }
            parts.Add(seg);
        }
        var rel = string.Join('/', parts);
        return notes.FirstOrDefault(n => string.Equals(n, rel, StringComparison.OrdinalIgnoreCase));
    }
}
