using System.Globalization;
using Microsoft.Data.Sqlite;

namespace NoorMD.Media;

public static class ImageFormats
{
    private static readonly Dictionary<string, string> Types = new(StringComparer.OrdinalIgnoreCase)
    {
        [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".png"] = "image/png", [".gif"] = "image/gif", [".webp"] = "image/webp",
        [".bmp"] = "image/bmp", [".avif"] = "image/avif",
    };
    public static bool IsImage(string path) => Types.ContainsKey(Path.GetExtension(path));
    public static string ContentType(string path) => Types.TryGetValue(Path.GetExtension(path), out var t) ? t : "application/octet-stream";
}

public sealed record GalleryImage(long Id, string Path, string Name, string Album, string AlbumKey, long Size, int Width, int Height,
    DateTime TakenUtc, bool Favorite, bool Missing);

public sealed record GalleryAlbum(string Key, string Name, string Folder, int Count, long? CoverId, DateTime? LatestUtc);
public sealed record GalleryFolder(long Id, string Path, int Count);
public sealed record Slideshow(long Id, string Name, int Count, string Settings, DateTime CreatedUtc);

/// <param name="Filter">"all" or "favorites".</param>
/// <param name="Sort">"taken" (date taken), "name" or "added".</param>
public sealed record GalleryQuery(string? Search = null, string Filter = "all", string? AlbumKey = null, long? SlideshowId = null, string Sort = "taken", bool Descending = true, int Limit = 5000);

/// <summary>
/// The Gallery: pictures in the folders you add (subfolders are albums), indexed in a local database with the size and
/// date taken (EXIF when there is one, otherwise the file's date). Favourites and slideshows live only in that database:
/// the pictures themselves are never changed.
/// </summary>
public sealed class GalleryLibrary
{
    private readonly string _cs;
    public const int MaxSlideshowItems = 2000;

    public GalleryLibrary(string databasePath)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(databasePath)!);
        _cs = new SqliteConnectionStringBuilder { DataSource = databasePath, Mode = SqliteOpenMode.ReadWriteCreate, Pooling = true }.ToString();
        using var c = Open();
        Exec(c, """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS folders (id INTEGER PRIMARY KEY, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE, last_scan TEXT);
            CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY, folder_id INTEGER NOT NULL, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE,
              size INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, album TEXT NOT NULL, album_key TEXT NOT NULL,
              width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0, taken TEXT NOT NULL, added TEXT NOT NULL,
              favorite INTEGER NOT NULL DEFAULT 0, missing INTEGER NOT NULL DEFAULT 0);
            CREATE INDEX IF NOT EXISTS ix_images_album ON images(album_key);
            CREATE INDEX IF NOT EXISTS ix_images_taken ON images(taken);
            CREATE TABLE IF NOT EXISTS slideshows (id INTEGER PRIMARY KEY, name TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}', created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS slideshow_items (slideshow_id INTEGER NOT NULL, position INTEGER NOT NULL, image_id INTEGER NOT NULL, PRIMARY KEY (slideshow_id, position));
            CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """);
    }

    private SqliteConnection Open() { var c = new SqliteConnection(_cs); c.Open(); return c; }
    private static void Exec(SqliteConnection c, string sql, SqliteTransaction? tx = null) { using var cmd = c.CreateCommand(); cmd.Transaction = tx; cmd.CommandText = sql; cmd.ExecuteNonQuery(); }
    private static SqliteCommand Cmd(SqliteConnection c, string sql, SqliteTransaction? tx = null, params (string, object?)[] args)
    {
        var cmd = c.CreateCommand(); cmd.CommandText = sql; cmd.Transaction = tx;
        foreach (var (n, v) in args) cmd.Parameters.AddWithValue(n, v ?? DBNull.Value);
        return cmd;
    }
    private static string Iso(DateTime d) => d.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
    private static DateTime ParseIso(string s) => DateTime.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

    // ------------------------------------------------------------------ folders and scanning

    public long AddFolder(string path)
    {
        var full = System.IO.Path.GetFullPath(path);
        if (!Directory.Exists(full)) throw new ArgumentException($"\"{full}\" is not a folder.");
        using var c = Open();
        using var find = Cmd(c, "SELECT id FROM folders WHERE path_key = $k", null, ("$k", MusicLibrary.PathKey(full)));
        if (find.ExecuteScalar() is long existing) return existing;
        using var ins = Cmd(c, "INSERT INTO folders(path, path_key) VALUES ($p, $k) RETURNING id", null, ("$p", full), ("$k", MusicLibrary.PathKey(full)));
        return (long)ins.ExecuteScalar()!;
    }

    public void RemoveFolder(long id)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        using (var s = Cmd(c, "DELETE FROM slideshow_items WHERE image_id IN (SELECT id FROM images WHERE folder_id = $f)", tx, ("$f", id))) s.ExecuteNonQuery();
        using (var v = Cmd(c, "DELETE FROM images WHERE folder_id = $f", tx, ("$f", id))) v.ExecuteNonQuery();
        using (var f = Cmd(c, "DELETE FROM folders WHERE id = $f", tx, ("$f", id))) f.ExecuteNonQuery();
        tx.Commit();
        Renumber(c);
    }

    public IReadOnlyList<GalleryFolder> Folders()
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT f.id, f.path, (SELECT COUNT(*) FROM images i WHERE i.folder_id = f.id AND i.missing = 0) FROM folders f ORDER BY lower(f.path)");
        using var r = cmd.ExecuteReader();
        var list = new List<GalleryFolder>();
        while (r.Read()) list.Add(new GalleryFolder(r.GetInt64(0), r.GetString(1), r.GetInt32(2)));
        return list;
    }

    /// <summary>Scans a folder (subfolders included). Known pictures keep their id, favourite and place in slideshows.</summary>
    public (int Found, int Added, int Missing) Scan(long folderId, CancellationToken ct = default)
    {
        string root;
        using (var c0 = Open())
        using (var q = Cmd(c0, "SELECT path FROM folders WHERE id = $id", null, ("$id", folderId)))
            root = q.ExecuteScalar() as string ?? throw new ArgumentException("Unknown folder.");
        if (!Directory.Exists(root)) return (0, 0, 0); // a disconnected drive: nothing is marked missing
        var opts = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.System | FileAttributes.Hidden };
        var files = Directory.EnumerateFiles(root, "*", opts).Where(ImageFormats.IsImage).ToList();
        var known = new Dictionary<string, (long Id, long Size, long Mtime)>();
        using var c = Open();
        using (var cmd = Cmd(c, "SELECT id, path_key, size, mtime FROM images WHERE folder_id = $f", null, ("$f", folderId)))
        using (var r = cmd.ExecuteReader())
            while (r.Read()) known[r.GetString(1)] = (r.GetInt64(0), r.GetInt64(2), r.GetInt64(3));
        using var tx = c.BeginTransaction();
        var seen = new HashSet<long>();
        var added = 0;
        var rootTrim = root.TrimEnd('\\', '/');
        foreach (var f in files)
        {
            ct.ThrowIfCancellationRequested();
            var info = new FileInfo(f);
            var key = MusicLibrary.PathKey(f);
            if (known.TryGetValue(key, out var k))
            {
                seen.Add(k.Id);
                if (k.Size == info.Length && k.Mtime == info.LastWriteTimeUtc.Ticks)
                {
                    using var ok = Cmd(c, "UPDATE images SET missing = 0 WHERE id = $id", tx, ("$id", k.Id));
                    ok.ExecuteNonQuery();
                    continue;
                }
            }
            if (!known.ContainsKey(key))
            {
                // Indexed under another (overlapping) folder: this folder takes it over, keeping its favourite and slideshows.
                using var other = Cmd(c, "SELECT id FROM images WHERE path_key = $k", tx, ("$k", key));
                if (other.ExecuteScalar() is long otherId) { known[key] = (otherId, -1, -1); seen.Add(otherId); }
            }
            var dir = System.IO.Path.GetDirectoryName(f)!;
            var album = AlbumName(rootTrim, dir);
            var (w, h, taken) = ReadInfo(f, info.LastWriteTimeUtc);
            var args = new (string, object?)[] { ("$f", folderId), ("$p", f), ("$k", key), ("$s", info.Length), ("$m", info.LastWriteTimeUtc.Ticks),
                ("$n", System.IO.Path.GetFileNameWithoutExtension(f)), ("$al", album), ("$ak", MusicLibrary.PathKey(dir)), ("$w", w), ("$h", h), ("$t", Iso(taken)), ("$a", Iso(DateTime.UtcNow)) };
            if (known.TryGetValue(key, out var existing))
            {
                using var u = Cmd(c, "UPDATE images SET folder_id=$f, size=$s, mtime=$m, name=$n, album=$al, album_key=$ak, width=$w, height=$h, taken=$t, missing=0 WHERE id = $id", tx, [.. args, ("$id", existing.Id)]);
                u.ExecuteNonQuery();
            }
            else
            {
                using var ins = Cmd(c, "INSERT INTO images(folder_id, path, path_key, size, mtime, name, album, album_key, width, height, taken, added) VALUES ($f,$p,$k,$s,$m,$n,$al,$ak,$w,$h,$t,$a)", tx, args);
                ins.ExecuteNonQuery();
                added++;
            }
        }
        var missing = 0;
        foreach (var (_, k) in known)
            if (!seen.Contains(k.Id))
            {
                using var m = Cmd(c, "UPDATE images SET missing = 1 WHERE id = $id", tx, ("$id", k.Id));
                m.ExecuteNonQuery();
                missing++;
            }
        using (var ls = Cmd(c, "UPDATE folders SET last_scan = $t WHERE id = $id", tx, ("$t", Iso(DateTime.UtcNow)), ("$id", folderId))) ls.ExecuteNonQuery();
        tx.Commit();
        return (files.Count, added, missing);
    }

    /// <summary>"Holidays/2024" for a picture in Root/Holidays/2024; the folder's own name for pictures right in it.</summary>
    public static string AlbumName(string root, string dir)
    {
        var d = dir.TrimEnd('\\', '/');
        if (string.Equals(d, root, StringComparison.OrdinalIgnoreCase)) return System.IO.Path.GetFileName(root);
        return System.IO.Path.GetRelativePath(root, d).Replace('\\', '/');
    }

    /// <summary>Size and date taken from the picture's metadata (EXIF), or the file date when there is none.</summary>
    public static (int Width, int Height, DateTime TakenUtc) ReadInfo(string path, DateTime fileDateUtc)
    {
        try
        {
            using var tf = TagLib.File.Create(path, TagLib.ReadStyle.Average);
            var w = tf.Properties?.PhotoWidth ?? 0;
            var h = tf.Properties?.PhotoHeight ?? 0;
            DateTime? taken = (tf.Tag as TagLib.Image.CombinedImageTag)?.DateTime;
            // EXIF dates have no time zone: they are the camera's local time.
            var utc = taken is { } t && t.Year > 1900 ? DateTime.SpecifyKind(t, DateTimeKind.Local).ToUniversalTime() : fileDateUtc;
            return (w, h, utc);
        }
        catch (Exception) { return (0, 0, fileDateUtc); } // a format TagLib doesn't read (WebP, AVIF): the browser still shows it
    }

    // ------------------------------------------------------------------ browsing

    private const string Cols = "i.id, i.path, i.name, i.album, i.album_key, i.size, i.width, i.height, i.taken, i.favorite, i.missing";

    private static GalleryImage Read(SqliteDataReader r) => new(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4),
        r.GetInt64(5), r.GetInt32(6), r.GetInt32(7), ParseIso(r.GetString(8)), r.GetInt64(9) == 1, r.GetInt64(10) == 1);

    private List<GalleryImage> Rows(string sql, params (string, object?)[] args)
    {
        using var c = Open();
        using var cmd = Cmd(c, sql, null, args);
        using var r = cmd.ExecuteReader();
        var list = new List<GalleryImage>();
        while (r.Read()) list.Add(Read(r));
        return list;
    }

    public GalleryImage? Get(long id) => Rows($"SELECT {Cols} FROM images i WHERE i.id = $id", ("$id", id)).FirstOrDefault();

    public int Count()
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT COUNT(*) FROM images WHERE missing = 0");
        return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    public IReadOnlyList<GalleryAlbum> Albums()
    {
        using var c = Open();
        using var cmd = Cmd(c, """
            SELECT album_key, album, MIN(path), COUNT(*), MAX(taken),
              (SELECT j.id FROM images j WHERE j.album_key = i.album_key AND j.missing = 0 ORDER BY j.favorite DESC, j.taken DESC LIMIT 1)
            FROM images i WHERE missing = 0 GROUP BY album_key ORDER BY lower(album)
            """);
        using var r = cmd.ExecuteReader();
        var list = new List<GalleryAlbum>();
        while (r.Read())
            list.Add(new GalleryAlbum(r.GetString(0), r.GetString(1), System.IO.Path.GetDirectoryName(r.GetString(2)) ?? "", r.GetInt32(3), r.IsDBNull(5) ? null : r.GetInt64(5), ParseIso(r.GetString(4))));
        return list;
    }

    public IReadOnlyList<GalleryImage> Query(GalleryQuery q)
    {
        if (q.SlideshowId is { } sid)
            return Rows($"SELECT {Cols} FROM slideshow_items s JOIN images i ON i.id = s.image_id WHERE s.slideshow_id = $s AND i.missing = 0 ORDER BY s.position", ("$s", sid));
        var where = new List<string> { "i.missing = 0" };
        var args = new List<(string, object?)>();
        if (q.Filter == "favorites") where.Add("i.favorite = 1");
        if (!string.IsNullOrEmpty(q.AlbumKey)) { where.Add("i.album_key = $ak"); args.Add(("$ak", q.AlbumKey)); }
        var order = q.Sort switch { "name" => "lower(i.name)", "added" => "i.added", _ => "i.taken" } + (q.Descending ? " DESC" : "") + ", i.id";
        var rows = Rows($"SELECT {Cols} FROM images i WHERE {string.Join(" AND ", where)} ORDER BY {order}", [.. args]);
        if (!string.IsNullOrWhiteSpace(q.Search))
        {
            var terms = TextFold.Fold(q.Search).Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(6).ToList();
            rows = rows.Where(i => terms.All(t => TextFold.Fold(i.Name + " " + i.Album).Contains(t, StringComparison.Ordinal))).ToList();
        }
        return rows.Take(Math.Clamp(q.Limit, 1, 20000)).ToList();
    }

    public void SetFavorite(IEnumerable<long> ids, bool on)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        foreach (var id in ids.Distinct())
        {
            using var cmd = Cmd(c, "UPDATE images SET favorite = $v WHERE id = $id", tx, ("$v", on ? 1 : 0), ("$id", id));
            cmd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    // ------------------------------------------------------------------ after NoorMD renamed, moved or deleted pictures

    /// <summary>The picture now lives at <paramref name="newPath"/> (renamed or moved by NoorMD): its row follows, keeping favourite and slideshows.</summary>
    public void Relocate(long id, string newPath)
    {
        var full = System.IO.Path.GetFullPath(newPath);
        var folder = Folders().Where(f => full.StartsWith(System.IO.Path.TrimEndingDirectorySeparator(f.Path) + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(f => f.Path.Length).FirstOrDefault() ?? throw new ArgumentException("That place is not in a Gallery folder.");
        var dir = System.IO.Path.GetDirectoryName(full)!;
        var info = new FileInfo(full);
        using var c = Open();
        using var tx = c.BeginTransaction();
        using (var stale = Cmd(c, "DELETE FROM images WHERE path_key = $k AND id <> $id", tx, ("$k", MusicLibrary.PathKey(full)), ("$id", id))) stale.ExecuteNonQuery();
        using (var u = Cmd(c, "UPDATE images SET folder_id=$f, path=$p, path_key=$k, name=$n, album=$al, album_key=$ak, mtime=$m, missing=0 WHERE id=$id", tx,
            ("$f", folder.Id), ("$p", full), ("$k", MusicLibrary.PathKey(full)), ("$n", System.IO.Path.GetFileNameWithoutExtension(full)),
            ("$al", AlbumName(System.IO.Path.TrimEndingDirectorySeparator(folder.Path), dir)), ("$ak", MusicLibrary.PathKey(dir)), ("$m", info.Exists ? info.LastWriteTimeUtc.Ticks : 0), ("$id", id)))
            u.ExecuteNonQuery();
        tx.Commit();
    }

    /// <summary>Pictures that were deleted (to the Recycle Bin) by NoorMD leave the library and their slideshows.</summary>
    public void Forget(IEnumerable<long> ids)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        foreach (var id in ids.Distinct())
        {
            using (var s = Cmd(c, "DELETE FROM slideshow_items WHERE image_id = $id", tx, ("$id", id))) s.ExecuteNonQuery();
            using (var d = Cmd(c, "DELETE FROM images WHERE id = $id", tx, ("$id", id))) d.ExecuteNonQuery();
        }
        tx.Commit();
        Renumber(c);
    }

    /// <summary>Every folder pictures can be moved to: the Gallery folders and the folders inside them.</summary>
    public IReadOnlyList<string> PlaceFolders(int limit = 3000)
    {
        var list = new List<string>();
        var opts = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.System | FileAttributes.Hidden };
        foreach (var f in Folders())
        {
            if (!Directory.Exists(f.Path)) continue;
            list.Add(f.Path);
            foreach (var d in Directory.EnumerateDirectories(f.Path, "*", opts)) { list.Add(d); if (list.Count >= limit) return list; }
        }
        return list;
    }

    /// <summary>Whether a folder is one of the Gallery folders or inside one (moves and new albums stay there).</summary>
    public bool IsInside(string folder)
    {
        var full = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(folder));
        return Folders().Any(f =>
        {
            var root = System.IO.Path.TrimEndingDirectorySeparator(f.Path);
            return string.Equals(full, root, StringComparison.OrdinalIgnoreCase) || full.StartsWith(root + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        });
    }

    // ------------------------------------------------------------------ slideshows

    public IReadOnlyList<Slideshow> Slideshows()
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT s.id, s.name, (SELECT COUNT(*) FROM slideshow_items t JOIN images i ON i.id = t.image_id WHERE t.slideshow_id = s.id AND i.missing = 0), s.settings, s.created FROM slideshows s ORDER BY lower(s.name)");
        using var r = cmd.ExecuteReader();
        var list = new List<Slideshow>();
        while (r.Read()) list.Add(new Slideshow(r.GetInt64(0), r.GetString(1), r.GetInt32(2), r.GetString(3), ParseIso(r.GetString(4))));
        return list;
    }

    public Slideshow? GetSlideshow(long id) => Slideshows().FirstOrDefault(s => s.Id == id);

    public long CreateSlideshow(string name, IEnumerable<long> ids, string settings)
    {
        var n = CleanName(name);
        using var c = Open();
        long id;
        using (var ins = Cmd(c, "INSERT INTO slideshows(name, settings, created) VALUES ($n, $s, $c) RETURNING id", null, ("$n", n), ("$s", CleanSettings(settings)), ("$c", Iso(DateTime.UtcNow))))
            id = (long)ins.ExecuteScalar()!;
        SetItems(id, ids);
        return id;
    }

    public void UpdateSlideshow(long id, string? name, string? settings)
    {
        using var c = Open();
        if (name != null) { using var a = Cmd(c, "UPDATE slideshows SET name = $n WHERE id = $id", null, ("$n", CleanName(name)), ("$id", id)); if (a.ExecuteNonQuery() == 0) throw new ArgumentException("That slideshow is gone."); }
        if (settings != null) { using var b = Cmd(c, "UPDATE slideshows SET settings = $s WHERE id = $id", null, ("$s", CleanSettings(settings)), ("$id", id)); if (b.ExecuteNonQuery() == 0) throw new ArgumentException("That slideshow is gone."); }
    }

    public void DeleteSlideshow(long id)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        using (var a = Cmd(c, "DELETE FROM slideshow_items WHERE slideshow_id = $id", tx, ("$id", id))) a.ExecuteNonQuery();
        using (var b = Cmd(c, "DELETE FROM slideshows WHERE id = $id", tx, ("$id", id))) b.ExecuteNonQuery();
        tx.Commit();
    }

    /// <summary>Replaces a slideshow's pictures (in this order; unknown ids are skipped).</summary>
    public void SetItems(long id, IEnumerable<long> ids)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        using (var exists = Cmd(c, "SELECT COUNT(*) FROM slideshows WHERE id = $id", tx, ("$id", id)))
            if (Convert.ToInt32(exists.ExecuteScalar(), CultureInfo.InvariantCulture) == 0) throw new ArgumentException("That slideshow is gone.");
        using (var del = Cmd(c, "DELETE FROM slideshow_items WHERE slideshow_id = $id", tx, ("$id", id))) del.ExecuteNonQuery();
        var pos = 0;
        foreach (var img in ids.Take(MaxSlideshowItems))
        {
            using var ins = Cmd(c, "INSERT INTO slideshow_items(slideshow_id, position, image_id) SELECT $s, $p, id FROM images WHERE id = $i", tx, ("$s", id), ("$p", pos), ("$i", img));
            if (ins.ExecuteNonQuery() > 0) pos++;
        }
        tx.Commit();
    }

    public void AddItems(long id, IEnumerable<long> ids)
    {
        var current = Query(new GalleryQuery(SlideshowId: id)).Select(i => i.Id).ToList();
        SetItems(id, current.Concat(ids.Where(x => !current.Contains(x))));
    }

    /// <summary>Closes gaps left by removed folders so positions stay 0..n-1.</summary>
    private static void Renumber(SqliteConnection c)
    {
        Exec(c, """
            CREATE TEMP TABLE IF NOT EXISTS renum AS SELECT slideshow_id, image_id, ROW_NUMBER() OVER (PARTITION BY slideshow_id ORDER BY position) - 1 AS p FROM slideshow_items;
            DELETE FROM slideshow_items;
            INSERT INTO slideshow_items(slideshow_id, position, image_id) SELECT slideshow_id, p, image_id FROM renum;
            DROP TABLE renum;
            """);
    }

    private static string CleanName(string? name)
    {
        var t = new string((name ?? "").Where(ch => !char.IsControl(ch)).ToArray()).Trim();
        if (t.Length == 0) throw new ArgumentException("Give the slideshow a name.");
        return t.Length > 80 ? t[..80].TrimEnd() : t;
    }

    /// <summary>Settings are the page's JSON object (interval, transition, music…); kept small and well-formed.</summary>
    private static string CleanSettings(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "{}";
        if (s.Length > 4000) throw new ArgumentException("Slideshow settings are too large.");
        try { using var d = System.Text.Json.JsonDocument.Parse(s); return d.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object ? s : "{}"; }
        catch (System.Text.Json.JsonException) { return "{}"; }
    }

    // ------------------------------------------------------------------ state

    public string? GetState(string key)
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT value FROM state WHERE key = $k", null, ("$k", key));
        return cmd.ExecuteScalar() as string;
    }

    public void SetState(string key, string value)
    {
        using var c = Open();
        using var cmd = Cmd(c, "INSERT INTO state(key, value) VALUES ($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value", null, ("$k", key), ("$v", value));
        cmd.ExecuteNonQuery();
    }
}


/// <summary>A picture that moved: from → to. Undo moves it back.</summary>
public sealed record PictureMove(long Id, string From, string To);

/// <summary>
/// Organizing pictures on disk: rename, a numbered series ("Wakacje 001…"), move to another album, make a new album.
/// Everything is checked before anything moves, nothing is ever overwritten, and the last change can be undone.
/// Deleting goes to the Recycle Bin (done by the host).
/// </summary>
public sealed class GalleryOrganizer(GalleryLibrary library)
{
    private static readonly char[] Invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    public IReadOnlyList<PictureMove>? LastChange { get; private set; }

    public IReadOnlyList<PictureMove> Rename(long id, string newName) => RenameMany([(id, newName)]);

    /// <summary>"Wakacje 001", "Wakacje 002"… in the given order (the pictures stay in their folders).</summary>
    public IReadOnlyList<PictureMove> RenameSeries(IReadOnlyList<long> ids, string baseName, int start = 1)
    {
        var b = (baseName ?? "").Trim();
        if (b.Length == 0) throw new ArgumentException("Give the pictures a name.");
        var digits = Math.Max(2, (start + ids.Count - 1).ToString(CultureInfo.InvariantCulture).Length);
        return RenameMany(ids.Select((id, i) => (id, $"{b} {(start + i).ToString(CultureInfo.InvariantCulture).PadLeft(digits, '0')}")).ToList());
    }

    private IReadOnlyList<PictureMove> RenameMany(IReadOnlyList<(long Id, string Name)> items)
    {
        var plan = new List<PictureMove>();
        foreach (var (id, name) in items)
        {
            var img = library.Get(id) ?? throw new ArgumentException("That picture is no longer in the Gallery.");
            var p = SafeRename.Plan(img.Path, name);
            var target = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(img.Path)!, StripExt(name.Trim(), img.Path) + System.IO.Path.GetExtension(img.Path));
            // The only acceptable problem: the name is taken by another picture of this same rename (it moves away first).
            var freedByThis = items.Any(o => o.Id != id && library.Get(o.Id)?.Path is { } op && string.Equals(op, target, StringComparison.OrdinalIgnoreCase));
            var problems = p.Problems.Where(x => !(freedByThis && x.StartsWith("A file named", StringComparison.Ordinal))).ToList();
            if (problems.Count > 0) throw new ArgumentException(problems[0]);
            if (!string.Equals(target, img.Path, StringComparison.Ordinal)) plan.Add(new PictureMove(id, img.Path, target));
        }
        if (plan.Select(m => m.To).Distinct(StringComparer.OrdinalIgnoreCase).Count() != plan.Count) throw new ArgumentException("Two pictures would get the same name.");
        return Execute(plan);
    }

    private static string StripExt(string name, string path) =>
        name.EndsWith(System.IO.Path.GetExtension(path), StringComparison.OrdinalIgnoreCase) ? name[..^System.IO.Path.GetExtension(path).Length].TrimEnd() : name;

    /// <summary>Moves pictures into another folder of the Gallery (an album). Nothing moves if any name is taken there.</summary>
    public IReadOnlyList<PictureMove> Move(IReadOnlyList<long> ids, string folder)
    {
        var target = System.IO.Path.GetFullPath(folder);
        if (!Directory.Exists(target) || !library.IsInside(target)) throw new ArgumentException("Choose an album (a folder) of the Gallery.");
        var plan = new List<PictureMove>();
        foreach (var id in ids.Distinct())
        {
            var img = library.Get(id) ?? throw new ArgumentException("That picture is no longer in the Gallery.");
            if (!File.Exists(img.Path)) throw new ArgumentException($"“{System.IO.Path.GetFileName(img.Path)}” is not there any more.");
            var dest = System.IO.Path.Combine(target, System.IO.Path.GetFileName(img.Path));
            if (string.Equals(dest, img.Path, StringComparison.OrdinalIgnoreCase)) continue; // already there
            if (File.Exists(dest) || Directory.Exists(dest)) throw new ArgumentException($"“{System.IO.Path.GetFileName(dest)}” already exists in that album. Nothing was moved.");
            plan.Add(new PictureMove(id, img.Path, dest));
        }
        if (plan.Select(m => m.To).Distinct(StringComparer.OrdinalIgnoreCase).Count() != plan.Count) throw new ArgumentException("Two of these pictures have the same name, so they can't go into one album.");
        return Execute(plan);
    }

    /// <summary>Makes a new album (a folder) inside a Gallery folder. Returns its path.</summary>
    public string CreateAlbum(string parent, string name)
    {
        var n = (name ?? "").Trim();
        if (n.Length == 0 || n.IndexOfAny(Invalid) >= 0 || n.Any(char.IsControl) || n.EndsWith('.') || n == "..") throw new ArgumentException("That is not a valid folder name.");
        var p = System.IO.Path.GetFullPath(parent);
        if (!Directory.Exists(p) || !library.IsInside(p)) throw new ArgumentException("New albums go inside a Gallery folder.");
        var full = System.IO.Path.Combine(p, n);
        if (Directory.Exists(full) || File.Exists(full)) throw new ArgumentException($"“{n}” already exists there.");
        Directory.CreateDirectory(full);
        return full;
    }

    /// <summary>Puts the last rename or move back (only pictures still where it left them).</summary>
    public IReadOnlyList<PictureMove> Undo()
    {
        var last = LastChange ?? throw new ArgumentException("There is nothing to undo.");
        var back = last.Where(m => File.Exists(m.To) && !File.Exists(m.From)).Select(m => new PictureMove(m.Id, m.To, m.From)).ToList();
        if (back.Count == 0) throw new ArgumentException("The pictures were changed since, so there is nothing to put back.");
        var done = Execute(back);
        LastChange = null;
        return done;
    }

    /// <summary>Two phases (each file to a temporary name, then to its new name) so names can be swapped; nothing is overwritten.</summary>
    private IReadOnlyList<PictureMove> Execute(IReadOnlyList<PictureMove> plan)
    {
        var temps = new List<(PictureMove Move, string Temp)>();
        try
        {
            foreach (var m in plan)
            {
                var tmp = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(m.From)!, $".noormd-move-{Guid.NewGuid():N}{System.IO.Path.GetExtension(m.From)}");
                File.Move(m.From, tmp, overwrite: false);
                temps.Add((m, tmp));
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            foreach (var (m, tmp) in temps) try { File.Move(tmp, m.From, overwrite: false); } catch (Exception) { }
            throw new ArgumentException("Windows could not move the pictures (one may be open in another program). Nothing was changed.");
        }
        var done = new List<PictureMove>();
        var failed = new List<string>();
        foreach (var (m, tmp) in temps)
        {
            try { File.Move(tmp, m.To, overwrite: false); library.Relocate(m.Id, m.To); done.Add(m); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                try { File.Move(tmp, m.From, overwrite: false); } catch (Exception) { failed.Add(System.IO.Path.GetFileName(tmp)); }
            }
        }
        LastChange = done;
        if (failed.Count > 0) throw new ArgumentException($"Some pictures were left with a temporary name ({string.Join(", ", failed)}); rename them by hand.");
        if (done.Count < plan.Count) throw new ArgumentException($"{plan.Count - done.Count} picture(s) could not be moved; the others were.");
        return done;
    }
}
