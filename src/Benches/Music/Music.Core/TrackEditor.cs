namespace Music.Core;

/// <summary>Result of an edit. Partial success is reported honestly (e.g. tags saved but rename refused).</summary>
public sealed record EditResult(bool TagsSaved, bool Renamed, string Path, TrackRow? Track, IReadOnlyList<string> Problems, long? JournalId)
{
    public bool Ok => Problems.Count == 0;
}

/// <summary>
/// Applies "Edit current track" changes: tags and/or file name, independently. Order of operations:
///  1. validate the rename completely (nothing touched if it would fail),
///  2. journal the old state,
///  3. write tags and verify them,
///  4. rename (never overwriting),
///  5. update the index (same id, so playlists, queue and triage stay attached) and finish the journal.
/// The caller is responsible for releasing the file from playback before step 3 (see MainWindow.Music).
/// </summary>
public sealed class TrackEditor(MusicLibrary library)
{
    /// <summary>Checks a proposed edit without touching anything.</summary>
    public IReadOnlyList<string> Validate(long trackId, string? newFileName)
    {
        var track = library.Get(trackId);
        if (track == null) return ["This track is no longer in the library."];
        if (!File.Exists(track.Path)) return [$"\"{track.FileName}\" is missing on disk. Rescan or relink it first."];
        var problems = new List<string>();
        if (newFileName != null)
        {
            var plan = SafeRename.Plan(track.Path, newFileName);
            problems.AddRange(plan.Problems);
        }
        if (new FileInfo(track.Path).IsReadOnly) problems.Add($"\"{track.FileName}\" is read-only.");
        return problems;
    }

    public EditResult Apply(long trackId, TagEdit? tags, string? newFileName)
    {
        var track = library.Get(trackId);
        if (track == null) return Fail("This track is no longer in the library.");
        if (!File.Exists(track.Path)) return Fail($"\"{track.FileName}\" is missing on disk. Rescan or relink it first.");

        RenamePlan? plan = null;
        if (newFileName != null)
        {
            plan = SafeRename.Plan(track.Path, newFileName);
            if (!plan.Ok) return new EditResult(false, false, track.Path, track, plan.Problems, null);
            if (plan.IsNoOp) plan = null;
        }
        var wantsTags = tags is { IsEmpty: false };
        if (!wantsTags && plan == null) return new EditResult(false, false, track.Path, track, [], null);

        var oldTags = TagIO.Read(track.Path);
        var journal = library.JournalBegin(trackId, track.Path, plan?.TargetPath ?? track.Path, oldTags, tags);
        var problems = new List<string>();
        bool tagsSaved = false, renamed = false;
        var path = track.Path;

        if (wantsTags)
        {
            try { TagIO.Write(path, tags!); tagsSaved = true; }
            catch (MetadataException ex) when (ex.Written)
            {
                tagsSaved = true;
                problems.Add(ex.Message + (plan != null ? " The file was not renamed." : "") + " (The change can be undone.)");
            }
            catch (Exception ex) when (ex is MetadataException or IOException or UnauthorizedAccessException)
            {
                library.JournalFinish(journal, "failed", path, null, null, ex.Message);   // nothing changed: never left half-open
                return new EditResult(false, false, path, track, [ex.Message + (plan != null ? " The file was not renamed either." : "")], journal);
            }
        }
        if (plan != null && problems.Count == 0)
        {
            try { path = SafeRename.Execute(plan); renamed = true; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
            {
                problems.Add($"The file was not renamed: {ex.Message}" + (tagsSaved ? " The tag changes were saved." : ""));
            }
        }

        // The journal first: whatever happens to the library row, the edit can be undone.
        string? fp = null; TrackTags? nowTags = null;
        try { fp = Fingerprint.Compute(path); nowTags = TagIO.Read(path); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* undo then skips the "changed since?" check it can't make */ }
        library.JournalFinish(journal, problems.Count == 0 ? "done" : "partial", path, fp, nowTags, problems.Count == 0 ? null : string.Join(" ", problems));
        TrackRow? row;
        try { row = library.Refresh(trackId, path); }
        catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException or IOException)
        {
            problems.Add("The library could not be updated (a rescan fixes it): " + ex.Message);
            row = library.Get(trackId);
        }
        return new EditResult(tagsSaved, renamed, path, row, problems, journal);

        EditResult Fail(string message) => new(false, false, track?.Path ?? "", track, [message], null);
    }

    /// <summary>
    /// Reverts a journal entry: renames back and restores the previous tags. Refuses (and explains) if the file
    /// was changed or moved since the edit, or if the old name is taken by another file now.
    /// </summary>
    public EditResult Undo(long journalId)
    {
        var entry = library.Journal(500).FirstOrDefault(j => j.Id == journalId);
        if (entry == null) return new EditResult(false, false, "", null, ["That change is no longer in the history."], null);
        if (entry.Status is not ("done" or "partial")) return new EditResult(false, false, entry.NewPath, null, [$"That change can't be undone (status: {entry.Status})."], journalId);
        if (!File.Exists(entry.NewPath)) return new EditResult(false, false, entry.NewPath, null, [$"\"{Path.GetFileName(entry.NewPath)}\" was moved or deleted since the change, so it can't be undone safely."], journalId);
        if ((entry.NewFingerprint != null && Fingerprint.Compute(entry.NewPath) != entry.NewFingerprint)
            || (entry.NewTags != null && !TagEdit.SameTags(TagIO.Read(entry.NewPath), entry.NewTags)))
            return new EditResult(false, false, entry.NewPath, null, ["The file was modified after this change (by NoorMD or another program), so undoing it could lose newer changes."], journalId);

        var path = entry.NewPath;
        var problems = new List<string>();
        bool renamed = false, tagsSaved = false;
        if (!string.Equals(entry.OldPath, entry.NewPath, StringComparison.Ordinal))
        {
            var plan = SafeRename.Plan(entry.NewPath, Path.GetFileName(entry.OldPath));
            if (!plan.Ok || !string.Equals(Path.GetDirectoryName(plan.TargetPath), Path.GetDirectoryName(entry.OldPath), StringComparison.OrdinalIgnoreCase))
                return new EditResult(false, false, path, library.Get(entry.TrackId), plan.Problems.Count > 0 ? plan.Problems : ["The original location is no longer available."], journalId);
            path = SafeRename.Execute(plan);
            renamed = true;
        }
        if (entry.OldTags != null)
        {
            var restore = TagEdit.RestoreTo(entry.OldTags, entry.NewTags);
            try { if (!restore.IsEmpty) TagIO.Write(path, restore); tagsSaved = true; }
            catch (MetadataException ex) when (ex.Written) { tagsSaved = true; problems.Add("The old tags were written back but couldn't be checked: " + ex.Message); }
            catch (Exception ex) when (ex is MetadataException or IOException or UnauthorizedAccessException) { problems.Add((renamed ? "The name was restored but the old tags" : "The old tags") + " could not be written back: " + ex.Message); }
        }
        if (!renamed && !tagsSaved) return new EditResult(false, false, path, library.Get(entry.TrackId), problems, journalId);   // nothing changed: try again later
        // The journal first (the file is already back): a library hiccup must not leave this change "undoable" twice.
        library.JournalFinish(journalId, "undone", entry.NewPath, entry.NewFingerprint, null, problems.Count == 0 ? null : string.Join(" ", problems));
        TrackRow? row;
        try { row = library.Refresh(entry.TrackId, path); }
        catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException or IOException)
        {
            problems.Add("The library could not be updated (a rescan fixes it): " + ex.Message);
            row = library.Get(entry.TrackId);
        }
        return new EditResult(tagsSaved, renamed, path, row, problems, journalId);
    }

    public MusicLibrary.JournalEntry? LastUndoable() => library.Journal(50).FirstOrDefault(j => j.Status is "done" or "partial");
}
