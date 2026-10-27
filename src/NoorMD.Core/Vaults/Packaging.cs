using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;

namespace NoorMD.Core.Vaults;

/// <summary>What the user chose in the Pack &amp; Share dialog.</summary>
public sealed class PackageOptions
{
    /// <summary>Vault-relative files and folders; empty means the whole Vault.</summary>
    public List<string> Selection { get; set; } = [];
    /// <summary>Pictures and other non-note files inside the selection.</summary>
    public bool IncludeAttachments { get; set; } = true;
    /// <summary>Files outside the selection (but inside the Vault) that the selected notes link to.</summary>
    public bool IncludeDependencies { get; set; }
    /// <summary>Dependencies the user unticked in the review.</summary>
    public List<string> SkipDependencies { get; set; } = [];
    /// <summary>Keep Vault-relative paths (links keep working). Off: every file at the top level.</summary>
    public bool PreserveStructure { get; set; } = true;
    public List<string> Exclusions { get; set; } = [.. PackagePlanner.DefaultExclusions];
    public bool Manifest { get; set; }
    /// <summary>AI Handoff preset: MANIFEST.md and README.md under _noormd_handoff/, plus the user's own note.</summary>
    public bool Handoff { get; set; }
    public string? HandoffNote { get; set; }
    /// <summary>The archive being written, so it can never include itself.</summary>
    public string? OutputPath { get; set; }
}

public enum PackReason { Selected, Dependency, Generated }
public sealed record PlannedFile(string Source, string Entry, long Size, PackReason Reason);
public sealed record ExcludedFile(string Path, string Rule);
public sealed record Dependency(string Path, string LinkedFrom, bool Included);
public sealed record UnresolvedLink(string From, string Target, string Problem);

public sealed class PackagePlan
{
    public List<PlannedFile> Files { get; } = [];
    public List<ExcludedFile> Excluded { get; } = [];
    public List<Dependency> Dependencies { get; } = [];
    public List<UnresolvedLink> Unresolved { get; } = [];
    public List<string> Warnings { get; } = [];
    public long TotalBytes => Files.Sum(f => f.Size);
    /// <summary>Generated metadata (manifest, handoff README) — written last, never over a user file.</summary>
    public List<(string Entry, string Text)> Generated { get; } = [];
}

/// <summary>
/// Turns a selection into a deterministic list of files and archive paths. Nothing is read beyond file names, sizes
/// and the text of the selected notes (for their links); nothing is changed.
/// </summary>
public static class PackagePlanner
{
    public const string HandoffFolder = "_noormd_handoff";
    public const string ManifestFolder = "_noormd_package";

    /// <summary>Folder names end with "/", the rest match file names (* and ? wildcards). Shown and editable in the dialog.</summary>
    public static readonly string[] DefaultExclusions =
    [
        ".git/", ".svn/", ".hg/", ".obsidian/", ".noormd/", ".trash/", ".vs/", ".vscode/", ".idea/", "node_modules/", "bin/", "obj/", "__pycache__/",
        ".env", "*.env", ".env.*", "*.pem", "*.key", "*.pfx", "*.p12", "id_rsa*", "id_ed25519*", "*.kdbx", "credentials*", "secrets*",
        "*.tmp", "*.noormd-tmp", "~$*", "*.swp", "Thumbs.db", ".DS_Store", "desktop.ini",
    ];

    private static readonly Regex MdTarget = new(@"!?\[[^\]]*\]\(\s*" + VaultLinks.MdTargetPattern + @"(?:\s+""[^""]*"")?\s*\)", RegexOptions.Compiled);
    private static readonly Regex WikiTarget = new(@"!?\[\[([^\]\|#\n]+)", RegexOptions.Compiled); // links and ![[embeds]]
    private static readonly Regex HtmlSrc = new(@"<img[^>]+src\s*=\s*[""']([^""']+)[""']", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static PackagePlan Build(string root, PackageOptions o, CancellationToken ct = default)
    {
        var fullRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        var plan = new PackagePlan();
        var rules = (o.Exclusions ?? []).Select(x => x.Trim()).Where(x => x.Length > 0).Distinct().ToList();
        var output = o.OutputPath == null ? null : Path.GetFullPath(o.OutputPath);
        var chosen = new Dictionary<string, (string Full, long Size, PackReason Reason)>(StringComparer.OrdinalIgnoreCase);

        void Consider(string rel, PackReason reason)
        {
            var full = VaultPaths.Resolve(fullRoot, rel);
            if (full == null || !File.Exists(full)) return;
            if (output != null && (string.Equals(full, output, StringComparison.OrdinalIgnoreCase) || full.StartsWith(output + ".", StringComparison.OrdinalIgnoreCase)))
            { plan.Excluded.Add(new ExcludedFile(rel, "the archive being created")); return; }
            if (Rule(rel, rules) is { } rule) { plan.Excluded.Add(new ExcludedFile(rel, rule)); return; }
            if (reason == PackReason.Selected && !o.IncludeAttachments && !VaultPaths.IsNote(rel)) { plan.Excluded.Add(new ExcludedFile(rel, "not a note (attachments off)")); return; }
            var info = new FileInfo(full);
            if (info.Attributes.HasFlag(FileAttributes.ReparsePoint)) { plan.Excluded.Add(new ExcludedFile(rel, "link to elsewhere (not followed)")); return; }
            chosen.TryAdd(rel, (full, info.Length, reason));
        }

        // 1. The selection, folders recursively. Folder links (junctions) are never followed out of the Vault.
        var selection = o.Selection is { Count: > 0 } ? o.Selection : [""];
        foreach (var sel in selection.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            ct.ThrowIfCancellationRequested();
            var full = VaultPaths.Resolve(fullRoot, sel);
            if (full == null) { plan.Warnings.Add($"“{sel}” is not inside the Vault and was skipped."); continue; }
            if (File.Exists(full)) { Consider(VaultPaths.ToRelative(fullRoot, full)!, PackReason.Selected); continue; }
            if (!Directory.Exists(full)) { plan.Warnings.Add($"“{sel}” no longer exists."); continue; }
            Walk(full, VaultPaths.ToRelative(fullRoot, full)!, rules, plan, rel => Consider(rel, PackReason.Selected), ct);
        }

        // 2. Links from the selected notes: missing ones are reported; ones outside the selection are dependencies.
        var notes = new List<string>();
        var allFiles = new Lazy<List<string>>(() => VaultScanner.Scan(fullRoot, []).Where(e => !e.IsFolder).Select(e => e.Path).ToList());
        var deps = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (rel, item) in chosen.Where(c => VaultPaths.IsNote(c.Key)).ToList())
        {
            ct.ThrowIfCancellationRequested();
            if (item.Size > VaultIndex.MaxNoteBytes) continue;
            string text;
            try { text = Documents.TextFileCodec.Decode(File.ReadAllBytes(item.Full)).Text; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { plan.Warnings.Add($"Could not read “{rel}” to check its links."); continue; }
            foreach (var target in LinkTargets(text))
            {
                var resolved = ResolveLocal(fullRoot, rel, target, allFiles);
                if (resolved.Problem != null) { if (resolved.Problem != "external") plan.Unresolved.Add(new UnresolvedLink(rel, target.Text, resolved.Problem)); continue; }
                if (resolved.Rel == null || chosen.ContainsKey(resolved.Rel)) continue;
                deps.TryAdd(resolved.Rel, rel);
            }
        }
        foreach (var (dep, from) in deps.OrderBy(d => d.Key, StringComparer.OrdinalIgnoreCase))
        {
            var include = o.IncludeDependencies && !o.SkipDependencies.Contains(dep, StringComparer.OrdinalIgnoreCase);
            var excludedBy = Rule(dep, rules);
            plan.Dependencies.Add(new Dependency(dep, from, include && excludedBy == null));
            if (include) Consider(dep, PackReason.Dependency);
        }
        if (!o.IncludeDependencies && deps.Count > 0)
            plan.Warnings.Add($"{deps.Count} linked file{(deps.Count == 1 ? " is" : "s are")} outside the selection; turn on “Include linked files” to add {(deps.Count == 1 ? "it" : "them")}.");

        // 3. Archive paths: Vault-relative (links keep working) or flat with unique names.
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (rel, item) in chosen.OrderBy(c => c.Key, Comparer<string>.Create(VaultScanner.NaturalCompare)))
        {
            var entry = o.PreserveStructure ? rel : UniqueFlat(rel, used);
            if (!SafeEntry(entry) || !used.Add(entry)) { plan.Warnings.Add($"“{rel}” has an archive path that is not safe and was skipped."); continue; }
            plan.Files.Add(new PlannedFile(item.Full, entry, item.Size, item.Reason));
        }
        if (!o.PreserveStructure && plan.Files.Any(f => VaultPaths.IsNote(f.Entry))) plan.Warnings.Add("Folders are flattened, so relative links between files may not work in the archive.");

        // 4. Generated metadata, in its own folder so it never replaces a user's README or MANIFEST.
        if (o.Handoff || o.Manifest)
        {
            var folder = o.Handoff ? HandoffFolder : ManifestFolder;
            var name = folder;
            for (int i = 2; used.Contains(name + "/MANIFEST.md") || plan.Files.Any(f => f.Entry.StartsWith(name + "/", StringComparison.OrdinalIgnoreCase)); i++) name = $"{folder}_{i}";
            plan.Generated.Add((name + "/MANIFEST.md", ManifestText(plan, o)));
            if (o.Handoff) plan.Generated.Add((name + "/README.md", HandoffReadme(plan, o, name)));
        }
        return plan;
    }

    private static void Walk(string dir, string rel, List<string> rules, PackagePlan plan, Action<string> file, CancellationToken ct)
    {
        IEnumerable<FileSystemInfo> items;
        try { items = new DirectoryInfo(dir).EnumerateFileSystemInfos("*", new EnumerationOptions { IgnoreInaccessible = true, AttributesToSkip = 0 }).ToList(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { plan.Warnings.Add($"Could not read the folder “{rel}”."); return; }
        foreach (var item in items.OrderBy(i => i.Name, Comparer<string>.Create(VaultScanner.NaturalCompare)))
        {
            ct.ThrowIfCancellationRequested();
            var childRel = rel.Length == 0 ? item.Name : rel + "/" + item.Name;
            if (item is DirectoryInfo d)
            {
                if (Rule(childRel + "/", rules) is { } rule) { plan.Excluded.Add(new ExcludedFile(childRel + "/", rule)); continue; }
                if (d.Attributes.HasFlag(FileAttributes.ReparsePoint)) { plan.Excluded.Add(new ExcludedFile(childRel + "/", "link to elsewhere (not followed)")); continue; }
                Walk(d.FullName, childRel, rules, plan, file, ct);
            }
            else file(childRel);
        }
    }

    /// <summary>The exclusion rule that matches a Vault path ("folder/" rules match any folder of that name), or null.</summary>
    public static string? Rule(string rel, IReadOnlyList<string> rules)
    {
        var isFolder = rel.EndsWith('/');
        var parts = rel.TrimEnd('/').Split('/');
        var name = parts[^1];
        foreach (var r in rules)
        {
            if (r.EndsWith('/'))
            {
                var folderPattern = r.TrimEnd('/');
                var folders = isFolder ? parts : parts[..^1];
                if (folders.Any(f => Glob(f, folderPattern))) return r;
            }
            else if (!isFolder && Glob(name, r)) return r;
        }
        return null;
    }

    private static bool Glob(string text, string pattern) =>
        Regex.IsMatch(text, "^" + Regex.Escape(pattern).Replace(@"\*", ".*").Replace(@"\?", ".") + "$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private sealed record Target(string Text, bool Wiki);

    private static IEnumerable<Target> LinkTargets(string text)
    {
        foreach (Match m in MdTarget.Matches(text)) yield return new Target(m.Groups[1].Value.Trim('<', '>'), false);
        foreach (Match m in HtmlSrc.Matches(text)) yield return new Target(m.Groups[1].Value, false);
        foreach (Match m in WikiTarget.Matches(text)) yield return new Target(m.Groups[1].Value.Trim(), true);
    }

    private static (string? Rel, string? Problem) ResolveLocal(string root, string fromRel, Target t, Lazy<List<string>> allFiles)
    {
        if (t.Wiki)
        {
            // [[Note]], or a picture or file by name: ![[photo.png]], [[manual.pdf]].
            var rel = VaultLinkRewriter.ResolveWiki(fromRel, t.Text, allFiles.Value.Where(VaultPaths.IsNote).ToList(), allFiles.Value);
            return rel == null ? (null, VaultPaths.IsNote(t.Text) || !Path.HasExtension(t.Text) ? "no note with that name" : "file not found") : (rel, null);
        }
        var target = t.Text;
        if (target.StartsWith('#') || target.Contains("://") || target.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase) || target.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return (null, "external");
        var cut = target.IndexOfAny(['#', '?']);
        if (cut >= 0) target = target[..cut];
        if (target.Length == 0) return (null, "external");
        string decoded;
        try { decoded = Uri.UnescapeDataString(target).Replace('\\', '/'); } catch (UriFormatException) { return (null, "malformed link"); }
        if (decoded.Contains(':') || decoded.StartsWith('/')) return (null, "absolute path (not packed)");
        var parts = (fromRel.Contains('/') ? fromRel[..fromRel.LastIndexOf('/')] : "").Split('/', StringSplitOptions.RemoveEmptyEntries).ToList();
        foreach (var seg in decoded.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (seg == ".") continue;
            if (seg == "..") { if (parts.Count == 0) return (null, "points outside the Vault (not packed)"); parts.RemoveAt(parts.Count - 1); continue; }
            parts.Add(seg);
        }
        var rel2 = string.Join('/', parts);
        var full = VaultPaths.Resolve(root, rel2);
        if (full == null) return (null, "points outside the Vault (not packed)");
        if (!File.Exists(full)) return (null, Directory.Exists(full) ? "is a folder" : "file not found");
        return (VaultPaths.ToRelative(root, full), null);
    }

    private static string UniqueFlat(string rel, HashSet<string> used)
    {
        var name = rel[(rel.LastIndexOf('/') + 1)..];
        var stem = Path.GetFileNameWithoutExtension(name);
        var ext = Path.GetExtension(name);
        var candidate = name;
        for (int i = 2; used.Contains(candidate); i++) candidate = $"{stem} ({i}){ext}";
        return candidate;
    }

    /// <summary>No absolute paths, drive letters, "..", empty or odd segments: safe to extract anywhere.</summary>
    public static bool SafeEntry(string entry) =>
        entry.Length is > 0 and < 1000 && !entry.StartsWith('/') && !entry.Contains('\\') && !entry.Contains(':') && !entry.Contains('\0')
        && entry.Split('/').All(s => s.Length > 0 && s != "." && s != "..");

    private static string Size(long b) => b < 1024 ? $"{b} B" : b < 1024 * 1024 ? $"{b / 1024.0:0.#} KB" : $"{b / 1048576.0:0.#} MB";

    private static string ManifestText(PackagePlan plan, PackageOptions o)
    {
        var sb = new StringBuilder();
        sb.Append("# Package manifest\n\nGenerated by NoorMD. Lists every file in this archive with its path, type and size.\n\n");
        sb.Append($"- Files: {plan.Files.Count}\n- Total size: {Size(plan.TotalBytes)}\n\n| Path | Type | Size |\n| --- | --- | --- |\n");
        foreach (var f in plan.Files)
        {
            var ext = Path.GetExtension(f.Entry).TrimStart('.').ToLowerInvariant();
            sb.Append($"| {f.Entry.Replace("|", "\\|")} | {(ext.Length == 0 ? "file" : ext)}{(f.Reason == PackReason.Dependency ? " (linked)" : "")} | {Size(f.Size)} |\n");
        }
        return sb.ToString();
    }

    private static string HandoffReadme(PackagePlan plan, PackageOptions o, string folder)
    {
        var sb = new StringBuilder();
        sb.Append("# About this package\n\n");
        sb.Append("This file was generated by NoorMD's “AI Handoff Package” option. It describes how the archive is laid out. ");
        sb.Append("It does not summarize the documents: read them directly.\n\n## Layout\n\n");
        sb.Append($"- {plan.Files.Count} files, {Size(plan.TotalBytes)} in total; {plan.Files.Count(f => VaultPaths.IsNote(f.Entry))} of them are Markdown notes.\n");
        sb.Append(o.PreserveStructure ? "- Folders are kept as they are in the Vault, so relative links between files work.\n" : "- All files are at the top level (folders were flattened); some relative links may not work.\n");
        var top = plan.Files.Select(f => f.Entry.Contains('/') ? f.Entry[..f.Entry.IndexOf('/')] + "/" : f.Entry).Distinct(StringComparer.OrdinalIgnoreCase).Take(30).ToList();
        if (top.Count > 0) sb.Append("- Top level: ").Append(string.Join(", ", top.Select(x => $"`{x}`"))).Append('\n');
        sb.Append($"- `{folder}/MANIFEST.md` lists every file with its type and size.\n");
        var deps = plan.Files.Count(f => f.Reason == PackReason.Dependency);
        if (deps > 0) sb.Append($"- {deps} file{(deps == 1 ? " was" : "s were")} added because a selected note links to {(deps == 1 ? "it" : "them")}.\n");
        if (plan.Unresolved.Count > 0)
        {
            sb.Append("\n## Links that are not in this package\n\n");
            foreach (var u in plan.Unresolved.Take(100)) sb.Append($"- `{u.From}` → `{u.Target}` ({u.Problem})\n");
        }
        var omitted = plan.Dependencies.Where(d => !d.Included).ToList();
        if (omitted.Count > 0)
        {
            sb.Append("\n## Linked files left out\n\n");
            foreach (var d in omitted.Take(100)) sb.Append($"- `{d.Path}` (linked from `{d.LinkedFrom}`)\n");
        }
        if (!string.IsNullOrWhiteSpace(o.HandoffNote))
        {
            sb.Append("\n## Instructions from the sender\n\nWritten by the person who created this package:\n\n");
            foreach (var line in o.HandoffNote.Replace("\r\n", "\n").Split('\n')) sb.Append("> ").Append(line).Append('\n');
        }
        return sb.ToString();
    }
}

public sealed record PackProgress(int Done, int Total, long Bytes);
public sealed record PackFailure(string Entry, string Problem);
public sealed record PackResult(string Path, int Entries, long Bytes, List<PackFailure> Failures);

/// <summary>
/// Writes a plan to a ZIP. The archive is built under a temporary name next to the destination and only renamed to
/// the real name after it is complete and re-read successfully, so a cancelled or failed export never leaves a
/// valid-looking partial ZIP. Source files are only ever opened for reading.
/// </summary>
public static class ZipPackager
{
    public static PackResult Create(PackagePlan plan, string output, IProgress<PackProgress>? progress, CancellationToken ct)
    {
        var dest = Path.GetFullPath(output);
        var dir = Path.GetDirectoryName(dest)!;
        var tmp = Path.Combine(dir, $".{Path.GetFileName(dest)}.{Guid.NewGuid():N}.noormd-tmp");
        var failures = new List<PackFailure>();
        long bytes = 0;
        int entries = 0, done = 0;
        var total = plan.Files.Count + plan.Generated.Count;
        try
        {
            using (var fs = new FileStream(tmp, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
            using (var zip = new ZipArchive(fs, ZipArchiveMode.Create, leaveOpen: false, entryNameEncoding: Encoding.UTF8))
            {
                var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var f in plan.Files)
                {
                    ct.ThrowIfCancellationRequested();
                    if (!PackagePlanner.SafeEntry(f.Entry) || !names.Add(f.Entry)) { failures.Add(new PackFailure(f.Entry, "unsafe or duplicate path")); continue; }
                    var created = false;
                    try
                    {
                        using var file = new FileStream(f.Source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 81920, FileOptions.SequentialScan);
                        // Read first (up to 128 MB), so a file that fails while reading (an offline OneDrive file) is skipped
                        // cleanly instead of leaving half an entry in the archive.
                        System.IO.Stream src = file;
                        if (file.Length <= 128L * 1024 * 1024) { var mem = new MemoryStream((int)file.Length); file.CopyTo(mem); mem.Position = 0; src = mem; }
                        var entry = zip.CreateEntry(f.Entry, IsCompressed(f.Entry) ? CompressionLevel.NoCompression : CompressionLevel.Optimal);
                        created = true;
                        entry.LastWriteTime = File.GetLastWriteTime(f.Source) is var t && t.Year >= 1980 ? t : new DateTime(1980, 1, 1);
                        using (var es = entry.Open())
                        {
                            var buffer = new byte[81920];
                            int n;
                            while ((n = src.Read(buffer, 0, buffer.Length)) > 0)
                            {
                                ct.ThrowIfCancellationRequested();
                                es.Write(buffer, 0, n);
                                bytes += n;
                            }
                        }
                        entries++;
                    }
                    catch (OperationCanceledException) { throw; }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                    {
                        if (created) { entries++; failures.Add(new PackFailure(f.Entry, "only partly copied: " + ex.Message)); }
                        else failures.Add(new PackFailure(f.Entry, ex is FileNotFoundException or DirectoryNotFoundException ? "no longer exists" : (ex.HResult & 0xFFFF) is 32 or 33 ? "locked by another program" : ex.Message));
                    }
                    progress?.Report(new PackProgress(++done, total, bytes));
                }
                foreach (var (entryName, text) in plan.Generated)
                {
                    if (!names.Add(entryName)) continue;
                    var entry = zip.CreateEntry(entryName, CompressionLevel.Optimal);
                    using (var es = entry.Open()) { var b = new UTF8Encoding(false).GetBytes(text); es.Write(b); bytes += b.Length; }
                    entries++;
                    progress?.Report(new PackProgress(++done, total, bytes));
                }
            }
            ct.ThrowIfCancellationRequested();
            // Verify: the archive opens and has every entry we wrote.
            using (var check = ZipFile.OpenRead(tmp))
                if (check.Entries.Count != entries) throw new IOException("The archive could not be verified after writing.");
            File.Move(tmp, dest, overwrite: true);
            return new PackResult(dest, entries, bytes, failures);
        }
        finally
        {
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { /* best effort */ }
        }
    }

    private static readonly string[] Compressed = [".zip", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".mp3", ".m4a", ".ogg", ".opus", ".flac", ".mp4", ".mkv", ".webm", ".7z", ".rar", ".gz", ".pdf", ".noorsketch"];
    private static bool IsCompressed(string entry) => Compressed.Contains(Path.GetExtension(entry), StringComparer.OrdinalIgnoreCase);
}
