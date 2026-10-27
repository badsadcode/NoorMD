using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace NoorMD.Media;

public static class VideoFormats
{
    private static readonly Dictionary<string, string> Types = new(StringComparer.OrdinalIgnoreCase)
    {
        [".mp4"] = "video/mp4", [".m4v"] = "video/mp4", [".mov"] = "video/mp4", [".webm"] = "video/webm", [".mkv"] = "video/webm", [".ogv"] = "video/ogg",
    };
    public static readonly string[] SubtitleExtensions = [".srt", ".vtt", ".ass", ".ssa"];
    public static bool IsVideo(string path) => Types.ContainsKey(Path.GetExtension(path));
    public static string ContentType(string path) => Types.TryGetValue(Path.GetExtension(path), out var t) ? t : "application/octet-stream";
    public static IEnumerable<string> Extensions => Types.Keys;
}

/// <summary>Season/episode from a file name: "S01E02", "1x02", "Episode 3", "E03", "Part 2", "- 03 -", or a leading number.</summary>
public static class EpisodeParser
{
    private static readonly Regex SxE = new(@"(?i)\bs(\d{1,3})[ ._-]*e(\d{1,4})", RegexOptions.CultureInvariant);
    private static readonly Regex NxN = new(@"(?i)(?<![\dx])(\d{1,2})x(\d{1,3})(?![\dp])", RegexOptions.CultureInvariant);
    private static readonly Regex Word = new(@"(?i)\b(?:episode|ep|e|part|pt|odcinek|odc)[ ._-]*(\d{1,4})\b", RegexOptions.CultureInvariant);
    private static readonly Regex Dash = new(@"\s-\s(\d{1,4})(?:\s|$|\.|-)", RegexOptions.CultureInvariant);
    private static readonly Regex Lead = new(@"^(\d{1,4})(?:[ ._)-]|$)", RegexOptions.CultureInvariant);

    public static (int? Season, int? Episode) Parse(string fileName)
    {
        var name = Path.GetFileNameWithoutExtension(fileName);
        // Resolutions and years are not episode numbers.
        var clean = Regex.Replace(name, @"(?i)\b(\d{3,4}p|[12]\d{3}|x26[45]|h\.?26[45])\b", " ");
        if (SxE.Match(clean) is { Success: true } m) return (int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture), int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture));
        if (NxN.Match(clean) is { Success: true } x) return (int.Parse(x.Groups[1].Value, CultureInfo.InvariantCulture), int.Parse(x.Groups[2].Value, CultureInfo.InvariantCulture));
        foreach (var r in new[] { Word, Dash, Lead })
            if (r.Match(clean) is { Success: true } w) return (null, int.Parse(w.Groups[1].Value, CultureInfo.InvariantCulture));
        return (null, null);
    }

    /// <summary>Sort key that orders "Episode 2" before "Episode 10".</summary>
    public static string NaturalKey(string s) => Regex.Replace(TextFold.Fold(s), @"\d+", m => m.Value.TrimStart('0').PadLeft(10, '0'));
}

/// <summary>Converts sidecar subtitles to WebVTT for the player. ASS/SSA styling and positioning are dropped; the text and timing are kept.</summary>
public static class SubtitleConverter
{
    public const int MaxBytes = 8 * 1024 * 1024;

    public static string ToVtt(string text, string extension)
    {
        text = text.Replace("\r\n", "\n").Replace('\r', '\n').TrimStart('﻿');
        return extension.ToLowerInvariant() switch
        {
            ".vtt" => text.StartsWith("WEBVTT", StringComparison.Ordinal) ? text : "WEBVTT\n\n" + text,
            ".ass" or ".ssa" => FromAss(text),
            _ => FromSrt(text),
        };
    }

    private static readonly Regex SrtTime = new(@"^\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})", RegexOptions.CultureInvariant);

    private static string FromSrt(string text)
    {
        var sb = new StringBuilder("WEBVTT\n\n");
        foreach (var block in Regex.Split(text.Trim(), @"\n\s*\n"))
        {
            var lines = block.Split('\n').ToList();
            var i = lines.FindIndex(l => SrtTime.IsMatch(l));
            if (i < 0) continue;
            var m = SrtTime.Match(lines[i]);
            string T(int g) => $"{int.Parse(m.Groups[g].Value, CultureInfo.InvariantCulture):00}:{int.Parse(m.Groups[g + 1].Value, CultureInfo.InvariantCulture):00}:{int.Parse(m.Groups[g + 2].Value, CultureInfo.InvariantCulture):00}.{m.Groups[g + 3].Value.PadRight(3, '0')}";
            var body = string.Join('\n', lines.Skip(i + 1)).Trim();
            if (body.Length == 0) continue;
            // Keep the simple markup VTT shares with SRT (<i>, <b>, <u>); drop font tags and anything else.
            body = Regex.Replace(body, @"</?(?!(?:i|b|u)>)[a-zA-Z][^>]*>", "").Replace("-->", "→");
            sb.Append(T(1)).Append(" --> ").Append(T(5)).Append('\n').Append(body).Append("\n\n");
        }
        return sb.ToString();
    }

    private static string FromAss(string text)
    {
        var sb = new StringBuilder("WEBVTT\n\n");
        string[]? format = null;
        var inEvents = false;
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (line.StartsWith('[')) { inEvents = line.Equals("[Events]", StringComparison.OrdinalIgnoreCase); continue; }
            if (!inEvents) continue;
            if (line.StartsWith("Format:", StringComparison.OrdinalIgnoreCase)) { format = line[7..].Split(',').Select(f => f.Trim().ToLowerInvariant()).ToArray(); continue; }
            if (!line.StartsWith("Dialogue:", StringComparison.OrdinalIgnoreCase) || format == null) continue;
            var parts = line[9..].Split(',', format.Length);
            if (parts.Length < format.Length) continue;
            int Col(string n) => Array.IndexOf(format, n);
            int s = Col("start"), e = Col("end"), t = Col("text");
            if (s < 0 || e < 0 || t < 0) continue;
            if (!TryAssTime(parts[s], out var start) || !TryAssTime(parts[e], out var end) || end <= start) continue;
            var body = Regex.Replace(parts[t], @"\{[^}]*\}", "").Replace("\\N", "\n").Replace("\\n", "\n").Replace("\\h", " ").Replace("-->", "→").Trim();
            if (body.Length == 0) continue;
            sb.Append(Vtt(start)).Append(" --> ").Append(Vtt(end)).Append('\n').Append(body).Append("\n\n");
        }
        return sb.ToString();
    }

    private static bool TryAssTime(string s, out TimeSpan t) =>
        TimeSpan.TryParseExact(s.Trim(), [@"h\:mm\:ss\.ff", @"h\:mm\:ss\.fff", @"h\:mm\:ss"], CultureInfo.InvariantCulture, out t);

    private static string Vtt(TimeSpan t) => $"{(int)t.TotalHours:00}:{t.Minutes:00}:{t.Seconds:00}.{t.Milliseconds:000}";

    /// <summary>Sidecar subtitle files next to a video: "Name.srt", "Name.en.srt", "Name.English.forced.ass"…</summary>
    public static IReadOnlyList<(string Path, string Label)> Find(string videoPath)
    {
        var dir = Path.GetDirectoryName(videoPath);
        var stem = Path.GetFileNameWithoutExtension(videoPath);
        if (dir == null || !Directory.Exists(dir)) return [];
        var list = new List<(string, string)>();
        try
        {
            foreach (var f in Directory.EnumerateFiles(dir))
            {
                var ext = Path.GetExtension(f);
                if (!VideoFormats.SubtitleExtensions.Contains(ext, StringComparer.OrdinalIgnoreCase)) continue;
                var name = Path.GetFileNameWithoutExtension(f);
                if (!name.StartsWith(stem, StringComparison.OrdinalIgnoreCase)) continue;
                var rest = name[stem.Length..].Trim('.', ' ', '_', '-');
                if (name.Length > stem.Length && !".-_ ".Contains(name[stem.Length])) continue; // "Show 1" must not take "Show 10.srt"
                list.Add((f, (rest.Length == 0 ? "Subtitles" : rest) + " (" + ext.TrimStart('.').ToUpperInvariant() + ")"));
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        return list.OrderBy(x => x.Item2, StringComparer.OrdinalIgnoreCase).ToList();
    }
}

public sealed record VideoRow(long Id, string Path, string Title, string Series, string SeriesKey, int? Season, int? Episode, double Duration, int Width, int Height,
    double Position, bool Watched, DateTime? LastWatchedUtc, bool Missing, int NoteCount)
{
    public string FileName => System.IO.Path.GetFileName(Path);
    public string Folder => System.IO.Path.GetDirectoryName(Path) ?? "";
}

public sealed record VideoSeries(string Key, string Name, string Folder, int Count, int Watched, DateTime? LastWatchedUtc, long? ResumeId);
public sealed record VideoNote(long Id, long VideoId, double Time, string Text, DateTime CreatedUtc);
public sealed record VideoFolder(long Id, string Path, int Count);
public sealed record VideoPlaylist(long Id, string Name, int Count, double Duration, int Watched);

/// <summary>A library view: search, a filter (all, unwatched, inprogress, watched), one series or one playlist, and a sort.</summary>
public sealed record VideoQuery(string? Search = null, string Filter = "all", string? SeriesKey = null, long? PlaylistId = null, string Sort = "series", bool Descending = false);

/// <summary>
/// Local video library: folders scanned for video files, grouped into series by folder, ordered as episodes.
/// Keeps resume positions, watched state and timestamped notes. Like the music library, it never changes the files.
/// </summary>
public sealed class VideoLibrary
{
    private readonly string _cs;
    public const double WatchedFraction = 0.92;

    public VideoLibrary(string databasePath)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(databasePath)!);
        _cs = new SqliteConnectionStringBuilder { DataSource = databasePath, Mode = SqliteOpenMode.ReadWriteCreate, Pooling = true }.ToString();
        using var c = Open();
        Exec(c, """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS folders (id INTEGER PRIMARY KEY, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE, last_scan TEXT);
            CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY, folder_id INTEGER NOT NULL, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE,
              size INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL, series TEXT NOT NULL, series_key TEXT NOT NULL,
              season INTEGER, episode INTEGER, sort_key TEXT NOT NULL, duration REAL NOT NULL DEFAULT 0, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0,
              position REAL NOT NULL DEFAULT 0, watched INTEGER NOT NULL DEFAULT 0, last_watched TEXT, missing INTEGER NOT NULL DEFAULT 0, added TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS ix_videos_series ON videos(series_key);
            CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, video_id INTEGER NOT NULL, t REAL NOT NULL, text TEXT NOT NULL, created TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS ix_notes_video ON notes(video_id, t);
            CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS playlist_items (playlist_id INTEGER NOT NULL, position INTEGER NOT NULL, video_id INTEGER NOT NULL, PRIMARY KEY (playlist_id, position));
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
    private static DateTime? ParseIso(object? v) => v is string s ? DateTime.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind) : null;

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
        using (var n = Cmd(c, "DELETE FROM notes WHERE video_id IN (SELECT id FROM videos WHERE folder_id = $f)", tx, ("$f", id))) n.ExecuteNonQuery();
        using (var v = Cmd(c, "DELETE FROM videos WHERE folder_id = $f", tx, ("$f", id))) v.ExecuteNonQuery();
        using (var f = Cmd(c, "DELETE FROM folders WHERE id = $f", tx, ("$f", id))) f.ExecuteNonQuery();
        tx.Commit();
    }

    public IReadOnlyList<VideoFolder> Folders()
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT f.id, f.path, (SELECT COUNT(*) FROM videos v WHERE v.folder_id = f.id AND v.missing = 0) FROM folders f ORDER BY lower(f.path)");
        using var r = cmd.ExecuteReader();
        var list = new List<VideoFolder>();
        while (r.Read()) list.Add(new VideoFolder(r.GetInt64(0), r.GetString(1), r.GetInt32(2)));
        return list;
    }

    /// <summary>Scans a folder (subfolders included). Known files keep their id, position, watched state and notes.</summary>
    public (int Found, int Added, int Missing) Scan(long folderId, CancellationToken ct = default)
    {
        string root;
        using (var c0 = Open())
        using (var q = Cmd(c0, "SELECT path FROM folders WHERE id = $id", null, ("$id", folderId)))
            root = q.ExecuteScalar() as string ?? throw new ArgumentException("Unknown folder.");
        if (!Directory.Exists(root)) return (0, 0, 0); // a disconnected drive: nothing is marked missing
        var opts = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.System | FileAttributes.Hidden };
        var files = Directory.EnumerateFiles(root, "*", opts).Where(VideoFormats.IsVideo).ToList();
        var known = new Dictionary<string, (long Id, long Size, long Mtime)>();
        using var c = Open();
        using (var cmd = Cmd(c, "SELECT id, path_key, size, mtime FROM videos WHERE folder_id = $f", null, ("$f", folderId)))
        using (var r = cmd.ExecuteReader())
            while (r.Read()) known[r.GetString(1)] = (r.GetInt64(0), r.GetInt64(2), r.GetInt64(3));
        using var tx = c.BeginTransaction();
        var seen = new HashSet<long>();
        var added = 0;
        foreach (var f in files)
        {
            ct.ThrowIfCancellationRequested();
            var info = new FileInfo(f);
            var key = MusicLibrary.PathKey(f);
            var dir = System.IO.Path.GetDirectoryName(f)!;
            var series = string.Equals(dir.TrimEnd('\\', '/'), root.TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase) ? System.IO.Path.GetFileName(root.TrimEnd('\\', '/')) : System.IO.Path.GetFileName(dir);
            if (known.TryGetValue(key, out var k))
            {
                seen.Add(k.Id);
                if (k.Size == info.Length && k.Mtime == info.LastWriteTimeUtc.Ticks)
                {
                    using var ok = Cmd(c, "UPDATE videos SET missing = 0 WHERE id = $id", tx, ("$id", k.Id));
                    ok.ExecuteNonQuery();
                    continue;
                }
            }
            if (!known.ContainsKey(key))
            {
                // Indexed under another (overlapping) folder: this folder takes it over, keeping its id, position and notes.
                using var other = Cmd(c, "SELECT id FROM videos WHERE path_key = $k", tx, ("$k", key));
                if (other.ExecuteScalar() is long otherId) { known[key] = (otherId, -1, -1); seen.Add(otherId); }
            }
            var (season, episode) = EpisodeParser.Parse(f);
            double duration = 0; int w = 0, h = 0;
            try
            {
                using var tf = TagLib.File.Create(f, TagLib.ReadStyle.Average);
                duration = tf.Properties?.Duration.TotalSeconds ?? 0;
                w = tf.Properties?.VideoWidth ?? 0; h = tf.Properties?.VideoHeight ?? 0;
            }
            catch (Exception) { /* unknown container: the player still tries */ }
            var title = System.IO.Path.GetFileNameWithoutExtension(f);
            var args = new (string, object?)[] { ("$f", folderId), ("$p", f), ("$k", key), ("$s", info.Length), ("$m", info.LastWriteTimeUtc.Ticks), ("$t", title),
                ("$se", series), ("$sk", MusicLibrary.PathKey(dir)), ("$sn", season), ("$ep", episode),
                ("$o", $"{season ?? 0:D4}|{episode ?? 0:D5}|{EpisodeParser.NaturalKey(title)}"), ("$d", duration), ("$w", w), ("$h", h), ("$a", Iso(DateTime.UtcNow)) };
            if (known.TryGetValue(key, out var existing))
            {
                using var u = Cmd(c, "UPDATE videos SET folder_id=$f, size=$s, mtime=$m, title=$t, series=$se, series_key=$sk, season=$sn, episode=$ep, sort_key=$o, duration=$d, width=$w, height=$h, missing=0 WHERE id = $id", tx, [.. args, ("$id", existing.Id)]);
                u.ExecuteNonQuery();
            }
            else
            {
                using var ins = Cmd(c, "INSERT INTO videos(folder_id, path, path_key, size, mtime, title, series, series_key, season, episode, sort_key, duration, width, height, added) VALUES ($f,$p,$k,$s,$m,$t,$se,$sk,$sn,$ep,$o,$d,$w,$h,$a)", tx, args);
                ins.ExecuteNonQuery();
                added++;
            }
        }
        var missing = 0;
        foreach (var (_, k) in known)
            if (!seen.Contains(k.Id))
            {
                using var m = Cmd(c, "UPDATE videos SET missing = 1 WHERE id = $id", tx, ("$id", k.Id));
                m.ExecuteNonQuery();
                missing++;
            }
        using (var ls = Cmd(c, "UPDATE folders SET last_scan = $t WHERE id = $id", tx, ("$t", Iso(DateTime.UtcNow)), ("$id", folderId))) ls.ExecuteNonQuery();
        tx.Commit();
        return (files.Count, added, missing);
    }

    // ------------------------------------------------------------------ browsing

    private const string Cols = "v.id, v.path, v.title, v.series, v.series_key, v.season, v.episode, v.duration, v.width, v.height, v.position, v.watched, v.last_watched, v.missing, (SELECT COUNT(*) FROM notes n WHERE n.video_id = v.id)";

    private static VideoRow Read(SqliteDataReader r) => new(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4),
        r.IsDBNull(5) ? null : r.GetInt32(5), r.IsDBNull(6) ? null : r.GetInt32(6), r.GetDouble(7), r.GetInt32(8), r.GetInt32(9),
        r.GetDouble(10), r.GetInt64(11) == 1, ParseIso(r.IsDBNull(12) ? null : r.GetString(12)), r.GetInt64(13) == 1, r.GetInt32(14));

    private List<VideoRow> Rows(string where, params (string, object?)[] args) => Rows(where, args, "videos v");

    private List<VideoRow> Rows(string where, (string, object?)[] args, string from)
    {
        using var c = Open();
        using var cmd = Cmd(c, $"SELECT {Cols} FROM {from} {where}", null, args);
        using var r = cmd.ExecuteReader();
        var list = new List<VideoRow>();
        while (r.Read()) list.Add(Read(r));
        return list;
    }

    public VideoRow? Get(long id) => Rows("WHERE v.id = $id", ("$id", id)).FirstOrDefault();

    /// <summary>Episodes of a series (one folder) in watching order.</summary>
    public IReadOnlyList<VideoRow> Episodes(string seriesKey) => Rows("WHERE v.series_key = $k AND v.missing = 0 ORDER BY v.sort_key, v.id", ("$k", seriesKey));

    public IReadOnlyList<VideoRow> Search(string text, int limit = 200)
    {
        var terms = TextFold.Fold(text).Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(6).ToList();
        if (terms.Count == 0) return [];
        var all = Rows("WHERE v.missing = 0 ORDER BY v.series, v.sort_key");
        return all.Where(v => terms.All(t => TextFold.Fold(v.Title + " " + v.Series).Contains(t, StringComparison.Ordinal))).Take(limit).ToList();
    }

    public IReadOnlyList<VideoSeries> Series()
    {
        var all = Rows("WHERE v.missing = 0 ORDER BY v.sort_key, v.id");
        return all.GroupBy(v => v.SeriesKey).Select(g =>
        {
            var eps = g.ToList();
            var last = eps.Max(e => e.LastWatchedUtc);
            return new VideoSeries(g.Key, eps[0].Series, eps[0].Folder, eps.Count, eps.Count(e => e.Watched), last, ResumeIn(eps)?.Id);
        }).OrderByDescending(s => s.LastWatchedUtc ?? DateTime.MinValue).ThenBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    /// <summary>Where to continue a series: the last started, unfinished episode, else the first unwatched one after the last watched.</summary>
    public static VideoRow? ResumeIn(IReadOnlyList<VideoRow> episodes)
    {
        var started = episodes.Where(e => !e.Watched && e.Position > ResumeAfter(e.Duration) && e.LastWatchedUtc != null).OrderByDescending(e => e.LastWatchedUtc).FirstOrDefault();
        if (started != null) return started;
        var lastWatched = episodes.Select((e, i) => (e, i)).Where(x => x.e.Watched).OrderByDescending(x => x.e.LastWatchedUtc).FirstOrDefault();
        var from = lastWatched.e == null ? 0 : lastWatched.i + 1;
        return episodes.Skip(from).FirstOrDefault(e => !e.Watched) ?? episodes.FirstOrDefault(e => !e.Watched);
    }

    /// <summary>Recently watched, unfinished videos across all series.</summary>
    public IReadOnlyList<VideoRow> ContinueWatching(int limit = 12) =>
        Rows("WHERE v.missing = 0 AND v.watched = 0 AND v.position > MIN(5, v.duration * 0.1) AND v.last_watched IS NOT NULL ORDER BY v.last_watched DESC LIMIT $l", ("$l", limit));

    /// <summary>A video counts as started after 5 seconds (or a tenth of a very short clip).</summary>
    public static double ResumeAfter(double duration) => duration > 0 ? Math.Min(5, duration * 0.1) : 5;

    public VideoRow? NextEpisode(long id)
    {
        if (Get(id) is not { } v) return null;
        var eps = Episodes(v.SeriesKey);
        var i = eps.ToList().FindIndex(e => e.Id == id);
        return i >= 0 && i + 1 < eps.Count ? eps[i + 1] : null;
    }

    /// <summary>Saves the resume position. Near the end (92 % or the last 30 s) the video counts as watched and resumes from the start.</summary>
    public VideoRow? SetPosition(long id, double position, double duration)
    {
        if (!double.IsFinite(position) || position < 0) return Get(id);
        var watched = double.IsFinite(duration) && duration > 0 && (position >= duration * WatchedFraction || duration - position < 30 && duration > 120);
        using var c = Open();
        using var u = Cmd(c, "UPDATE videos SET position = $p, watched = MAX(watched, $w), last_watched = $t, duration = CASE WHEN $d > 0 THEN $d ELSE duration END WHERE id = $id", null,
            ("$p", watched ? 0 : position), ("$w", watched ? 1 : 0), ("$t", Iso(DateTime.UtcNow)), ("$d", double.IsFinite(duration) ? duration : 0), ("$id", id));
        u.ExecuteNonQuery();
        return Get(id);
    }

    public void SetWatched(IEnumerable<long> ids, bool watched)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        foreach (var id in ids)
        {
            using var u = Cmd(c, "UPDATE videos SET watched = $w, position = 0 WHERE id = $id", tx, ("$w", watched ? 1 : 0), ("$id", id));
            u.ExecuteNonQuery();
        }
        tx.Commit();
    }

    // ------------------------------------------------------------------ library views

    private static readonly Dictionary<string, string> Sorts = new()
    {
        ["series"] = "v.series COLLATE NOCASE, v.sort_key, v.id", ["title"] = "v.title COLLATE NOCASE, v.id", ["duration"] = "v.duration, v.id",
        ["recent"] = "v.last_watched IS NULL, v.last_watched DESC, v.id", ["added"] = "v.added DESC, v.id", ["playlist"] = "pi.position",
    };

    /// <summary>Videos of a view, in display order (capped at 20,000).</summary>
    public IReadOnlyList<VideoRow> Query(VideoQuery q)
    {
        var where = new List<string> { "v.missing = 0" };
        var args = new List<(string, object?)>();
        var from = "videos v";
        if (q.PlaylistId is long pl) { from = "playlist_items pi JOIN videos v ON v.id = pi.video_id"; where.Add("pi.playlist_id = $pl"); args.Add(("$pl", pl)); }
        if (!string.IsNullOrEmpty(q.SeriesKey)) { where.Add("v.series_key = $sk"); args.Add(("$sk", q.SeriesKey)); }
        where.Add(q.Filter switch
        {
            "unwatched" => "v.watched = 0",
            "inprogress" => "v.watched = 0 AND v.position > 0 AND v.last_watched IS NOT NULL",
            "watched" => "v.watched = 1",
            _ => "1 = 1",
        });
        var sort = q.PlaylistId == null && q.Sort == "playlist" ? "series" : q.Sort;
        var order = Sorts.TryGetValue(sort, out var o) ? o : Sorts["series"];
        if (q.Descending) order = string.Join(", ", order.Split(", ").Select(x => x.EndsWith(" DESC", StringComparison.Ordinal) ? x[..^5] : x + " DESC"));
        var rows = Rows($"WHERE {string.Join(" AND ", where)} ORDER BY {order} LIMIT 20000", args.ToArray(), from);
        var terms = TextFold.Fold(q.Search).Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(6).ToList();
        return terms.Count == 0 ? rows : rows.Where(v => terms.All(t => TextFold.Fold(v.Title + " " + v.Series + " " + v.FileName).Contains(t, StringComparison.Ordinal))).ToList();
    }

    public int Count()
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT COUNT(*) FROM videos WHERE missing = 0");
        return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    // ------------------------------------------------------------------ playlists

    public IReadOnlyList<VideoPlaylist> Playlists()
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT p.id, p.name, COUNT(v.id), COALESCE(SUM(v.duration), 0), COALESCE(SUM(v.watched), 0) " +
            "FROM playlists p LEFT JOIN playlist_items pi ON pi.playlist_id = p.id LEFT JOIN videos v ON v.id = pi.video_id AND v.missing = 0 " +
            "GROUP BY p.id ORDER BY p.name COLLATE NOCASE, p.id");
        using var r = cmd.ExecuteReader();
        var list = new List<VideoPlaylist>();
        while (r.Read()) list.Add(new VideoPlaylist(r.GetInt64(0), r.GetString(1), r.GetInt32(2), r.GetDouble(3), r.GetInt32(4)));
        return list;
    }

    public long CreatePlaylist(string name, IEnumerable<long>? ids = null)
    {
        name = CleanName(name);
        long id;
        using (var c = Open())
        using (var ins = Cmd(c, "INSERT INTO playlists(name, created) VALUES ($n, $c) RETURNING id", null, ("$n", name), ("$c", Iso(DateTime.UtcNow))))
            id = (long)ins.ExecuteScalar()!;
        if (ids != null) SetPlaylistItems(id, ids);
        return id;
    }

    public void RenamePlaylist(long id, string name)
    {
        name = CleanName(name);
        using var c = Open();
        using var u = Cmd(c, "UPDATE playlists SET name = $n WHERE id = $id", null, ("$n", name), ("$id", id));
        if (u.ExecuteNonQuery() == 0) throw new ArgumentException("That playlist no longer exists.");
    }

    public void DeletePlaylist(long id)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        using (var a = Cmd(c, "DELETE FROM playlist_items WHERE playlist_id = $id", tx, ("$id", id))) a.ExecuteNonQuery();
        using (var b = Cmd(c, "DELETE FROM playlists WHERE id = $id", tx, ("$id", id))) b.ExecuteNonQuery();
        tx.Commit();
    }

    public IReadOnlyList<long> PlaylistItems(long id)
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT video_id FROM playlist_items WHERE playlist_id = $id ORDER BY position", null, ("$id", id));
        using var r = cmd.ExecuteReader();
        var list = new List<long>();
        while (r.Read()) list.Add(r.GetInt64(0));
        return list;
    }

    /// <summary>Replaces the playlist's videos, in the order given.</summary>
    public void SetPlaylistItems(long id, IEnumerable<long> ids)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        using (var exists = Cmd(c, "SELECT COUNT(*) FROM playlists WHERE id = $id", tx, ("$id", id)))
            if (Convert.ToInt32(exists.ExecuteScalar(), CultureInfo.InvariantCulture) == 0) throw new ArgumentException("That playlist no longer exists.");
        using (var d = Cmd(c, "DELETE FROM playlist_items WHERE playlist_id = $id", tx, ("$id", id))) d.ExecuteNonQuery();
        var pos = 0;
        foreach (var v in ids.Take(20_000))
        {
            using var ins = Cmd(c, "INSERT INTO playlist_items(playlist_id, position, video_id) VALUES ($p, $i, $v)", tx, ("$p", id), ("$i", pos++), ("$v", v));
            ins.ExecuteNonQuery();
        }
        tx.Commit();
    }

    public void AddToPlaylist(long id, IEnumerable<long> ids) => SetPlaylistItems(id, PlaylistItems(id).Concat(ids));

    private static string CleanName(string? name)
    {
        name = (name ?? "").Trim();
        if (name.Length is 0 or > 200) throw new ArgumentException("Give the playlist a name (at most 200 characters).");
        return name;
    }

    // ------------------------------------------------------------------ notes

    public IReadOnlyList<VideoNote> Notes(long videoId)
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT id, video_id, t, text, created FROM notes WHERE video_id = $v ORDER BY t, id", null, ("$v", videoId));
        using var r = cmd.ExecuteReader();
        var list = new List<VideoNote>();
        while (r.Read()) list.Add(new VideoNote(r.GetInt64(0), r.GetInt64(1), r.GetDouble(2), r.GetString(3), ParseIso(r.GetString(4))!.Value));
        return list;
    }

    public long AddNote(long videoId, double time, string text)
    {
        text = (text ?? "").Trim();
        if (text.Length is 0 or > 20_000) throw new ArgumentException("A note needs some text (at most 20,000 characters).");
        if (!double.IsFinite(time) || time < 0) throw new ArgumentException("Invalid time.");
        if (Get(videoId) == null) throw new ArgumentException("That video is no longer in the library.");
        using var c = Open();
        using var ins = Cmd(c, "INSERT INTO notes(video_id, t, text, created) VALUES ($v, $t, $x, $c) RETURNING id", null, ("$v", videoId), ("$t", time), ("$x", text), ("$c", Iso(DateTime.UtcNow)));
        return (long)ins.ExecuteScalar()!;
    }

    public void UpdateNote(long id, string text, double? time = null)
    {
        text = (text ?? "").Trim();
        if (text.Length is 0 or > 20_000) throw new ArgumentException("A note needs some text (at most 20,000 characters).");
        using var c = Open();
        using var u = Cmd(c, "UPDATE notes SET text = $x, t = COALESCE($t, t) WHERE id = $id", null, ("$x", text), ("$t", time is double t && double.IsFinite(t) && t >= 0 ? t : null), ("$id", id));
        u.ExecuteNonQuery();
    }

    public void DeleteNote(long id)
    {
        using var c = Open();
        using var d = Cmd(c, "DELETE FROM notes WHERE id = $id", null, ("$id", id));
        d.ExecuteNonQuery();
    }

    /// <summary>Notes as Markdown: "- [12:34](…) text". Timestamps are plain text so the document stays portable.</summary>
    public string NotesMarkdown(long videoId)
    {
        var v = Get(videoId) ?? throw new ArgumentException("Unknown video.");
        var sb = new StringBuilder();
        sb.Append("### ").Append(v.Title).Append("\n\n");
        foreach (var n in Notes(videoId))
            sb.Append("- **").Append(Stamp(n.Time)).Append("** ").Append(n.Text.Replace("\n", "\n  ")).Append('\n');
        return sb.ToString();
    }

    public static string Stamp(double seconds)
    {
        var t = TimeSpan.FromSeconds(Math.Max(0, Math.Floor(seconds)));
        return t.TotalHours >= 1 ? $"{(int)t.TotalHours}:{t.Minutes:00}:{t.Seconds:00}" : $"{t.Minutes}:{t.Seconds:00}";
    }

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
