using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace NoorMD.Media;

/// <summary>Audio formats the player (Chromium in WebView2) can play and TagLib# can tag.</summary>
public static class AudioFormats
{
    private static readonly Dictionary<string, string> Types = new(StringComparer.OrdinalIgnoreCase)
    {
        [".mp3"] = "audio/mpeg", [".flac"] = "audio/flac", [".wav"] = "audio/wav", [".ogg"] = "audio/ogg",
        [".oga"] = "audio/ogg", [".opus"] = "audio/ogg", [".m4a"] = "audio/mp4", [".aac"] = "audio/aac",
    };

    public static bool IsAudio(string path) => Types.ContainsKey(Path.GetExtension(path));
    public static string ContentType(string path) => Types.TryGetValue(Path.GetExtension(path), out var t) ? t : "application/octet-stream";
    public static IEnumerable<string> Extensions => Types.Keys;
}

/// <summary>Tags as stored in the file. Null means "not present" — never a guessed value.</summary>
public sealed record TrackTags
{
    public string? Title { get; init; }
    public string? Artist { get; init; }
    public string? Album { get; init; }
    public string? AlbumArtist { get; init; }
    public string? Genre { get; init; }
    public uint? Year { get; init; }
    public uint? TrackNumber { get; init; }
    public string? Comment { get; init; }
    public double DurationSeconds { get; init; }
    public bool HasArtwork { get; init; }
    /// <summary>ReplayGain track gain (dB) and peak (linear) from the file's tags, when present. Never written by NoorMD.</summary>
    public double? ReplayGainDb { get; init; }
    public double? ReplayGainPeak { get; init; }
    /// <summary>Set when the tags could not be read (malformed or unsupported file).</summary>
    public string? ReadError { get; init; }
}

/// <summary>
/// A requested tag change. For every field: null = leave unchanged, "" (or 0 for numbers) = clear the field,
/// any other value = set it. This makes "leave unchanged" vs "clear" explicit, as batch editing needs.
/// </summary>
public sealed record TagEdit
{
    public string? Title { get; init; }
    public string? Artist { get; init; }
    public string? Album { get; init; }
    public string? AlbumArtist { get; init; }
    public string? Genre { get; init; }
    public uint? Year { get; init; }
    public uint? TrackNumber { get; init; }
    public string? Comment { get; init; }

    public bool IsEmpty => Title == null && Artist == null && Album == null && AlbumArtist == null && Genre == null
        && Year == null && TrackNumber == null && Comment == null;

    /// <summary>
    /// An edit for undo: puts back the fields the change altered (old ≠ new) and leaves every other field alone, so a
    /// tag with several values ("Rock; Pop") that the change didn't touch keeps all of them.
    /// </summary>
    public static TagEdit RestoreTo(TrackTags old, TrackTags? changed = null)
    {
        bool D<T>(T a, T b) => changed == null || !EqualityComparer<T>.Default.Equals(a, b);
        return new()
        {
            Title = D(old.Title, changed?.Title) ? old.Title ?? "" : null,
            Artist = D(old.Artist, changed?.Artist) ? old.Artist ?? "" : null,
            Album = D(old.Album, changed?.Album) ? old.Album ?? "" : null,
            AlbumArtist = D(old.AlbumArtist, changed?.AlbumArtist) ? old.AlbumArtist ?? "" : null,
            Genre = D(old.Genre, changed?.Genre) ? old.Genre ?? "" : null,
            Year = D(old.Year, changed?.Year) ? old.Year ?? 0 : null,
            TrackNumber = D(old.TrackNumber, changed?.TrackNumber) ? old.TrackNumber ?? 0 : null,
            Comment = D(old.Comment, changed?.Comment) ? old.Comment ?? "" : null,
        };
    }

    /// <summary>Whether the file's tags are still what NoorMD wrote (another program may have changed them since).</summary>
    public static bool SameTags(TrackTags? a, TrackTags? b) =>
        a != null && b != null && a.Title == b.Title && a.Artist == b.Artist && a.Album == b.Album && a.AlbumArtist == b.AlbumArtist
        && a.Genre == b.Genre && a.Year == b.Year && a.TrackNumber == b.TrackNumber && a.Comment == b.Comment;
}

public sealed class MetadataException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Reads and writes tags with TagLib#. Writes are verified by reading the file back.</summary>
public static class TagIO
{
    static TagIO()
    {
        // ID3v2.3 is what Windows Explorer, most players and car stereos read most reliably.
        TagLib.Id3v2.Tag.DefaultVersion = 3;
        TagLib.Id3v2.Tag.ForceDefaultVersion = true;
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    private static double? Finite(double v, double min, double max) => double.IsFinite(v) && v >= min && v <= max ? v : null;

    public static TrackTags Read(string path)
    {
        try
        {
            using var f = TagLib.File.Create(path, TagLib.ReadStyle.Average);
            var t = f.Tag;
            return new TrackTags
            {
                Title = Clean(t.Title), Artist = Clean(t.FirstPerformer), Album = Clean(t.Album), AlbumArtist = Clean(t.FirstAlbumArtist),
                Genre = Clean(t.FirstGenre), Year = t.Year == 0 ? null : t.Year, TrackNumber = t.Track == 0 ? null : t.Track,
                Comment = Clean(t.Comment), DurationSeconds = f.Properties?.Duration.TotalSeconds ?? 0, HasArtwork = t.Pictures.Length > 0,
                ReplayGainDb = Finite(t.ReplayGainTrackGain, -60, 60), ReplayGainPeak = Finite(t.ReplayGainTrackPeak, 0.000001, 10),
            };
        }
        catch (Exception ex) when (ex is TagLib.CorruptFileException or TagLib.UnsupportedFormatException or IOException or UnauthorizedAccessException or ArgumentException or IndexOutOfRangeException or OverflowException or NullReferenceException)
        {
            return new TrackTags { ReadError = ex is TagLib.UnsupportedFormatException ? "Unsupported or unrecognised audio format." : "The file's tags could not be read: " + ex.Message };
        }
    }

    public static (byte[] Data, string MimeType)? ReadArtwork(string path)
    {
        try
        {
            using var f = TagLib.File.Create(path, TagLib.ReadStyle.None);
            var pic = f.Tag.Pictures.FirstOrDefault(p => p.Type == TagLib.PictureType.FrontCover) ?? f.Tag.Pictures.FirstOrDefault();
            if (pic == null || pic.Data.Count == 0) return null;
            var mime = string.IsNullOrEmpty(pic.MimeType) ? "image/jpeg" : pic.MimeType;
            return mime.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ? (pic.Data.Data, mime) : null;
        }
        catch { return null; }
    }

    /// <summary>Applies an edit in place. Throws MetadataException with a user-readable message on failure.</summary>
    public static TrackTags Write(string path, TagEdit edit)
    {
        if (edit.IsEmpty) return Read(path);
        var info = new FileInfo(path);
        if (!info.Exists) throw new MetadataException($"\"{info.Name}\" no longer exists.");
        if (info.IsReadOnly) throw new MetadataException($"\"{info.Name}\" is read-only, so its tags can't be changed.");
        try
        {
            using (var f = TagLib.File.Create(path))
            {
                var t = f.Tag;
                if (edit.Title != null) t.Title = Clean(edit.Title);
                if (edit.Artist != null) t.Performers = Clean(edit.Artist) is { } a ? [a] : [];
                if (edit.Album != null) t.Album = Clean(edit.Album);
                if (edit.AlbumArtist != null) t.AlbumArtists = Clean(edit.AlbumArtist) is { } aa ? [aa] : [];
                if (edit.Genre != null) t.Genres = Clean(edit.Genre) is { } g ? [g] : [];
                if (edit.Year != null) t.Year = edit.Year.Value;
                if (edit.TrackNumber != null) t.Track = edit.TrackNumber.Value;
                if (edit.Comment != null) t.Comment = Clean(edit.Comment);
                f.Save();
            }
        }
        catch (Exception ex) when (ex is TagLib.CorruptFileException or TagLib.UnsupportedFormatException)
        {
            throw new MetadataException($"\"{info.Name}\" can't be tagged: {ex.Message}", ex);
        }
        catch (IOException ex)
        {
            throw new MetadataException($"\"{info.Name}\" is in use by another program, so its tags weren't changed. Try again in a moment.", ex);
        }
        catch (UnauthorizedAccessException ex)
        {
            throw new MetadataException($"Windows denied write access to \"{info.Name}\".", ex);
        }
        catch (Exception ex) when (ex is ArgumentException or IndexOutOfRangeException or OverflowException or NullReferenceException or InvalidOperationException)
        {
            // TagLib's way of failing on some damaged files (the same set Read treats as "can't read").
            throw new MetadataException($"\"{info.Name}\" can't be tagged: the file looks damaged ({ex.Message}).", ex);
        }

        var after = Read(path);
        if (after.ReadError != null) throw new MetadataException("The tags were written but could not be read back: " + after.ReadError);
        if (edit.Title != null && after.Title != Clean(edit.Title)) throw new MetadataException("The title could not be verified after saving.");
        return after;
    }
}

/// <summary>
/// Identifies audio content independently of its path: file size plus SHA-256 of 64 KB from the middle of the
/// file. Used to relink files that were moved outside NoorMD. Recalculated after every NoorMD edit.
/// </summary>
public static class Fingerprint
{
    public static string Compute(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var len = fs.Length;
        var window = (int)Math.Min(64 * 1024, len);
        fs.Position = Math.Max(0, len / 2 - window / 2);
        var buf = new byte[window];
        fs.ReadExactly(buf);
        return len.ToString(CultureInfo.InvariantCulture) + ":" + Convert.ToHexString(SHA256.HashData(buf), 0, 16).ToLowerInvariant();
    }
}

/// <summary>Case- and accent-insensitive search keys: "Żółw" and "zolw" both match "ŻÓŁW".</summary>
public static class TextFold
{
    public static string Fold(string? s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        var lower = s.ToLowerInvariant().Replace('ł', 'l').Replace('ø', 'o').Replace('đ', 'd').Replace("ß", "ss");
        var sb = new StringBuilder(lower.Length);
        foreach (var c in lower.Normalize(NormalizationForm.FormD))
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) sb.Append(c);
        return sb.ToString().Normalize(NormalizationForm.FormC);
    }
}

/// <summary>Parses a single HTTP Range header ("bytes=a-b", "bytes=a-", "bytes=-n") for media seeking.</summary>
public static class RangeRequest
{
    /// <returns>null = serve the whole file (200); (start, end) inclusive = 206; (-1, -1) = unsatisfiable (416).</returns>
    public static (long Start, long End)? Parse(string? header, long length)
    {
        if (string.IsNullOrWhiteSpace(header)) return null;
        header = header.Trim();
        if (!header.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase) || header.Contains(',')) return null;
        var spec = header[6..].Trim();
        var dash = spec.IndexOf('-');
        if (dash < 0 || length <= 0) return (-1, -1);
        var a = spec[..dash].Trim();
        var b = spec[(dash + 1)..].Trim();
        long start, end;
        if (a.Length == 0)
        {
            if (!long.TryParse(b, NumberStyles.None, CultureInfo.InvariantCulture, out var suffix) || suffix <= 0) return (-1, -1);
            start = Math.Max(0, length - suffix);
            end = length - 1;
        }
        else
        {
            if (!long.TryParse(a, NumberStyles.None, CultureInfo.InvariantCulture, out start)) return (-1, -1);
            end = b.Length == 0 ? length - 1 : long.TryParse(b, NumberStyles.None, CultureInfo.InvariantCulture, out var e) ? Math.Min(e, length - 1) : -1;
            if (end < 0 || start > end || start >= length) return (-1, -1);
        }
        return (start, end);
    }
}

/// <summary>
/// Cover pictures kept next to the music ("cover.jpg", "folder.png"…), used when a file has no embedded artwork.
/// Looked up once per folder and cached until the folder changes.
/// </summary>
public static class FolderArt
{
    private static readonly string[] Names = ["cover", "folder", "front", "album", "albumart", "artwork"];
    private static readonly string[] Extensions = [".jpg", ".jpeg", ".png", ".webp"];
    private const long MaxBytes = 12 * 1024 * 1024;
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, (DateTime Stamp, string? Path)> Cache = new(StringComparer.OrdinalIgnoreCase);

    public static string? Find(string? folder)
    {
        if (string.IsNullOrEmpty(folder)) return null;
        try
        {
            var stamp = Directory.GetLastWriteTimeUtc(folder);
            if (Cache.TryGetValue(folder, out var hit) && hit.Stamp == stamp) return hit.Path;
            string? best = null;
            var rank = int.MaxValue;
            foreach (var f in Directory.EnumerateFiles(folder))
            {
                var ext = Path.GetExtension(f).ToLowerInvariant();
                if (!Extensions.Contains(ext)) continue;
                var name = Path.GetFileNameWithoutExtension(f).ToLowerInvariant();
                var i = Array.FindIndex(Names, n => name == n || (n == "albumart" && name.StartsWith("albumart", StringComparison.Ordinal)));
                if (i >= 0 && i < rank && new FileInfo(f).Length is > 0 and <= MaxBytes) { best = f; rank = i; }
            }
            Cache[folder] = (stamp, best);
            return best;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return null; }
    }

    public static (byte[] Data, string MimeType)? Read(string? folder)
    {
        if (Find(folder) is not { } path) return null;
        try
        {
            var mime = Path.GetExtension(path).ToLowerInvariant() switch { ".png" => "image/png", ".webp" => "image/webp", _ => "image/jpeg" };
            return (File.ReadAllBytes(path), mime);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return null; }
    }
}
