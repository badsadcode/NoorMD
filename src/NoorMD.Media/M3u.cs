using System.Globalization;
using System.Text;

namespace NoorMD.Media;

/// <summary>Reads and writes .m3u/.m3u8 playlists (UTF-8, relative paths where possible).</summary>
public static class M3u
{
    public sealed record Entry(string Path, double Duration, string? Title);

    public static IReadOnlyList<string> Read(string playlistPath)
    {
        var dir = System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(playlistPath))!;
        var bytes = File.ReadAllBytes(playlistPath);
        // .m3u8 is UTF-8 by definition; legacy .m3u files are often Windows-1252.
        string text;
        try { text = new UTF8Encoding(false, true).GetString(bytes); }
        catch (DecoderFallbackException) { Encoding.RegisterProvider(CodePagesEncodingProvider.Instance); text = Encoding.GetEncoding(1252).GetString(bytes); }
        var result = new List<string>();
        foreach (var raw in text.Replace("\r\n", "\n").Split('\n'))
        {
            var line = raw.Trim().TrimStart('﻿');
            if (line.Length == 0 || line.StartsWith('#')) continue;
            string path;
            if (Uri.TryCreate(line, UriKind.Absolute, out var uri) && uri.IsFile) path = uri.LocalPath;
            else if (line.Contains("://")) continue; // streams/URLs are not local files
            else path = System.IO.Path.IsPathRooted(line) ? line : System.IO.Path.Combine(dir, line.Replace('/', System.IO.Path.DirectorySeparatorChar).Replace('\\', System.IO.Path.DirectorySeparatorChar));
            try { result.Add(System.IO.Path.GetFullPath(path)); } catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { }
        }
        return result;
    }

    public static string Write(string playlistPath, IEnumerable<Entry> entries)
    {
        var dir = System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(playlistPath))!;
        var sb = new StringBuilder("#EXTM3U\n");
        foreach (var e in entries)
        {
            var rel = System.IO.Path.GetRelativePath(dir, e.Path);
            var path = rel.StartsWith("..", StringComparison.Ordinal) && System.IO.Path.GetPathRoot(e.Path) != System.IO.Path.GetPathRoot(dir) ? e.Path : rel;
            var title = (e.Title ?? System.IO.Path.GetFileNameWithoutExtension(e.Path)).Replace('\n', ' ').Replace('\r', ' ');
            sb.Append("#EXTINF:").Append(((int)Math.Round(e.Duration)).ToString(CultureInfo.InvariantCulture)).Append(',').Append(title).Append('\n');
            sb.Append(path).Append('\n');
        }
        var text = sb.ToString();
        NoorMD.Core.Documents.AtomicFile.WriteAllBytes(playlistPath, new UTF8Encoding(false).GetBytes(text));
        return text;
    }
}
