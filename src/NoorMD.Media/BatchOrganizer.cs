using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace NoorMD.Media;

/// <summary>What to do with one tag field across a batch. Keep is the default: nothing is touched.</summary>
public enum FieldMode { Keep, Set, Clear }

/// <summary>A tag field rule. With Set, the value may use the same placeholders as file names ({OriginalName}, {n}…).</summary>
public sealed record BatchField(FieldMode Mode, string? Value = null);

/// <summary>How new file names are built. Steps run in this order: template → find/replace → prefix/suffix → underscores → case → spaces → illegal characters.</summary>
public sealed record RenameRules
{
    public bool Enabled { get; init; }
    public string Template { get; init; } = "{OriginalName}";
    public string? Find { get; init; }
    public string? Replace { get; init; }
    public bool Regex { get; init; }
    public bool MatchCase { get; init; }
    public string? Prefix { get; init; }
    public string? Suffix { get; init; }
    /// <summary>none, lower, upper, title, sentence.</summary>
    public string Case { get; init; } = "none";
    public bool UnderscoresToSpaces { get; init; }
    /// <summary>Trim and collapse runs of spaces (also tidies " -  - " left by empty placeholders).</summary>
    public bool TidySpaces { get; init; } = true;
    /// <summary>Replace characters Windows doesn't allow with "-" instead of reporting them.</summary>
    public bool ReplaceIllegal { get; init; }
    public int CounterStart { get; init; } = 1;
    public int CounterStep { get; init; } = 1;
    public int CounterDigits { get; init; } = 2;
}

public sealed record BatchSpec
{
    /// <summary>Keyed by field: title, artist, album, albumArtist, genre, year, trackNumber, comment. Absent = Keep.</summary>
    public IReadOnlyDictionary<string, BatchField> Tags { get; init; } = new Dictionary<string, BatchField>();
    public RenameRules Rename { get; init; } = new();
}

public sealed record TagChange(string Field, string? Old, string? New);

public sealed record BatchItem(long TrackId, string Folder, string OldName, string NewName, IReadOnlyList<TagChange> TagChanges, IReadOnlyList<string> Problems, IReadOnlyList<string> Warnings)
{
    public bool Renames => !string.Equals(OldName, NewName, StringComparison.Ordinal);
    public bool HasChanges => Renames || TagChanges.Count > 0;
    public bool Ok => Problems.Count == 0;
}

public sealed record BatchPreview(IReadOnlyList<BatchItem> Items)
{
    public int WillChange => Items.Count(i => i.Ok && i.HasChanges);
    public int Unchanged => Items.Count(i => i.Ok && !i.HasChanges);
    public int Blocked => Items.Count(i => !i.Ok);
}

public sealed record BatchItemResult(long TrackId, string OldName, string NewName, string Status, string? Message);

public sealed record BatchResult(long? BatchId, IReadOnlyList<BatchItemResult> Items)
{
    public int Done => Items.Count(i => i.Status == "done");
    public int Failed => Items.Count(i => i.Status is "failed" or "partial");
    public int Skipped => Items.Count(i => i.Status == "skipped");
}

/// <summary>
/// Batch Organizer: one set of tag and rename rules applied to many tracks. <see cref="Preview"/> is a dry run that
/// touches nothing and reports every problem per file (collisions inside the batch and on disk, illegal characters,
/// reserved names, long paths). <see cref="Apply"/> only acts on files whose preview was clean, journals each one
/// under a shared batch number, and renames in two phases (all to temporary names, then to the final names) so swaps
/// and chains (A→B, B→C) work without ever overwriting a file. <see cref="Undo"/> reverses a whole batch the same way.
/// The caller releases the files from playback first.
/// </summary>
public sealed class BatchOrganizer(MusicLibrary library)
{
    public const int MaxTracks = 5_000;
    public const int LongPathWarning = 259;
    private static readonly char[] Invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    private static readonly string[] Reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"];
    private static readonly Regex Token = new(@"\{(\w+)(?::(0+))?\}", RegexOptions.CultureInvariant);
    public static readonly string[] Fields = ["title", "artist", "album", "albumArtist", "genre", "year", "trackNumber", "comment"];
    public static readonly string[] Placeholders = ["Title", "Artist", "Album", "AlbumArtist", "Genre", "Year", "TrackNumber", "Comment", "OriginalName", "Folder", "n"];

    /// <summary>Checks the rules themselves (bad regex, unknown placeholder). Throws ArgumentException with a readable message.</summary>
    public static void ValidateSpec(BatchSpec spec)
    {
        var r = spec.Rename;
        if (r.Enabled)
        {
            CheckTemplate(r.Template, "the name template");
            if (string.IsNullOrWhiteSpace(r.Template)) throw new ArgumentException("The name template is empty. Use {OriginalName} to keep the current names.");
        }
        if (r.Enabled && r.Regex && !string.IsNullOrEmpty(r.Find))
        {
            try { _ = new Regex(r.Find, RegexOptions.None, TimeSpan.FromMilliseconds(200)); }
            catch (ArgumentException ex) { throw new ArgumentException("The search pattern is not a valid regular expression: " + ex.Message); }
        }
        if (r.CounterDigits is < 1 or > 6) throw new ArgumentException("The counter needs 1 to 6 digits.");
        foreach (var (field, rule) in spec.Tags)
        {
            if (!Fields.Contains(field)) throw new ArgumentException($"Unknown tag field \"{field}\".");
            if (rule.Mode == FieldMode.Set) CheckTemplate(rule.Value ?? "", $"the {field} value");
        }
    }

    private static void CheckTemplate(string template, string where)
    {
        foreach (Match m in Token.Matches(template))
            if (!Placeholders.Contains(m.Groups[1].Value, StringComparer.OrdinalIgnoreCase))
                throw new ArgumentException($"Unknown placeholder {{{m.Groups[1].Value}}} in {where}. Available: " + string.Join(" ", Placeholders.Select(p => "{" + p + "}")));
    }

    public BatchPreview Preview(IReadOnlyList<long> ids, BatchSpec spec)
    {
        ValidateSpec(spec);
        if (ids.Count > MaxTracks) throw new ArgumentException($"A batch can hold at most {MaxTracks:N0} tracks.");
        var rows = library.GetMany(ids).ToDictionary(t => t.Id);
        var r = spec.Rename;
        Regex? find = r.Enabled && !string.IsNullOrEmpty(r.Find)
            ? new Regex(r.Regex ? r.Find : System.Text.RegularExpressions.Regex.Escape(r.Find), (r.MatchCase ? RegexOptions.None : RegexOptions.IgnoreCase) | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(200))
            : null;

        var drafts = new List<Draft>();
        for (var i = 0; i < ids.Count; i++)
        {
            if (!rows.TryGetValue(ids[i], out var t)) { drafts.Add(new Draft(ids[i], "", "(no longer in the library)", "(no longer in the library)", [], ["This track is no longer in the library."], [])); continue; }
            var problems = new List<string>();
            var warnings = new List<string>();
            var counter = r.CounterStart + i * r.CounterStep;
            var original = Path.GetFileNameWithoutExtension(t.Path);
            if (!File.Exists(t.Path)) problems.Add("The file is missing on disk. Rescan or relink it first.");
            else if (new FileInfo(t.Path).IsReadOnly) problems.Add("The file is read-only.");

            // Tags first: names may use the new values ("set Artist, then rename by Artist").
            var vals = Values(t);
            var changes = new List<TagChange>();
            foreach (var field in Fields)
            {
                if (!spec.Tags.TryGetValue(field, out var rule) || rule.Mode == FieldMode.Keep) continue;
                var old = vals[field];
                string? next;
                if (rule.Mode == FieldMode.Clear) next = null;
                else
                {
                    next = Tidy(Expand(rule.Value ?? "", Values(t), original, t.Folder, counter, r.CounterDigits, null));
                    if (next.Length == 0) next = null;
                    if (next != null && field is "year" or "trackNumber" && !uint.TryParse(next, NumberStyles.None, CultureInfo.InvariantCulture, out _))
                    { problems.Add($"{Label(field)} must be a whole number, not \"{next}\"."); continue; }
                    if (next != null && field is "year" or "trackNumber") next = uint.Parse(next, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture);
                }
                if (!string.Equals(old, next, StringComparison.Ordinal)) changes.Add(new TagChange(field, old, next));
                vals[field] = next;
            }

            var newName = Path.GetFileName(t.Path);
            if (r.Enabled)
            {
                var empty = new List<string>();
                var name = Expand(r.Template, vals, original, t.Folder, counter, r.CounterDigits, empty);
                foreach (var e in empty.Distinct()) warnings.Add($"{{{e}}} is empty for this track.");
                if (r.TidySpaces) name = Tidy(name); // before prefix/suffix, so "{Artist} - {Title}" with no artist loses its dash
                if (find != null)
                {
                    try { name = find.Replace(name, r.Regex ? r.Replace ?? "" : (r.Replace ?? "").Replace("$", "$$")); }
                    catch (RegexMatchTimeoutException) { problems.Add("The search pattern took too long on this name."); }
                }
                name = (r.Prefix ?? "") + name + (r.Suffix ?? "");
                if (r.UnderscoresToSpaces) name = name.Replace('_', ' ');
                name = ApplyCase(name, r.Case);
                if (r.TidySpaces) name = Tidy(name);
                if (r.ReplaceIllegal) name = new string(name.Select(c => Invalid.Contains(c) || char.IsControl(c) ? '-' : c).ToArray()).TrimEnd('.', ' ');
                var ext = Path.GetExtension(t.Path);
                if (name.EndsWith(ext, StringComparison.OrdinalIgnoreCase)) name = name[..^ext.Length];
                problems.AddRange(NameProblems(name, ext));
                newName = name + ext;
                var full = Path.Combine(t.Folder, newName);
                if (full.Length > SafeRename.MaxPathLength) problems.Add("The full path would be too long.");
                else if (full.Length > LongPathWarning && !string.Equals(newName, Path.GetFileName(t.Path), StringComparison.Ordinal))
                    warnings.Add($"The full path is {full.Length} characters; some programs can't open paths longer than 260.");
            }
            drafts.Add(new Draft(t.Id, t.Folder, Path.GetFileName(t.Path), newName, changes, problems, warnings) { Source = t.Path });
        }

        CheckCollisions(drafts);
        return new BatchPreview(drafts.Select(d => new BatchItem(d.TrackId, d.Folder, d.OldName, d.NewName, d.TagChanges, d.Problems, d.Warnings)).ToList());
    }

    private sealed record Draft(long TrackId, string Folder, string OldName, string NewName, List<TagChange> TagChanges, List<string> Problems, List<string> Warnings)
    {
        public string Source { get; init; } = "";
        public string Target => Path.Combine(Folder, NewName);
        public bool Renames => Problems.Count == 0 && Source.Length > 0 && !string.Equals(OldName, NewName, StringComparison.Ordinal);
    }

    /// <summary>
    /// Two files of the batch must not get the same name; a target may not be taken on disk unless the file there is
    /// itself renamed away by this batch. Repeats until stable, because a blocked file stays where it is and can then
    /// block the file that wanted its name.
    /// </summary>
    private static void CheckCollisions(List<Draft> drafts)
    {
        foreach (var g in drafts.Where(d => d.Renames || (d.Problems.Count == 0 && d.Source.Length > 0)).GroupBy(d => MusicLibrary.PathKey(d.Target)).Where(g => g.Count() > 1))
            foreach (var d in g)
                d.Problems.Add($"{g.Count()} files in this batch would be named \"{d.NewName}\". Add {{n}} or {{TrackNumber}} to the template.");
        bool changed;
        do
        {
            changed = false;
            var leaving = drafts.Where(d => d.Renames).Select(d => MusicLibrary.PathKey(d.Source)).ToHashSet();
            foreach (var d in drafts.Where(d => d.Renames))
            {
                var key = MusicLibrary.PathKey(d.Target);
                if (key == MusicLibrary.PathKey(d.Source)) continue; // case-only change
                if ((File.Exists(d.Target) || Directory.Exists(d.Target)) && !leaving.Contains(key))
                {
                    d.Problems.Add(drafts.Any(o => MusicLibrary.PathKey(o.Source) == key)
                        ? $"\"{d.NewName}\" belongs to another file of this batch that can't be renamed (see its problems)."
                        : $"A file named \"{d.NewName}\" already exists in this folder.");
                    changed = true;
                }
            }
        } while (changed);
    }

    public BatchResult Apply(IReadOnlyList<long> ids, BatchSpec spec)
    {
        var preview = Preview(ids, spec);
        var batchId = library.NextBatchId();
        var results = new Dictionary<long, BatchItemResult>();
        var work = new List<(BatchItem Item, string Source, long Journal)>();
        foreach (var item in preview.Items)
        {
            if (!item.Ok) { results[item.TrackId] = new(item.TrackId, item.OldName, item.NewName, "skipped", string.Join(" ", item.Problems)); continue; }
            if (!item.HasChanges) { results[item.TrackId] = new(item.TrackId, item.OldName, item.NewName, "unchanged", null); continue; }
            var source = Path.Combine(item.Folder, item.OldName);
            var journal = library.JournalBegin(item.TrackId, source, Path.Combine(item.Folder, item.NewName), TagIO.Read(source), ToEdit(item.TagChanges), batchId);
            work.Add((item, source, journal));
        }

        // 1. Tags. A file whose tags can't be written is not renamed either.
        var current = new Dictionary<long, string>();
        var notes = new Dictionary<long, string>();
        foreach (var (item, source, journal) in work)
        {
            current[item.TrackId] = source;
            if (item.TagChanges.Count == 0) continue;
            try { TagIO.Write(source, ToEdit(item.TagChanges)!); }
            catch (MetadataException ex)
            {
                results[item.TrackId] = new(item.TrackId, item.OldName, item.OldName, "failed", ex.Message + (item.Renames ? " The file was not renamed either." : ""));
                library.JournalFinish(journal, "failed", source, null, null, ex.Message);
            }
        }
        var renames = work.Where(w => w.Item.Renames && !results.ContainsKey(w.Item.TrackId)).ToList();

        // 2. Rename phase one: every renaming file to a temporary name in its folder.
        var temps = new Dictionary<long, string>();
        foreach (var (item, source, _) in renames)
        {
            var tmp = Path.Combine(item.Folder, $".noormd-batch-{Guid.NewGuid():N}{Path.GetExtension(source)}");
            try { File.Move(source, tmp, overwrite: false); temps[item.TrackId] = tmp; current[item.TrackId] = tmp; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { notes[item.TrackId] = $"The file was not renamed: {ex.Message}"; }
        }
        // 3. Phase two: temporary → final name (never overwriting). On failure, back to the original name.
        foreach (var (item, source, _) in renames)
        {
            if (!temps.TryGetValue(item.TrackId, out var tmp)) continue;
            var target = Path.Combine(item.Folder, item.NewName);
            try { File.Move(tmp, target, overwrite: false); current[item.TrackId] = target; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                notes[item.TrackId] = $"The file was not renamed: {ex.Message}";
                try { File.Move(tmp, source, overwrite: false); current[item.TrackId] = source; }
                catch (Exception) { notes[item.TrackId] += $" It was left as \"{Path.GetFileName(tmp)}\"; rename it by hand."; }
            }
        }

        // 4. Index and journal.
        library.RefreshMany(work.Where(w => !results.ContainsKey(w.Item.TrackId)).Select(w => (w.Item.TrackId, current[w.Item.TrackId])).ToList());
        foreach (var (item, source, journal) in work)
        {
            if (results.ContainsKey(item.TrackId)) continue;
            var path = current[item.TrackId];
            var note = notes.GetValueOrDefault(item.TrackId);
            var tagged = item.TagChanges.Count > 0;
            var status = note == null ? "done" : tagged ? "partial" : "failed";
            library.JournalFinish(journal, status == "failed" ? "failed" : status, path, Fingerprint.Compute(path), TagIO.Read(path), note == null ? null : (tagged ? note + " The tag changes were saved." : note));
            results[item.TrackId] = new(item.TrackId, item.OldName, Path.GetFileName(path), status, note == null ? null : (tagged ? note + " The tag changes were saved." : note));
        }
        var ordered = preview.Items.Select(i => results[i.TrackId]).ToList();
        return new BatchResult(work.Count > 0 ? batchId : null, ordered);
    }

    /// <summary>
    /// Reverses a batch: names back (two-phase, so swaps undo too) and the previous tags restored. Files changed or moved
    /// since the batch are skipped with a reason; the rest are still undone.
    /// </summary>
    public BatchResult Undo(long batchId)
    {
        var entries = library.BatchJournal(batchId).Where(e => e.Status is "done" or "partial").ToList();
        if (entries.Count == 0) return new BatchResult(batchId, []);
        var results = new Dictionary<long, BatchItemResult>();
        var ok = new List<MusicLibrary.JournalEntry>();
        foreach (var e in entries)
        {
            string? why = null;
            if (!File.Exists(e.NewPath)) why = $"\"{Path.GetFileName(e.NewPath)}\" was moved or deleted since the batch.";
            else if (e.NewFingerprint != null && Fingerprint.Compute(e.NewPath) != e.NewFingerprint) why = "The file was modified after the batch, so undoing it could lose newer changes.";
            if (why != null) results[e.Id] = new(e.TrackId, Path.GetFileName(e.NewPath), Path.GetFileName(e.NewPath), "skipped", why);
            else ok.Add(e);
        }
        var movingBack = ok.Where(e => !string.Equals(e.OldPath, e.NewPath, StringComparison.Ordinal)).ToList();
        var leaving = movingBack.Select(e => MusicLibrary.PathKey(e.NewPath)).ToHashSet();
        foreach (var e in movingBack.ToList())
        {
            var key = MusicLibrary.PathKey(e.OldPath);
            if (key != MusicLibrary.PathKey(e.NewPath) && File.Exists(e.OldPath) && !leaving.Contains(key))
            {
                results[e.Id] = new(e.TrackId, Path.GetFileName(e.NewPath), Path.GetFileName(e.NewPath), "skipped", $"Another file is now named \"{Path.GetFileName(e.OldPath)}\".");
                ok.Remove(e); movingBack.Remove(e);
            }
        }
        var current = ok.ToDictionary(e => e.Id, e => e.NewPath);
        var temps = new Dictionary<long, string>();
        var notes = new Dictionary<long, string>();
        foreach (var e in movingBack)
        {
            var tmp = Path.Combine(Path.GetDirectoryName(e.NewPath)!, $".noormd-undo-{Guid.NewGuid():N}{Path.GetExtension(e.NewPath)}");
            try { File.Move(e.NewPath, tmp, overwrite: false); temps[e.Id] = tmp; current[e.Id] = tmp; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { notes[e.Id] = "The name could not be restored: " + ex.Message; }
        }
        foreach (var e in movingBack)
        {
            if (!temps.TryGetValue(e.Id, out var tmp)) continue;
            try { File.Move(tmp, e.OldPath, overwrite: false); current[e.Id] = e.OldPath; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                notes[e.Id] = "The name could not be restored: " + ex.Message;
                try { File.Move(tmp, e.NewPath, overwrite: false); current[e.Id] = e.NewPath; } catch { notes[e.Id] += $" It was left as \"{Path.GetFileName(tmp)}\"."; }
            }
        }
        foreach (var e in ok)
        {
            if (e.OldTags == null || e.NewTags == null || SameTags(e.OldTags, e.NewTags)) continue;
            try { TagIO.Write(current[e.Id], TagEdit.RestoreTo(e.OldTags)); }
            catch (MetadataException ex) { notes[e.Id] = (notes.GetValueOrDefault(e.Id) is { } n ? n + " " : "") + "The old tags could not be written back: " + ex.Message; }
        }
        library.RefreshMany(ok.Select(e => (e.TrackId, current[e.Id])).ToList());
        foreach (var e in ok)
        {
            var path = current[e.Id];
            var note = notes.GetValueOrDefault(e.Id);
            library.JournalFinish(e.Id, note == null ? "undone" : "undo-partial", path, Fingerprint.Compute(path), null, note);
            results[e.Id] = new(e.TrackId, Path.GetFileName(e.NewPath), Path.GetFileName(path), note == null ? "done" : "failed", note);
        }
        return new BatchResult(batchId, entries.Select(e => results[e.Id]).ToList());
    }

    // ------------------------------------------------------------------ helpers

    private static bool SameTags(TrackTags a, TrackTags b) =>
        a.Title == b.Title && a.Artist == b.Artist && a.Album == b.Album && a.AlbumArtist == b.AlbumArtist && a.Genre == b.Genre
        && a.Year == b.Year && a.TrackNumber == b.TrackNumber && a.Comment == b.Comment;

    private static Dictionary<string, string?> Values(TrackRow t) => new()
    {
        ["title"] = t.Title, ["artist"] = t.Artist, ["album"] = t.Album, ["albumArtist"] = t.AlbumArtist, ["genre"] = t.Genre,
        ["year"] = t.Year is > 0 ? t.Year.Value.ToString(CultureInfo.InvariantCulture) : null,
        ["trackNumber"] = t.TrackNumber is > 0 ? t.TrackNumber.Value.ToString(CultureInfo.InvariantCulture) : null,
        ["comment"] = t.Comment,
    };

    private static string Label(string field) => field switch { "albumArtist" => "Album artist", "trackNumber" => "Track number", _ => char.ToUpperInvariant(field[0]) + field[1..] };

    private static TagEdit? ToEdit(IReadOnlyList<TagChange> changes)
    {
        if (changes.Count == 0) return null;
        string? S(string f) => changes.FirstOrDefault(c => c.Field == f) is { } c ? c.New ?? "" : null;
        uint? N(string f) => changes.FirstOrDefault(c => c.Field == f) is { } c ? (c.New == null ? 0u : uint.Parse(c.New, CultureInfo.InvariantCulture)) : null;
        return new TagEdit { Title = S("title"), Artist = S("artist"), Album = S("album"), AlbumArtist = S("albumArtist"), Genre = S("genre"), Year = N("year"), TrackNumber = N("trackNumber"), Comment = S("comment") };
    }

    /// <summary>Fills placeholders. {TrackNumber:00} and {n:000} pad with zeros; {n} uses the counter's digit setting.</summary>
    public static string Expand(string template, IReadOnlyDictionary<string, string?> vals, string originalName, string folder, int counter, int digits, List<string>? empty)
    {
        return Token.Replace(template, m =>
        {
            var key = m.Groups[1].Value;
            var pad = m.Groups[2].Success ? m.Groups[2].Value.Length : 0;
            string? v = key.ToLowerInvariant() switch
            {
                "originalname" => originalName,
                "folder" => Path.GetFileName(folder.TrimEnd('\\', '/')),
                "n" => counter.ToString(CultureInfo.InvariantCulture).PadLeft(pad > 0 ? pad : digits, '0'),
                "title" => vals["title"], "artist" => vals["artist"], "album" => vals["album"], "albumartist" => vals["albumArtist"],
                "genre" => vals["genre"], "year" => vals["year"], "tracknumber" => vals["trackNumber"], "comment" => vals["comment"],
                _ => m.Value,
            };
            if (string.IsNullOrEmpty(v)) { empty?.Add(m.Groups[1].Value); return ""; }
            return pad > 0 && v.All(char.IsAsciiDigit) ? v.PadLeft(pad, '0') : v;
        });
    }

    /// <summary>Trims, collapses spaces and removes separators left dangling by empty placeholders ("- Title" → "Title").</summary>
    public static string Tidy(string s)
    {
        s = System.Text.RegularExpressions.Regex.Replace(s, @"\s+", " ");
        s = System.Text.RegularExpressions.Regex.Replace(s, @"(\s*[-–_·.,]\s*){2,}", m => " " + m.Value.Trim()[0] + " ");
        s = System.Text.RegularExpressions.Regex.Replace(s, @"\(\s*\)|\[\s*\]", "");
        s = s.Trim().Trim('-', '–', '_', '·', ',').Trim();
        return System.Text.RegularExpressions.Regex.Replace(s, @"\s{2,}", " ");
    }

    public static string ApplyCase(string s, string mode) => mode switch
    {
        "lower" => s.ToLower(CultureInfo.CurrentCulture),
        "upper" => s.ToUpper(CultureInfo.CurrentCulture),
        "title" => TitleCase(s),
        "sentence" => s.Length == 0 ? s : char.ToUpper(s[0], CultureInfo.CurrentCulture) + s[1..].ToLower(CultureInfo.CurrentCulture),
        _ => s,
    };

    private static string TitleCase(string s)
    {
        var sb = new StringBuilder(s.Length);
        var start = true;
        foreach (var c in s)
        {
            sb.Append(start ? char.ToUpper(c, CultureInfo.CurrentCulture) : char.ToLower(c, CultureInfo.CurrentCulture));
            start = char.IsWhiteSpace(c) || c is '-' or '(' or '[' or '_' or '.';
        }
        return sb.ToString();
    }

    private static IEnumerable<string> NameProblems(string name, string ext)
    {
        if (name.Length == 0) { yield return "The new name is empty."; yield break; }
        if (name.IndexOfAny(Invalid) >= 0 || name.Any(char.IsControl))
            yield return "The name contains characters Windows doesn't allow: " + string.Join(" ", name.Where(c => Invalid.Contains(c) || char.IsControl(c)).Distinct().Select(c => char.IsControl(c) ? "(control)" : c.ToString())) + ". Tick “Replace characters Windows doesn't allow”.";
        if (name.EndsWith('.') || name.StartsWith(' ') || name.EndsWith(' ')) yield return "Windows file names can't end with a dot or start or end with a space.";
        if (Reserved.Contains(name.Split('.')[0], StringComparer.OrdinalIgnoreCase)) yield return $"\"{name}\" is a reserved name on Windows.";
        if (name.Length + ext.Length > SafeRename.MaxNameLength) yield return $"The name is too long ({name.Length + ext.Length} characters; at most {SafeRename.MaxNameLength}).";
    }
}
