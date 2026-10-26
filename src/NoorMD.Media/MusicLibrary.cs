using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace NoorMD.Media;

/// <summary>Triage states for organising large collections while listening.</summary>
public enum Triage { None = 0, Favorite = 1, Keep = 2, Maybe = 3, Skip = 4 }

public sealed record TrackRow(
    long Id, string Path, string? Title, string? Artist, string? Album, string? AlbumArtist, string? Genre,
    uint? Year, uint? TrackNumber, string? Comment, double Duration, bool HasArtwork, Triage Triage, bool Missing,
    string? ReadError, long Size, DateTime AddedUtc, int PlayCount)
{
    public string FileName => System.IO.Path.GetFileName(Path);
    public string Folder => System.IO.Path.GetDirectoryName(Path) ?? "";
    public string DisplayTitle => Title ?? System.IO.Path.GetFileNameWithoutExtension(Path);
    public TrackTags Tags => new()
    {
        Title = Title, Artist = Artist, Album = Album, AlbumArtist = AlbumArtist, Genre = Genre, Year = Year,
        TrackNumber = TrackNumber, Comment = Comment, DurationSeconds = Duration, HasArtwork = HasArtwork,
    };
}

public sealed record LibraryFolder(long Id, string Path, bool Recursive, int TrackCount, DateTime? LastScanUtc);
public sealed record PlaylistInfo(long Id, string Name, int Count);
public sealed record LibraryQuery(string? Search = null, Triage? Triage = null, bool MissingOnly = false, long? PlaylistId = null,
    string Sort = "title", bool Descending = false, int Offset = 0, int Limit = 200);
public sealed record QueryResult(int Total, IReadOnlyList<TrackRow> Rows);
public sealed record LibraryStats(int Total, int Missing, int Favorite, int Keep, int Maybe, int Skip, int Untriaged);

public sealed record ScanProgress(long FolderId, string Phase, int Discovered, int Processed, int Added, int Updated, int Relinked, int MarkedMissing, int Errors, string? Message = null);

/// <summary>
/// The local music index (SQLite). Audio files stay authoritative for media and embedded tags; the index stores
/// references, triage, playlists and session state. Tracks are identified by an internal id, never by path,
/// so renames don't break playlists, the queue or triage marks. Nothing here moves or modifies audio files.
/// </summary>
public sealed class MusicLibrary
{
    private readonly string _connectionString;
    private const int SchemaVersion = 2;

    public string DatabasePath { get; }

    public MusicLibrary(string databasePath)
    {
        DatabasePath = databasePath;
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(databasePath)!);
        _connectionString = new SqliteConnectionStringBuilder { DataSource = databasePath, Mode = SqliteOpenMode.ReadWriteCreate, Cache = SqliteCacheMode.Shared, Pooling = true }.ToString();
        using var c = Open();
        Exec(c, "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
        var version = Convert.ToInt32(Scalar(c, "PRAGMA user_version"), CultureInfo.InvariantCulture);
        if (version < 1)
        {
            Exec(c, """
                CREATE TABLE IF NOT EXISTS folders (id INTEGER PRIMARY KEY, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE, recursive INTEGER NOT NULL DEFAULT 1, last_scan TEXT);
                CREATE TABLE IF NOT EXISTS tracks (
                  id INTEGER PRIMARY KEY, folder_id INTEGER, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE,
                  size INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL DEFAULT 0, fingerprint TEXT,
                  title TEXT, artist TEXT, album TEXT, album_artist TEXT, genre TEXT, year INTEGER, track_no INTEGER, comment TEXT,
                  duration REAL NOT NULL DEFAULT 0, has_art INTEGER NOT NULL DEFAULT 0, read_error TEXT,
                  triage INTEGER NOT NULL DEFAULT 0, missing INTEGER NOT NULL DEFAULT 0, added TEXT NOT NULL, play_count INTEGER NOT NULL DEFAULT 0, last_played TEXT,
                  sort_title TEXT NOT NULL DEFAULT '', sort_name TEXT NOT NULL DEFAULT '', sort_folder TEXT NOT NULL DEFAULT '', search TEXT NOT NULL DEFAULT '');
                CREATE INDEX IF NOT EXISTS ix_tracks_folder ON tracks(folder_id);
                CREATE INDEX IF NOT EXISTS ix_tracks_fp ON tracks(fingerprint);
                CREATE INDEX IF NOT EXISTS ix_tracks_title ON tracks(sort_title);
                CREATE INDEX IF NOT EXISTS ix_tracks_triage ON tracks(triage);
                CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS playlist_items (playlist_id INTEGER NOT NULL, position INTEGER NOT NULL, track_id INTEGER NOT NULL, PRIMARY KEY (playlist_id, position));
                CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY, utc TEXT NOT NULL, track_id INTEGER NOT NULL, old_path TEXT NOT NULL, new_path TEXT NOT NULL,
                  old_tags TEXT, new_tags TEXT, new_fingerprint TEXT, status TEXT NOT NULL, note TEXT);
                CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                """);
        }
        if (version < 2) Exec(c, "ALTER TABLE journal ADD COLUMN batch_id INTEGER; CREATE INDEX IF NOT EXISTS ix_journal_batch ON journal(batch_id);");
        if (version < SchemaVersion) Exec(c, $"PRAGMA user_version = {SchemaVersion}");
    }

    private SqliteConnection Open() { var c = new SqliteConnection(_connectionString); c.Open(); return c; }
    private static void Exec(SqliteConnection c, string sql, SqliteTransaction? tx = null) { using var cmd = c.CreateCommand(); cmd.Transaction = tx; cmd.CommandText = sql; cmd.ExecuteNonQuery(); }
    private static object? Scalar(SqliteConnection c, string sql) { using var cmd = c.CreateCommand(); cmd.CommandText = sql; return cmd.ExecuteScalar(); }
    private static SqliteCommand Cmd(SqliteConnection c, string sql, SqliteTransaction? tx = null, params (string, object?)[] args)
    {
        var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        cmd.Transaction = tx;
        foreach (var (n, v) in args) cmd.Parameters.AddWithValue(n, v ?? DBNull.Value);
        return cmd;
    }

    public static string PathKey(string path) => System.IO.Path.GetFullPath(path).ToUpperInvariant();
    private static string Iso(DateTime d) => d.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
    private static DateTime ParseIso(string s) => DateTime.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

    // ------------------------------------------------------------------ folders

    public long AddFolder(string path, bool recursive = true)
    {
        var full = System.IO.Path.GetFullPath(path);
        if (!Directory.Exists(full)) throw new DirectoryNotFoundException($"\"{full}\" does not exist.");
        using var c = Open();
        using (var ins = Cmd(c, "INSERT OR IGNORE INTO folders(path, path_key, recursive) VALUES ($p, $k, $r)", null, ("$p", full), ("$k", PathKey(full)), ("$r", recursive ? 1 : 0)))
            ins.ExecuteNonQuery();
        using var sel = Cmd(c, "SELECT id FROM folders WHERE path_key = $k", null, ("$k", PathKey(full)));
        return (long)sel.ExecuteScalar()!;
    }

    public IReadOnlyList<LibraryFolder> Folders()
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT f.id, f.path, f.recursive, (SELECT COUNT(*) FROM tracks t WHERE t.folder_id = f.id), f.last_scan FROM folders f ORDER BY f.path");
        using var r = cmd.ExecuteReader();
        var list = new List<LibraryFolder>();
        while (r.Read()) list.Add(new LibraryFolder(r.GetInt64(0), r.GetString(1), r.GetInt64(2) == 1, r.GetInt32(3), r.IsDBNull(4) ? null : ParseIso(r.GetString(4))));
        return list;
    }

    /// <summary>Removes a folder and its tracks from the index. Files on disk are not touched.</summary>
    public void RemoveFolder(long folderId)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        using (var a = Cmd(c, "DELETE FROM playlist_items WHERE track_id IN (SELECT id FROM tracks WHERE folder_id = $f)", tx, ("$f", folderId))) a.ExecuteNonQuery();
        using (var b = Cmd(c, "DELETE FROM tracks WHERE folder_id = $f", tx, ("$f", folderId))) b.ExecuteNonQuery();
        using (var d = Cmd(c, "DELETE FROM folders WHERE id = $f", tx, ("$f", folderId))) d.ExecuteNonQuery();
        tx.Commit();
    }

    // ------------------------------------------------------------------ scanning

    private sealed record Known(long Id, long Size, long Mtime, bool Missing);

    /// <summary>
    /// Incremental scan of one folder. Unchanged files (same size and modification time) are skipped; new files
    /// are indexed; files moved outside NoorMD are relinked by fingerprint; vanished files are marked missing,
    /// never deleted. If the folder itself is unavailable (unplugged drive) nothing is marked missing.
    /// </summary>
    public ScanProgress ScanFolder(long folderId, IProgress<ScanProgress>? progress = null, CancellationToken ct = default)
    {
        string root; bool recursive;
        using (var c0 = Open())
        using (var cmd = Cmd(c0, "SELECT path, recursive FROM folders WHERE id = $id", null, ("$id", folderId)))
        using (var r = cmd.ExecuteReader())
        {
            if (!r.Read()) throw new ArgumentException("Unknown folder.");
            root = r.GetString(0); recursive = r.GetInt64(1) == 1;
        }
        if (!Directory.Exists(root))
        {
            var unavailable = new ScanProgress(folderId, "unavailable", 0, 0, 0, 0, 0, 0, 0, $"\"{root}\" is not available (disconnected drive?). Nothing was marked missing.");
            progress?.Report(unavailable);
            return unavailable;
        }

        progress?.Report(new ScanProgress(folderId, "discovering", 0, 0, 0, 0, 0, 0, 0));
        var opts = new EnumerationOptions { RecurseSubdirectories = recursive, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.System, MatchCasing = MatchCasing.CaseInsensitive };
        var files = new List<string>();
        foreach (var f in Directory.EnumerateFiles(root, "*", opts))
        {
            ct.ThrowIfCancellationRequested();
            if (AudioFormats.IsAudio(f) && !System.IO.Path.GetFileName(f).StartsWith(".noormd-", StringComparison.Ordinal)) files.Add(f);
        }

        var known = new Dictionary<string, Known>();
        using (var c1 = Open())
        using (var cmd = Cmd(c1, "SELECT id, path_key, size, mtime, missing FROM tracks WHERE folder_id = $f", null, ("$f", folderId)))
        using (var r = cmd.ExecuteReader())
            while (r.Read()) known[r.GetString(1)] = new Known(r.GetInt64(0), r.GetInt64(2), r.GetInt64(3), r.GetInt64(4) == 1);

        int processed = 0, added = 0, updated = 0, relinked = 0, errors = 0, missing = 0;
        var seen = new HashSet<long>();
        using var c = Open();
        SqliteTransaction? tx = c.BeginTransaction();
        try
        {
            // Mark vanished files missing *first*, so files moved within this scan can be relinked to them.
            var discovered = new HashSet<string>(files.Select(PathKey));
            foreach (var (key, k) in known)
            {
                if (discovered.Contains(key) || k.Missing) continue;
                using var m = Cmd(c, "UPDATE tracks SET missing = 1 WHERE id = $id", tx, ("$id", k.Id));
                m.ExecuteNonQuery();
                missing++;
            }

            foreach (var file in files)
            {
                ct.ThrowIfCancellationRequested();
                processed++;
                try
                {
                    var info = new FileInfo(file);
                    var key = PathKey(file);
                    var mtime = info.LastWriteTimeUtc.Ticks;
                    if (known.TryGetValue(key, out var k))
                    {
                        seen.Add(k.Id);
                        if (k.Size == info.Length && k.Mtime == mtime)
                        {
                            if (k.Missing) { using var u = Cmd(c, "UPDATE tracks SET missing = 0 WHERE id = $id", tx, ("$id", k.Id)); u.ExecuteNonQuery(); }
                            continue;
                        }
                        WriteScanned(c, tx, k.Id, folderId, file, info, mtime);
                        updated++;
                        continue;
                    }
                    var fp = Fingerprint.Compute(file);
                    long? relinkId = null;
                    using (var find = Cmd(c, "SELECT id FROM tracks WHERE fingerprint = $fp AND missing = 1 LIMIT 1", tx, ("$fp", fp)))
                        if (find.ExecuteScalar() is long rid) relinkId = rid;
                    if (relinkId is long id)
                    {
                        WriteScanned(c, tx, id, folderId, file, info, mtime, fp);
                        seen.Add(id);
                        relinked++;
                    }
                    else
                    {
                        using var ins = Cmd(c, "INSERT INTO tracks(folder_id, path, path_key, added) VALUES ($f, $p, $k, $a) RETURNING id", tx,
                            ("$f", folderId), ("$p", file), ("$k", key), ("$a", Iso(DateTime.UtcNow)));
                        var newId = (long)ins.ExecuteScalar()!;
                        WriteScanned(c, tx, newId, folderId, file, info, mtime, fp);
                        seen.Add(newId);
                        added++;
                    }
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { errors++; }

                if (processed % 250 == 0)
                {
                    tx.Commit(); tx.Dispose(); tx = c.BeginTransaction();
                    progress?.Report(new ScanProgress(folderId, "indexing", files.Count, processed, added, updated, relinked, 0, errors));
                }
            }

            missing -= relinked; // relinked tracks were only provisionally missing
            using (var ls = Cmd(c, "UPDATE folders SET last_scan = $t WHERE id = $id", tx, ("$t", Iso(DateTime.UtcNow)), ("$id", folderId))) ls.ExecuteNonQuery();
            tx.Commit();
            var done = new ScanProgress(folderId, "done", files.Count, processed, added, updated, relinked, missing, errors);
            progress?.Report(done);
            return done;
        }
        catch (OperationCanceledException)
        {
            tx?.Commit(); // keep what was indexed so far; the next scan continues incrementally
            var cancelled = new ScanProgress(folderId, "cancelled", files.Count, processed, added, updated, relinked, 0, errors);
            progress?.Report(cancelled);
            return cancelled;
        }
        finally { tx?.Dispose(); }
    }

    private static void WriteScanned(SqliteConnection c, SqliteTransaction? tx, long id, long folderId, string file, FileInfo info, long mtime, string? fingerprint = null)
    {
        var tags = TagIO.Read(file);
        fingerprint ??= Fingerprint.Compute(file);
        WriteTrack(c, tx, id, folderId, file, info.Length, mtime, fingerprint, tags);
    }

    private static void WriteTrack(SqliteConnection c, SqliteTransaction? tx, long id, long? folderId, string file, long size, long mtime, string fingerprint, TrackTags tags)
    {
        var name = System.IO.Path.GetFileNameWithoutExtension(file);
        var folder = System.IO.Path.GetDirectoryName(file) ?? "";
        var search = TextFold.Fold(string.Join(' ', tags.Title, tags.Artist, tags.Album, tags.AlbumArtist, tags.Genre, tags.Comment, System.IO.Path.GetFileName(file), folder));
        using var u = Cmd(c, """
            UPDATE tracks SET folder_id = COALESCE($f, folder_id), path = $p, path_key = $k, size = $s, mtime = $m, fingerprint = $fp,
              title = $t, artist = $ar, album = $al, album_artist = $aa, genre = $g, year = $y, track_no = $n, comment = $c,
              duration = $d, has_art = $art, read_error = $err, missing = 0,
              sort_title = $st, sort_name = $sn, sort_folder = $sf, search = $q
            WHERE id = $id
            """, tx, ("$f", folderId), ("$p", file), ("$k", PathKey(file)), ("$s", size), ("$m", mtime), ("$fp", fingerprint),
            ("$t", tags.Title), ("$ar", tags.Artist), ("$al", tags.Album), ("$aa", tags.AlbumArtist), ("$g", tags.Genre),
            ("$y", tags.Year), ("$n", tags.TrackNumber), ("$c", tags.Comment), ("$d", tags.DurationSeconds), ("$art", tags.HasArtwork ? 1 : 0),
            ("$err", tags.ReadError), ("$st", TextFold.Fold(tags.Title ?? name)), ("$sn", TextFold.Fold(name)), ("$sf", TextFold.Fold(folder)), ("$q", search), ("$id", id));
        u.ExecuteNonQuery();
    }

    /// <summary>Re-reads one file after NoorMD changed it (tags and/or path) and updates its row.</summary>
    public TrackRow Refresh(long id, string currentPath)
    {
        var info = new FileInfo(currentPath);
        using var c = Open();
        // A stale "missing" row may still hold the new path (a file that used to live there); it can't be the
        // same file, so drop it rather than violating the unique path key.
        using (var stale = Cmd(c, "DELETE FROM tracks WHERE path_key = $k AND id <> $id AND missing = 1", null, ("$k", PathKey(info.FullName)), ("$id", id))) stale.ExecuteNonQuery();
        WriteTrack(c, null, id, null, info.FullName, info.Length, info.LastWriteTimeUtc.Ticks, Fingerprint.Compute(info.FullName), TagIO.Read(info.FullName));
        return Get(id)!;
    }

    /// <summary>
    /// Refresh for several tracks at once, in one transaction. Paths may be exchanged between them (a batch swap), so
    /// their keys are parked first and the unique path key is never violated in between.
    /// </summary>
    public void RefreshMany(IReadOnlyList<(long Id, string Path)> items)
    {
        if (items.Count == 0) return;
        using var c = Open();
        using var tx = c.BeginTransaction();
        foreach (var (id, _) in items)
            using (var park = Cmd(c, "UPDATE tracks SET path_key = '~moving~' || id WHERE id = $id", tx, ("$id", id))) park.ExecuteNonQuery();
        foreach (var (id, path) in items)
        {
            var info = new FileInfo(path);
            using (var stale = Cmd(c, "DELETE FROM tracks WHERE path_key = $k AND id <> $id AND missing = 1", tx, ("$k", PathKey(info.FullName)), ("$id", id))) stale.ExecuteNonQuery();
            WriteTrack(c, tx, id, null, info.FullName, info.Length, info.LastWriteTimeUtc.Ticks, Fingerprint.Compute(info.FullName), TagIO.Read(info.FullName));
        }
        tx.Commit();
    }

    // ------------------------------------------------------------------ queries

    private const string Columns = "id, path, title, artist, album, album_artist, genre, year, track_no, comment, duration, has_art, triage, missing, read_error, size, added, play_count";

    private static TrackRow ReadRow(SqliteDataReader r) => new(
        r.GetInt64(0), r.GetString(1), r.IsDBNull(2) ? null : r.GetString(2), r.IsDBNull(3) ? null : r.GetString(3), r.IsDBNull(4) ? null : r.GetString(4),
        r.IsDBNull(5) ? null : r.GetString(5), r.IsDBNull(6) ? null : r.GetString(6), r.IsDBNull(7) ? null : (uint)r.GetInt64(7), r.IsDBNull(8) ? null : (uint)r.GetInt64(8),
        r.IsDBNull(9) ? null : r.GetString(9), r.GetDouble(10), r.GetInt64(11) == 1, (Triage)r.GetInt64(12), r.GetInt64(13) == 1,
        r.IsDBNull(14) ? null : r.GetString(14), r.GetInt64(15), ParseIso(r.GetString(16)), r.GetInt32(17));

    public TrackRow? Get(long id)
    {
        using var c = Open();
        using var cmd = Cmd(c, $"SELECT {Columns} FROM tracks WHERE id = $id", null, ("$id", id));
        using var r = cmd.ExecuteReader();
        return r.Read() ? ReadRow(r) : null;
    }

    public IReadOnlyList<TrackRow> GetMany(IEnumerable<long> ids)
    {
        var wanted = ids.Distinct().Take(5000).ToList();
        if (wanted.Count == 0) return [];
        using var c = Open();
        using var cmd = Cmd(c, $"SELECT {Columns} FROM tracks WHERE id IN ({string.Join(',', wanted)})");
        using var r = cmd.ExecuteReader();
        var byId = new Dictionary<long, TrackRow>();
        while (r.Read()) { var row = ReadRow(r); byId[row.Id] = row; }
        return wanted.Where(byId.ContainsKey).Select(i => byId[i]).ToList();
    }

    private static readonly Dictionary<string, string> Sorts = new()
    {
        ["title"] = "sort_title", ["filename"] = "sort_name", ["folder"] = "sort_folder, sort_name", ["artist"] = "artist IS NULL, lower(artist), sort_title",
        ["album"] = "album IS NULL, lower(album), track_no, sort_title", ["genre"] = "genre IS NULL, lower(genre), sort_title", ["year"] = "year IS NULL, year, sort_title",
        ["duration"] = "duration", ["triage"] = "triage = 0, triage, sort_title", ["added"] = "added", ["plays"] = "play_count",
    };

    public QueryResult Query(LibraryQuery q)
    {
        var where = new List<string>();
        var args = new List<(string, object?)>();
        var terms = TextFold.Fold(q.Search).Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(8).ToList();
        for (int i = 0; i < terms.Count; i++)
        {
            where.Add($"t.search LIKE $s{i} ESCAPE '\\'");
            args.Add(($"$s{i}", "%" + terms[i].Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%"));
        }
        if (q.Triage is { } tri) { where.Add("t.triage = $tri"); args.Add(("$tri", (int)tri)); }
        if (q.MissingOnly) where.Add("t.missing = 1");
        string from = "tracks t";
        string order;
        if (q.PlaylistId is long pl)
        {
            from = "playlist_items pi JOIN tracks t ON t.id = pi.track_id";
            where.Add("pi.playlist_id = $pl");
            args.Add(("$pl", pl));
            order = q.Sort == "playlist" || !Sorts.ContainsKey(q.Sort) ? "pi.position" : Sorts[q.Sort];
        }
        else order = Sorts.TryGetValue(q.Sort, out var o) ? o : Sorts["title"];
        if (q.Descending) order = string.Join(", ", order.Split(", ").Select(p => p + " DESC"));
        var whereSql = where.Count == 0 ? "" : "WHERE " + string.Join(" AND ", where);
        var cols = string.Join(", ", Columns.Split(", ").Select(col => "t." + col));

        using var c = Open();
        int total;
        using (var count = Cmd(c, $"SELECT COUNT(*) FROM {from} {whereSql}", null, args.ToArray()))
            total = Convert.ToInt32(count.ExecuteScalar(), CultureInfo.InvariantCulture);
        var page = new List<(string, object?)>(args) { ("$lim", Math.Clamp(q.Limit, 1, 2000)), ("$off", Math.Max(0, q.Offset)) };
        using var cmd = Cmd(c, $"SELECT {cols} FROM {from} {whereSql} ORDER BY {order}, t.id LIMIT $lim OFFSET $off", null, page.ToArray());
        using var r = cmd.ExecuteReader();
        var rows = new List<TrackRow>();
        while (r.Read()) rows.Add(ReadRow(r));
        return new QueryResult(total, rows);
    }

    /// <summary>All ids matching a query in display order (for "play all"/queueing a whole view). Capped at 50,000.</summary>
    public IReadOnlyList<long> QueryIds(LibraryQuery q) =>
        Query(q with { Offset = 0, Limit = 2000 }) is var first && first.Total <= 2000
            ? first.Rows.Select(r => r.Id).ToList()
            : Enumerable.Range(0, (Math.Min(first.Total, 50_000) + 1999) / 2000).SelectMany(p => Query(q with { Offset = p * 2000, Limit = 2000 }).Rows.Select(r => r.Id)).ToList();

    public LibraryStats Stats()
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT COUNT(*), SUM(missing), SUM(triage=1), SUM(triage=2), SUM(triage=3), SUM(triage=4), SUM(triage=0) FROM tracks");
        using var r = cmd.ExecuteReader();
        r.Read();
        int I(int i) => r.IsDBNull(i) ? 0 : Convert.ToInt32(r.GetValue(i), CultureInfo.InvariantCulture);
        return new LibraryStats(I(0), I(1), I(2), I(3), I(4), I(5), I(6));
    }

    // ------------------------------------------------------------------ triage, plays

    public void SetTriage(IEnumerable<long> ids, Triage value)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        foreach (var id in ids.Distinct())
        {
            using var u = Cmd(c, "UPDATE tracks SET triage = $v WHERE id = $id", tx, ("$v", (int)value), ("$id", id));
            u.ExecuteNonQuery();
        }
        tx.Commit();
    }

    public void MarkPlayed(long id)
    {
        using var c = Open();
        using var u = Cmd(c, "UPDATE tracks SET play_count = play_count + 1, last_played = $t WHERE id = $id", null, ("$t", Iso(DateTime.UtcNow)), ("$id", id));
        u.ExecuteNonQuery();
    }

    /// <summary>Adds individual files (e.g. from an imported playlist) that aren't in any library folder yet.</summary>
    public long AddFile(string path)
    {
        var full = System.IO.Path.GetFullPath(path);
        using var c = Open();
        using (var find = Cmd(c, "SELECT id FROM tracks WHERE path_key = $k", null, ("$k", PathKey(full))))
            if (find.ExecuteScalar() is long existing) return existing;
        var info = new FileInfo(full);
        using var ins = Cmd(c, "INSERT INTO tracks(folder_id, path, path_key, added) VALUES (NULL, $p, $k, $a) RETURNING id", null, ("$p", full), ("$k", PathKey(full)), ("$a", Iso(DateTime.UtcNow)));
        var id = (long)ins.ExecuteScalar()!;
        WriteScanned(c, null, id, 0, full, info, info.LastWriteTimeUtc.Ticks);
        using (var fix = Cmd(c, "UPDATE tracks SET folder_id = NULL WHERE id = $id", null, ("$id", id))) fix.ExecuteNonQuery();
        return id;
    }

    // ------------------------------------------------------------------ playlists

    public IReadOnlyList<PlaylistInfo> Playlists()
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT p.id, p.name, (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) FROM playlists p ORDER BY lower(p.name)");
        using var r = cmd.ExecuteReader();
        var list = new List<PlaylistInfo>();
        while (r.Read()) list.Add(new PlaylistInfo(r.GetInt64(0), r.GetString(1), r.GetInt32(2)));
        return list;
    }

    public long CreatePlaylist(string name)
    {
        name = string.IsNullOrWhiteSpace(name) ? "New playlist" : name.Trim()[..Math.Min(name.Trim().Length, 120)];
        using var c = Open();
        using var ins = Cmd(c, "INSERT INTO playlists(name, created) VALUES ($n, $t) RETURNING id", null, ("$n", name), ("$t", Iso(DateTime.UtcNow)));
        return (long)ins.ExecuteScalar()!;
    }

    public void RenamePlaylist(long id, string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return;
        using var c = Open();
        using var u = Cmd(c, "UPDATE playlists SET name = $n WHERE id = $id", null, ("$n", name.Trim()[..Math.Min(name.Trim().Length, 120)]), ("$id", id));
        u.ExecuteNonQuery();
    }

    public void DeletePlaylist(long id)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        using (var a = Cmd(c, "DELETE FROM playlist_items WHERE playlist_id = $id", tx, ("$id", id))) a.ExecuteNonQuery();
        using (var b = Cmd(c, "DELETE FROM playlists WHERE id = $id", tx, ("$id", id))) b.ExecuteNonQuery();
        tx.Commit();
    }

    public IReadOnlyList<long> PlaylistTrackIds(long id)
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT track_id FROM playlist_items WHERE playlist_id = $id ORDER BY position", null, ("$id", id));
        using var r = cmd.ExecuteReader();
        var list = new List<long>();
        while (r.Read()) list.Add(r.GetInt64(0));
        return list;
    }

    /// <summary>Replaces a playlist's contents (used for add, remove and reorder). Duplicates are allowed in playlists.</summary>
    public void SetPlaylistItems(long id, IEnumerable<long> trackIds)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        using (var d = Cmd(c, "DELETE FROM playlist_items WHERE playlist_id = $id", tx, ("$id", id))) d.ExecuteNonQuery();
        int pos = 0;
        foreach (var t in trackIds.Take(50_000))
        {
            using var ins = Cmd(c, "INSERT INTO playlist_items(playlist_id, position, track_id) SELECT $p, $pos, $t WHERE EXISTS (SELECT 1 FROM tracks WHERE id = $t)", tx, ("$p", id), ("$pos", pos++), ("$t", t));
            ins.ExecuteNonQuery();
        }
        tx.Commit();
    }

    public void AddToPlaylist(long id, IEnumerable<long> trackIds) => SetPlaylistItems(id, PlaylistTrackIds(id).Concat(trackIds));

    public string? PlaylistName(long id)
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT name FROM playlists WHERE id = $id", null, ("$id", id));
        return cmd.ExecuteScalar() as string;
    }

    // ------------------------------------------------------------------ journal (edit history with undo)

    public sealed record JournalEntry(long Id, DateTime Utc, long TrackId, string OldPath, string NewPath, TrackTags? OldTags, TrackTags? NewTags, string? NewFingerprint, string Status, string? Note, long? BatchId = null);

    internal long JournalBegin(long trackId, string oldPath, string newPath, TrackTags oldTags, TagEdit? edit, long? batchId = null)
    {
        using var c = Open();
        using var ins = Cmd(c, "INSERT INTO journal(utc, track_id, old_path, new_path, old_tags, new_tags, status, batch_id) VALUES ($u, $t, $o, $n, $ot, $nt, 'pending', $b) RETURNING id", null,
            ("$u", Iso(DateTime.UtcNow)), ("$t", trackId), ("$o", oldPath), ("$n", newPath), ("$ot", JsonSerializer.Serialize(oldTags)), ("$nt", edit == null ? null : JsonSerializer.Serialize(edit)), ("$b", batchId));
        return (long)ins.ExecuteScalar()!;
    }

    internal void JournalFinish(long id, string status, string newPath, string? fingerprint, TrackTags? newTags, string? note)
    {
        using var c = Open();
        using var u = Cmd(c, "UPDATE journal SET status = $s, new_path = $n, new_fingerprint = $fp, new_tags = COALESCE($nt, new_tags), note = $note WHERE id = $id", null,
            ("$s", status), ("$n", newPath), ("$fp", fingerprint), ("$nt", newTags == null ? null : JsonSerializer.Serialize(newTags)), ("$note", note), ("$id", id));
        u.ExecuteNonQuery();
    }

    /// <summary>A new batch number for journal entries that are undone together.</summary>
    internal long NextBatchId()
    {
        using var c = Open();
        return Convert.ToInt64(Scalar(c, "SELECT COALESCE(MAX(batch_id), 0) + 1 FROM journal"), CultureInfo.InvariantCulture);
    }

    public IReadOnlyList<JournalEntry> Journal(int limit = 100) => ReadJournal("ORDER BY id DESC LIMIT $l", ("$l", limit));

    public IReadOnlyList<JournalEntry> BatchJournal(long batchId) => ReadJournal("WHERE batch_id = $b ORDER BY id", ("$b", batchId));

    private List<JournalEntry> ReadJournal(string where, params (string, object?)[] args)
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT id, utc, track_id, old_path, new_path, old_tags, new_tags, new_fingerprint, status, note, batch_id FROM journal " + where, null, args);
        using var r = cmd.ExecuteReader();
        var list = new List<JournalEntry>();
        while (r.Read())
        {
            TrackTags? Tags(int i) { if (r.IsDBNull(i)) return null; try { return JsonSerializer.Deserialize<TrackTags>(r.GetString(i)); } catch { return null; } }
            list.Add(new JournalEntry(r.GetInt64(0), ParseIso(r.GetString(1)), r.GetInt64(2), r.GetString(3), r.GetString(4), Tags(5), Tags(6),
                r.IsDBNull(7) ? null : r.GetString(7), r.GetString(8), r.IsDBNull(9) ? null : r.GetString(9), r.IsDBNull(10) ? null : r.GetInt64(10)));
        }
        return list;
    }

    // ------------------------------------------------------------------ session state (queue, position…)

    public string? GetState(string key)
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT value FROM state WHERE key = $k", null, ("$k", key));
        return cmd.ExecuteScalar() as string;
    }

    public void SetState(string key, string value)
    {
        using var c = Open();
        using var u = Cmd(c, "INSERT INTO state(key, value) VALUES ($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value", null, ("$k", key), ("$v", value));
        u.ExecuteNonQuery();
    }

    /// <summary>Test/maintenance helper: bulk-inserts synthetic rows (no files) to measure query performance.</summary>
    internal void InsertSyntheticForTests(int count)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        var rnd = new Random(42);
        for (int i = 0; i < count; i++)
        {
            var path = $@"C:\Music\Suno\{i / 500}\Suno Track {i:D5}.mp3";
            var title = i % 3 == 0 ? null : $"Track {i} {(i % 7 == 0 ? "żółw" : "song")}";
            using var ins = Cmd(c, """
                INSERT INTO tracks(path, path_key, size, mtime, title, genre, duration, triage, added, sort_title, sort_name, sort_folder, search)
                VALUES ($p, $k, 1000, 0, $t, $g, $d, $tr, $a, $st, $sn, $sf, $q)
                """, tx, ("$p", path), ("$k", path.ToUpperInvariant()), ("$t", title), ("$g", i % 5 == 0 ? "Synthwave" : "Lo-fi"), ("$d", 60 + rnd.Next(200)),
                ("$tr", i % 4), ("$a", Iso(DateTime.UtcNow)), ("$st", TextFold.Fold(title ?? $"Suno Track {i:D5}")), ("$sn", TextFold.Fold($"Suno Track {i:D5}")),
                ("$sf", TextFold.Fold($@"C:\Music\Suno\{i / 500}")), ("$q", TextFold.Fold($"{title} {(i % 5 == 0 ? "Synthwave" : "Lo-fi")} Suno Track {i:D5}.mp3")));
            ins.ExecuteNonQuery();
        }
        tx.Commit();
    }
}
