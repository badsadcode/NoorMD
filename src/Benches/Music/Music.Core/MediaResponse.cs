using System.Globalization;

namespace Music.Core;

/// <summary>
/// Builds the HTTP response for an audio request. Ranged requests (how browsers seek) are answered with at most
/// <see cref="MaxChunk"/> bytes read into memory, and the file is closed immediately: NoorMD never keeps an
/// audio file open between requests, so renaming or re-tagging the playing track can't collide with a handle.
/// </summary>
public sealed record MediaResponse(int Status, string Reason, byte[] Body, string Headers)
{
    public const int MaxChunk = 2 * 1024 * 1024;

    /// <summary>The same for audio held in memory (a rendered preview): seeking needs ranges here too.</summary>
    public static MediaResponse FromBytes(byte[] data, string? rangeHeader, string contentType)
    {
        var inv = CultureInfo.InvariantCulture;
        var length = data.LongLength;
        var common = $"Content-Type: {contentType}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff";
        var range = RangeRequest.Parse(rangeHeader, length);
        if (range == null) return new MediaResponse(200, "OK", data, $"{common}\r\nContent-Length: {length.ToString(inv)}");
        var (start, end) = range.Value;
        if (start < 0) return new MediaResponse(416, "Range Not Satisfiable", [], $"{common}\r\nContent-Range: bytes */{length.ToString(inv)}");
        end = Math.Min(end, start + MaxChunk - 1);
        var count = (int)(end - start + 1);
        var buf = new byte[count];
        Array.Copy(data, start, buf, 0, count);
        return new MediaResponse(206, "Partial Content", buf, $"{common}\r\nContent-Length: {count.ToString(inv)}\r\nContent-Range: bytes {start.ToString(inv)}-{end.ToString(inv)}/{length.ToString(inv)}");
    }

    public static MediaResponse Build(string path, string? rangeHeader, string contentType)
    {
        FileStream fs;
        try { fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return new MediaResponse(404, "Not Found", [], "Content-Type: text/plain"); }
        using var _ = fs;
        // The length of the file as it is now (it may have been re-tagged since it was listed).
        var length = fs.Length;
        var stamp = File.GetLastWriteTimeUtc(path).ToString("R", CultureInfo.InvariantCulture);
        var common = $"Content-Type: {contentType}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nLast-Modified: {stamp}";
        var range = RangeRequest.Parse(rangeHeader, length);
        // Without a range, a very big file is answered in chunks anyway (the player asks for the rest).
        if (range == null && length > MaxChunk * 64L) range = (0, length - 1);
        if (range == null)
        {
            var all = new byte[length];
            fs.ReadExactly(all);
            return new MediaResponse(200, "OK", all, $"{common}\r\nContent-Length: {length.ToString(CultureInfo.InvariantCulture)}");
        }
        var (start, end) = range.Value;
        if (start < 0) return new MediaResponse(416, "Range Not Satisfiable", [], $"{common}\r\nContent-Range: bytes */{length.ToString(CultureInfo.InvariantCulture)}");
        end = Math.Min(end, start + MaxChunk - 1);
        var count = (int)(end - start + 1);
        var buf = new byte[count];
        fs.Position = start;
        try { fs.ReadExactly(buf); }
        catch (EndOfStreamException) { return new MediaResponse(416, "Range Not Satisfiable", [], $"{common}\r\nContent-Range: bytes */{fs.Length.ToString(CultureInfo.InvariantCulture)}"); }
        var inv = CultureInfo.InvariantCulture;
        return new MediaResponse(206, "Partial Content", buf, $"{common}\r\nContent-Length: {count.ToString(inv)}\r\nContent-Range: bytes {start.ToString(inv)}-{end.ToString(inv)}/{length.ToString(inv)}");
    }
}
