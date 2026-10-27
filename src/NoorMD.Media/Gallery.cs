using System.Globalization;
using Microsoft.Data.Sqlite;

namespace NoorMD.Media;

public static class ImageFormats
{
    /// <summary>Pictures a web page shows as they are.</summary>
    private static readonly Dictionary<string, string> Web = new(StringComparer.OrdinalIgnoreCase)
    {
        [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".png"] = "image/png", [".gif"] = "image/gif", [".webp"] = "image/webp",
        [".bmp"] = "image/bmp", [".avif"] = "image/avif",
    };
    /// <summary>Work files and other formats: shown through a preview (Windows' thumbnail, or the one inside a PSD).</summary>
    private static readonly HashSet<string> Previewed = new(StringComparer.OrdinalIgnoreCase)
    {
        ".psd", ".psb", ".afphoto", ".afdesign", ".afpub", ".tif", ".tiff", ".heic", ".heif", ".jxl", ".kra", ".xcf", ".ico",
    };
    public static bool IsImage(string path) => Web.ContainsKey(Path.GetExtension(path)) || Previewed.Contains(Path.GetExtension(path));
    /// <summary>Whether the browser can show the file itself (otherwise NoorMD makes a preview).</summary>
    public static bool IsWeb(string path) => Web.ContainsKey(Path.GetExtension(path));
    public static string ContentType(string path) => Web.TryGetValue(Path.GetExtension(path), out var t) ? t : "application/octet-stream";
    /// <summary>"JPG", "PSD", "AFPHOTO"…</summary>
    public static string Format(string path) { var e = Path.GetExtension(path).TrimStart('.').ToUpperInvariant(); return e == "JPEG" ? "JPG" : e == "TIFF" ? "TIF" : e; }
}

/// <summary>
/// Photoshop files (.psd, .psb) keep a small JPEG preview among their "image resources" (id 1036, or 1033 in old files).
/// Reading it needs no Photoshop, and only the start of the file is read.
/// </summary>
public static class PsdPreview
{
    public static (int Width, int Height)? Size(string path)
    {
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var h = new byte[26];
            if (fs.Read(h, 0, 26) != 26 || h[0] != '8' || h[1] != 'B' || h[2] != 'P' || h[3] != 'S') return null;
            return ((int)BE32(h, 18), (int)BE32(h, 14));
        }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
    }

    /// <summary>The embedded JPEG preview, or null.</summary>
    public static byte[]? Jpeg(string path)
    {
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var br = new BinaryReader(fs);
            var h = br.ReadBytes(26);
            if (h.Length != 26 || h[0] != '8' || h[1] != 'B' || h[2] != 'P' || h[3] != 'S') return null;
            var colorLen = BE32(br.ReadBytes(4), 0);
            fs.Seek(colorLen, SeekOrigin.Current);
            var resLen = BE32(br.ReadBytes(4), 0);
            var end = fs.Position + resLen;
            if (resLen > 64 * 1024 * 1024 || end > fs.Length) return null;
            while (fs.Position + 12 <= end)
            {
                var sig = br.ReadBytes(4);
                if (sig.Length < 4 || sig[0] != '8' || sig[1] != 'B' || sig[2] != 'I' || sig[3] != 'M') return null;
                var id = (br.ReadByte() << 8) | br.ReadByte();
                var nameLen = br.ReadByte();
                fs.Seek(nameLen + ((nameLen + 1) % 2 == 0 ? 0 : 1), SeekOrigin.Current); // Pascal string, padded to even
                var size = BE32(br.ReadBytes(4), 0);
                if (size > end - fs.Position) return null;
                if ((id == 1036 || id == 1033) && size > 28)
                {
                    fs.Seek(28, SeekOrigin.Current); // format, width, height, row bytes, sizes, bits, planes
                    var jpeg = br.ReadBytes((int)size - 28);
                    return jpeg.Length > 3 && jpeg[0] == 0xFF && jpeg[1] == 0xD8 ? jpeg : null;
                }
                fs.Seek(size + (size % 2), SeekOrigin.Current);
            }
            return null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or EndOfStreamException) { return null; }
    }

    private static uint BE32(byte[] b, int i) => b.Length < i + 4 ? 0 : (uint)(b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]);
}

public sealed record GalleryImage(long Id, string Path, string Name, string Album, string AlbumKey, long Size, int Width, int Height,
    DateTime TakenUtc, bool Favorite, bool Missing)
{
    public string Format => ImageFormats.Format(Path);
}

public sealed record GalleryAlbum(string Key, string Name, string Folder, int Count, long? CoverId, DateTime? LatestUtc);
public sealed record GalleryFolder(long Id, string Path, int Count);
public sealed record Slideshow(long Id, string Name, int Count, string Settings, DateTime CreatedUtc);

/// <param name="Filter">"all" or "favorites".</param>
/// <param name="Sort">"taken" (date taken), "name", "added", "type" (format, then name) or "size".</param>
/// <param name="Format">Only one format ("JPG", "PSD"…), or null for all.</param>
public sealed record GalleryQuery(string? Search = null, string Filter = "all", string? AlbumKey = null, long? SlideshowId = null, string Sort = "taken", bool Descending = true, int Limit = 5000, string? Format = null);

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
            if (System.IO.Path.GetExtension(path).ToLowerInvariant() is ".psd" or ".psb")
                return PsdPreview.Size(path) is { } ps ? (ps.Width, ps.Height, fileDateUtc) : (0, 0, fileDateUtc);
            if (!ImageFormats.IsWeb(path) && System.IO.Path.GetExtension(path).ToLowerInvariant() is not (".tif" or ".tiff")) return (0, 0, fileDateUtc); // work files: their own formats
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

    /// <summary>The formats in the library with how many pictures each ("JPG" 1200, "PSD" 40…).</summary>
    public IReadOnlyList<(string Format, int Count)> Formats() =>
        Rows($"SELECT {Cols} FROM images i WHERE i.missing = 0").GroupBy(i => i.Format).Select(g => (g.Key, g.Count())).OrderByDescending(x => x.Item2).ToList();

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
        var order = q.Sort switch { "name" or "type" => "lower(i.name)", "added" => "i.added", "size" => "i.size", _ => "i.taken" } + (q.Descending ? " DESC" : "") + ", i.id";
        var rows = Rows($"SELECT {Cols} FROM images i WHERE {string.Join(" AND ", where)} ORDER BY {order}", [.. args]);
        if (!string.IsNullOrWhiteSpace(q.Format)) rows = rows.Where(i => string.Equals(i.Format, q.Format, StringComparison.OrdinalIgnoreCase)).ToList();
        if (q.Sort == "type") rows = (q.Descending ? rows.OrderByDescending(i => i.Format) : rows.OrderBy(i => i.Format)).ThenBy(i => i.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
        if (!string.IsNullOrWhiteSpace(q.Search))
        {
            var terms = TextFold.Fold(q.Search).Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(6).ToList();
            rows = rows.Where(i => terms.All(t => TextFold.Fold(i.Name + " " + i.Album + " " + i.Format).Contains(t, StringComparison.Ordinal))).ToList();
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

    /// <summary>A folder was renamed by NoorMD: every picture inside follows (and the Gallery folder itself, if it was one).</summary>
    public void RelocateFolder(string oldDir, string newDir)
    {
        var from = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(oldDir));
        var to = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(newDir));
        using (var c = Open())
        using (var tx = c.BeginTransaction())
        {
            using (var f = Cmd(c, "UPDATE folders SET path = $p, path_key = $k WHERE path_key = $old", tx, ("$p", to), ("$k", MusicLibrary.PathKey(to)), ("$old", MusicLibrary.PathKey(from)))) f.ExecuteNonQuery();
            tx.Commit();
        }
        var inside = Rows($"SELECT {Cols} FROM images i").Where(i => i.Path.StartsWith(from + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)).ToList();
        foreach (var i in inside) Relocate(i.Id, to + i.Path[from.Length..]);
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
    /// <param name="anywhere">Also a folder outside the Gallery folders (chosen in Windows' folder dialog); the pictures then leave the Gallery.</param>
    public IReadOnlyList<PictureMove> Move(IReadOnlyList<long> ids, string folder, bool anywhere = false)
    {
        var target = System.IO.Path.GetFullPath(folder);
        if (!Directory.Exists(target) || (!anywhere && !library.IsInside(target))) throw new ArgumentException("Choose an album (a folder) of the Gallery.");
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
    /// <summary>Copies pictures into any folder (the originals stay). Nothing is copied if a name is taken there. Returns the new files.</summary>
    public IReadOnlyList<string> Copy(IReadOnlyList<long> ids, string folder)
    {
        var target = System.IO.Path.GetFullPath(folder);
        if (!Directory.Exists(target)) throw new ArgumentException("That folder doesn't exist.");
        var plan = new List<(string From, string To)>();
        foreach (var id in ids.Distinct())
        {
            var img = library.Get(id) ?? throw new ArgumentException("That picture is no longer in the Gallery.");
            if (!File.Exists(img.Path)) throw new ArgumentException($"“{System.IO.Path.GetFileName(img.Path)}” is not there any more.");
            var dest = System.IO.Path.Combine(target, System.IO.Path.GetFileName(img.Path));
            if (File.Exists(dest) || Directory.Exists(dest)) throw new ArgumentException($"“{System.IO.Path.GetFileName(dest)}” already exists there. Nothing was copied.");
            plan.Add((img.Path, dest));
        }
        if (plan.Select(x => x.To).Distinct(StringComparer.OrdinalIgnoreCase).Count() != plan.Count) throw new ArgumentException("Two of these pictures have the same name, so they can't go into one folder.");
        var made = new List<string>();
        foreach (var (from, to) in plan)
        {
            try { File.Copy(from, to, overwrite: false); made.Add(to); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { throw new ArgumentException($"Copying stopped at “{System.IO.Path.GetFileName(from)}”: {ex.Message} ({made.Count} copied before it)."); }
        }
        return made;
    }

    private (string From, string To)? _lastAlbum;

    /// <summary>Renames an album (a folder inside, or one of, the Gallery folders). The pictures inside follow.</summary>
    public string RenameAlbum(string folder, string newName)
    {
        var n = (newName ?? "").Trim();
        if (n.Length == 0 || n.IndexOfAny(Invalid) >= 0 || n.Any(char.IsControl) || n.EndsWith('.') || n is "." or "..") throw new ArgumentException("That is not a valid folder name.");
        var from = System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(folder));
        if (!Directory.Exists(from) || !library.IsInside(from)) throw new ArgumentException("That album is not in the Gallery.");
        var parent = System.IO.Path.GetDirectoryName(from) ?? throw new ArgumentException("A drive can't be renamed.");
        var to = System.IO.Path.Combine(parent, n);
        if (string.Equals(from, to, StringComparison.Ordinal)) return to;
        var caseOnly = string.Equals(from, to, StringComparison.OrdinalIgnoreCase);
        if (!caseOnly && (Directory.Exists(to) || File.Exists(to))) throw new ArgumentException($"“{n}” already exists there.");
        try
        {
            if (caseOnly) { var tmp = from + ".noormd-" + Guid.NewGuid().ToString("N")[..8]; Directory.Move(from, tmp); Directory.Move(tmp, to); }
            else Directory.Move(from, to);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { throw new ArgumentException($"Windows could not rename the folder (a file in it may be open in another program): {ex.Message}"); }
        library.RelocateFolder(from, to);
        _lastAlbum = (from, to);
        LastChange = null;
        return to;
    }

    public IReadOnlyList<PictureMove> Undo()
    {
        if (_lastAlbum is { } la && LastChange == null)
        {
            _lastAlbum = null;
            if (!Directory.Exists(la.To) || Directory.Exists(la.From)) throw new ArgumentException("The album was changed since, so it can't be renamed back.");
            Directory.Move(la.To, la.From);
            library.RelocateFolder(la.To, la.From);
            return [];
        }
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
            try
            {
                File.Move(tmp, m.To, overwrite: false);
                if (library.IsInside(System.IO.Path.GetDirectoryName(m.To)!)) library.Relocate(m.Id, m.To); else library.Forget([m.Id]); // moved out of the Gallery
                done.Add(m);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                try { File.Move(tmp, m.From, overwrite: false); } catch (Exception) { failed.Add(System.IO.Path.GetFileName(tmp)); }
            }
        }
        LastChange = done;
        _lastAlbum = null;
        if (failed.Count > 0) throw new ArgumentException($"Some pictures were left with a temporary name ({string.Join(", ", failed)}); rename them by hand.");
        if (done.Count < plan.Count) throw new ArgumentException($"{plan.Count - done.Count} picture(s) could not be moved; the others were.");
        return done;
    }
}


/// <summary>
/// Finding the same picture more than once: exact copies (same bytes, found by size and then SHA-256 of the content), and
/// optionally look-alikes (resized or re-saved: a "difference hash" of a tiny grey version, compared bit by bit).
/// </summary>
public static class GalleryDuplicates
{
    public static List<List<GalleryImage>> Exact(IEnumerable<GalleryImage> images, IProgress<int>? progress = null, CancellationToken ct = default)
    {
        var groups = new List<List<GalleryImage>>();
        var done = 0;
        foreach (var bySize in images.Where(i => i.Size > 0 && File.Exists(i.Path)).GroupBy(i => i.Size).Where(g => g.Count() > 1))
        {
            var byHash = new Dictionary<string, List<GalleryImage>>();
            foreach (var img in bySize)
            {
                ct.ThrowIfCancellationRequested();
                string h;
                try
                {
                    using var fs = new FileStream(img.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16, FileOptions.SequentialScan);
                    h = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(fs));
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { continue; }
                (byHash.TryGetValue(h, out var l) ? l : byHash[h] = []).Add(img);
                progress?.Report(++done);
            }
            groups.AddRange(byHash.Values.Where(l => l.Count > 1));
        }
        return groups;
    }

    /// <summary>A 64-bit difference hash from 9×8 grey values (row by row): each bit says "brighter than the pixel to the right".</summary>
    public static ulong DHash(ReadOnlySpan<byte> grey9x8)
    {
        if (grey9x8.Length < 72) throw new ArgumentException("Need 9×8 grey values.");
        ulong h = 0;
        for (var y = 0; y < 8; y++)
            for (var x = 0; x < 8; x++)
                h = (h << 1) | (grey9x8[y * 9 + x] > grey9x8[y * 9 + x + 1] ? 1UL : 0UL);
        return h;
    }

    public static int Distance(ulong a, ulong b) => System.Numerics.BitOperations.PopCount(a ^ b);

    /// <summary>Groups pictures whose hashes differ in at most <paramref name="maxBits"/> bits (5 ≈ the same picture resized or re-saved).</summary>
    public static List<List<GalleryImage>> Similar(IReadOnlyList<(GalleryImage Image, ulong Hash)> hashed, int maxBits = 5)
    {
        var parent = Enumerable.Range(0, hashed.Count).ToArray();
        int Find(int i) { while (parent[i] != i) i = parent[i] = parent[parent[i]]; return i; }
        for (var i = 0; i < hashed.Count; i++)
            for (var j = i + 1; j < hashed.Count; j++)
                if (Distance(hashed[i].Hash, hashed[j].Hash) <= maxBits) parent[Find(i)] = Find(j);
        return Enumerable.Range(0, hashed.Count).GroupBy(Find).Where(g => g.Count() > 1).Select(g => g.Select(i => hashed[i].Image).ToList()).ToList();
    }
}

/// <summary>Packs pictures into one ZIP (names made unique: "IMG_1.jpg", "IMG_1 (2).jpg"). Already-compressed formats are stored as they are.</summary>
public static class GalleryZip
{
    public static int Create(IReadOnlyList<string> files, string destination)
    {
        if (files.Count == 0) throw new ArgumentException("Choose some pictures to pack.");
        var dest = System.IO.Path.GetFullPath(destination);
        var tmp = dest + ".noormd-tmp";
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var count = 0;
        try
        {
            using (var zip = System.IO.Compression.ZipFile.Open(tmp, System.IO.Compression.ZipArchiveMode.Create))
                foreach (var f in files)
                {
                    if (!File.Exists(f)) continue;
                    var name = System.IO.Path.GetFileName(f);
                    var stem = System.IO.Path.GetFileNameWithoutExtension(f);
                    var ext = System.IO.Path.GetExtension(f);
                    for (var i = 2; !names.Add(name); i++) name = $"{stem} ({i}){ext}";
                    var stored = ext.ToLowerInvariant() is ".jpg" or ".jpeg" or ".png" or ".gif" or ".webp" or ".avif" or ".heic";
                    System.IO.Compression.ZipFileExtensions.CreateEntryFromFile(zip, f, name, stored ? System.IO.Compression.CompressionLevel.NoCompression : System.IO.Compression.CompressionLevel.Optimal);
                    count++;
                }
            using (var check = System.IO.Compression.ZipFile.OpenRead(tmp))
                if (check.Entries.Count != count) throw new IOException("The ZIP could not be verified after writing.");
            File.Move(tmp, dest, overwrite: true); // the save dialog already asked before replacing an existing file
            return count;
        }
        finally { if (File.Exists(tmp)) try { File.Delete(tmp); } catch (IOException) { } }
    }
}
