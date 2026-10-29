using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace NoorMD.Media;

// HLS radio (a stream cut into pieces: a playlist of short segments that keeps growing). NoorMD reads the playlist,
// fetches the segments in order and unpacks their sound — AAC or MP3 inside MPEG-TS, plain AAC (ADTS) or MP3, or AAC
// in fragmented MP4 — into one continuous stream the page plays like any other station. Only playlists and segments
// of the station are fetched, one at a time; AES-128 encrypted segments are decrypted with the key the playlist names.

/// <summary>An HLS playlist: a master (its variants) or a media playlist (its segments).</summary>
public sealed class HlsPlaylist
{
    public sealed record Variant(Uri Uri, long Bandwidth, string? Codecs, Uri? AudioUri)
    {
        /// <summary>No video codec in it (or none said): sound only.</summary>
        public bool AudioOnly => Codecs == null || !Codecs.Split(',').Any(c => c.Trim().StartsWith("avc", StringComparison.OrdinalIgnoreCase) || c.Trim().StartsWith("hvc", StringComparison.OrdinalIgnoreCase) || c.Trim().StartsWith("hev", StringComparison.OrdinalIgnoreCase));
    }

    public sealed record Key(string Method, Uri? Uri, byte[]? Iv);

    public sealed record Segment(Uri Uri, double Duration, string? Title, long Sequence, Key? Key, Uri? Map);

    public List<Variant> Variants { get; } = [];
    public List<Segment> Segments { get; } = [];
    public double TargetDuration { get; private set; } = 6;
    public bool Ended { get; private set; }
    public bool IsMaster => Variants.Count > 0;

    public static HlsPlaylist Parse(string text, Uri baseUri)
    {
        var p = new HlsPlaylist();
        long seq = 0;
        double duration = 0;
        string? title = null;
        Key? key = null;
        Uri? map = null;
        (long Bandwidth, string? Codecs, string? Audio)? streamInf = null;
        var lines = text.Replace("\r", "").Split('\n');
        // Audio renditions first (they may be listed after the variants that use them).
        var audioGroups = new Dictionary<string, Uri>(StringComparer.Ordinal);
        foreach (var l in lines.Where(l => l.StartsWith("#EXT-X-MEDIA:", StringComparison.Ordinal)))
        {
            var a = Attributes(l[13..]);
            if (a.GetValueOrDefault("TYPE") == "AUDIO" && a.TryGetValue("GROUP-ID", out var g) && a.TryGetValue("URI", out var au) && Resolve(baseUri, au) is { } auUri)
                if (!audioGroups.ContainsKey(g) || a.GetValueOrDefault("DEFAULT") == "YES") audioGroups[g] = auUri;
        }
        foreach (var raw in lines)
        {
            var line = raw.Trim();
            if (line.Length == 0) continue;
            if (line.StartsWith('#'))
            {
                var (tag, value) = SplitTag(line);
                switch (tag)
                {
                    case "#EXT-X-TARGETDURATION": if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var td) && td > 0) p.TargetDuration = Math.Min(td, 60); break;
                    case "#EXT-X-MEDIA-SEQUENCE": long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out seq); break;
                    case "#EXT-X-ENDLIST": p.Ended = true; break;
                    case "#EXTINF":
                    {
                        var comma = value.IndexOf(',');
                        double.TryParse(comma >= 0 ? value[..comma] : value, NumberStyles.Float, CultureInfo.InvariantCulture, out duration);
                        title = comma >= 0 ? value[(comma + 1)..].Trim() : null;
                        if (title is { Length: 0 }) title = null;
                        break;
                    }
                    case "#EXT-X-KEY":
                    {
                        var a = Attributes(value);
                        var method = a.GetValueOrDefault("METHOD", "NONE");
                        key = method == "NONE" ? null : new Key(method, a.TryGetValue("URI", out var ku) ? Resolve(baseUri, ku) : null, a.TryGetValue("IV", out var iv) ? Hex(iv) : null);
                        break;
                    }
                    case "#EXT-X-MAP":
                        map = Attributes(value).TryGetValue("URI", out var mu) ? Resolve(baseUri, mu) : null;
                        break;
                    case "#EXT-X-STREAM-INF":
                    {
                        var a = Attributes(value);
                        long.TryParse(a.GetValueOrDefault("BANDWIDTH", "0"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var bw);
                        streamInf = (bw, a.GetValueOrDefault("CODECS"), a.GetValueOrDefault("AUDIO"));
                        break;
                    }
                }
                continue;
            }
            var uri = Resolve(baseUri, line);
            if (uri == null) { streamInf = null; continue; }
            if (streamInf is { } si)
            {
                p.Variants.Add(new Variant(uri, si.Bandwidth, si.Codecs, si.Audio != null && audioGroups.TryGetValue(si.Audio, out var a) ? a : null));
                streamInf = null;
            }
            else
            {
                p.Segments.Add(new Segment(uri, duration, title, seq++, key, map));
                title = null;
            }
        }
        return p;
    }

    /// <summary>The variant to play: sound only if there is one, the best up to 320 kbps, else the smallest.</summary>
    public Variant? Choose()
    {
        if (Variants.Count == 0) return null;
        var pool = Variants.Where(v => v.AudioOnly).ToList();
        if (pool.Count == 0) pool = Variants.Where(v => v.AudioUri != null).ToList();
        if (pool.Count == 0) pool = Variants;
        return pool.Where(v => v.Bandwidth <= 320_000).OrderByDescending(v => v.Bandwidth).FirstOrDefault() ?? pool.OrderBy(v => v.Bandwidth).First();
    }

    private static (string Tag, string Value) SplitTag(string line)
    {
        var colon = line.IndexOf(':');
        return colon < 0 ? (line, "") : (line[..colon], line[(colon + 1)..]);
    }

    /// <summary>KEY=VALUE,KEY="quoted, value" attribute lists.</summary>
    public static Dictionary<string, string> Attributes(string s)
    {
        var d = new Dictionary<string, string>(StringComparer.Ordinal);
        var i = 0;
        while (i < s.Length)
        {
            var eq = s.IndexOf('=', i);
            if (eq < 0) break;
            var name = s[i..eq].Trim().TrimStart(',').Trim();
            string value;
            if (eq + 1 < s.Length && s[eq + 1] == '"')
            {
                var end = s.IndexOf('"', eq + 2);
                if (end < 0) end = s.Length;
                value = s[(eq + 2)..end];
                i = end + 1;
            }
            else
            {
                var end = s.IndexOf(',', eq + 1);
                if (end < 0) end = s.Length;
                value = s[(eq + 1)..end].Trim();
                i = end;
            }
            if (name.Length > 0) d[name] = value;
            while (i < s.Length && s[i] == ',') i++;
        }
        return d;
    }

    private static Uri? Resolve(Uri baseUri, string s)
    {
        if (!Uri.TryCreate(baseUri, s.Trim(), out var u)) return null;
        return u.Scheme is "http" or "https" ? u : null;
    }

    private static byte[]? Hex(string s)
    {
        s = s.Trim();
        if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) s = s[2..];
        if (s.Length == 0 || s.Length > 32) return null;
        s = s.PadLeft(32, '0');
        try { return Convert.FromHexString(s); } catch (FormatException) { return null; }
    }

    /// <summary>The IV of a segment without one of its own: its sequence number, big-endian.</summary>
    public static byte[] SequenceIv(long seq)
    {
        var iv = new byte[16];
        for (var k = 0; k < 8; k++) iv[15 - k] = (byte)(seq >> (8 * k));
        return iv;
    }
}

/// <summary>
/// Unpacks the sound of HLS segments into a continuous AAC (ADTS) or MP3 stream, and reads song titles from their ID3
/// tags. One per stream: it remembers the init segment of fragmented MP4 and the stream ids of MPEG-TS.
/// </summary>
public sealed class HlsDemuxer
{
    /// <summary>"audio/aac" or "audio/mpeg" once known.</summary>
    public string? ContentType { get; private set; }

    // fragmented MP4: the AAC settings from the init segment.
    private int _aot = 2, _freqIndex = 4, _channels = 2;
    private bool _haveConfig;
    // MPEG-TS
    private int _pmtPid = -1, _audioPid = -1, _id3Pid = -1;
    private readonly MemoryStream _id3Pes = new();

    public void Init(ReadOnlySpan<byte> init)
    {
        var esds = Find(init, "esds"u8);
        if (esds >= 0) ReadEsds(init[(esds + 4)..]);
    }

    /// <summary>The sound of one segment (decrypted), and a title if the segment carries one.</summary>
    public (byte[] Sound, string? Title) Feed(byte[] seg)
    {
        if (seg.Length >= 188 && seg[0] == 0x47 && (seg.Length < 376 || seg[188] == 0x47)) return Ts(seg);
        if (seg.Length >= 8 && (Box(seg, 4, "ftyp"u8) || Box(seg, 4, "styp"u8) || Box(seg, 4, "moof"u8) || Box(seg, 4, "sidx"u8) || Box(seg, 4, "moov"u8))) return (Mp4(seg), null);
        // Plain AAC or MP3, an ID3 tag before it (often only a timestamp).
        var at = 0;
        string? title = null;
        while (at + 10 <= seg.Length && seg[at] == 'I' && seg[at + 1] == 'D' && seg[at + 2] == '3')
        {
            var size = Synchsafe(seg, at + 6) + 10 + ((seg[at + 5] & 0x10) != 0 ? 10 : 0);
            title ??= Id3Title(seg.AsSpan(at, Math.Min(size, seg.Length - at)));
            at += size;
        }
        if (at >= seg.Length) return ([], title);
        if (ContentType == null && at + 1 < seg.Length && seg[at] == 0xFF && (seg[at + 1] & 0xF0) == 0xF0)
            ContentType = (seg[at + 1] & 0x06) == 0 ? "audio/aac" : "audio/mpeg";
        else if (ContentType == null && at + 1 < seg.Length && seg[at] == 0xFF && (seg[at + 1] & 0xE0) == 0xE0) ContentType = "audio/mpeg";
        return (seg[at..], title);
    }

    // ------------------------------------------------------------------ MPEG-TS

    private (byte[] Sound, string? Title) Ts(byte[] seg)
    {
        using var output = new MemoryStream(seg.Length);
        string? title = null;
        for (var p = 0; p + 188 <= seg.Length; p += 188)
        {
            if (seg[p] != 0x47) { p = Resync(seg, p) - 188; continue; }
            var pusi = (seg[p + 1] & 0x40) != 0;
            var pid = ((seg[p + 1] & 0x1F) << 8) | seg[p + 2];
            var afc = (seg[p + 3] >> 4) & 3;
            var at = p + 4;
            if (afc == 2 || afc == 0) continue;
            if (afc == 3) at += 1 + seg[p + 4];
            if (at >= p + 188) continue;
            var payload = seg.AsSpan(at, p + 188 - at);
            if (pid == 0 && pusi) Pat(payload);
            else if (pid == _pmtPid && pusi) Pmt(payload);
            else if (pid == _audioPid) output.Write(pusi ? PesData(payload) : payload);
            else if (pid == _id3Pid)
            {
                if (pusi) { title ??= Id3FromPes(); _id3Pes.SetLength(0); _id3Pes.Write(PesData(payload)); }
                else _id3Pes.Write(payload);
            }
        }
        title ??= Id3FromPes();
        return (output.ToArray(), title);
    }

    private static int Resync(byte[] seg, int from)
    {
        for (var i = from + 1; i + 188 < seg.Length; i++) if (seg[i] == 0x47 && seg[i + 188] == 0x47) return i;
        return seg.Length;
    }

    private string? Id3FromPes()
    {
        if (_id3Pes.Length < 10) return null;
        var t = Id3Title(_id3Pes.GetBuffer().AsSpan(0, (int)_id3Pes.Length));
        _id3Pes.SetLength(0);
        return t;
    }

    private void Pat(ReadOnlySpan<byte> s)
    {
        var at = 1 + s[0];
        if (at + 8 > s.Length || s[at] != 0) return;
        var len = ((s[at + 1] & 0x0F) << 8) | s[at + 2];
        var end = Math.Min(s.Length, at + 3 + len - 4);
        for (var i = at + 8; i + 4 <= end; i += 4)
        {
            var program = (s[i] << 8) | s[i + 1];
            if (program == 0) continue;
            _pmtPid = ((s[i + 2] & 0x1F) << 8) | s[i + 3];
            return;
        }
    }

    private void Pmt(ReadOnlySpan<byte> s)
    {
        var at = 1 + s[0];
        if (at + 12 > s.Length || s[at] != 2) return;
        var len = ((s[at + 1] & 0x0F) << 8) | s[at + 2];
        var end = Math.Min(s.Length, at + 3 + len - 4);
        var info = ((s[at + 10] & 0x0F) << 8) | s[at + 11];
        for (var i = at + 12 + info; i + 5 <= end;)
        {
            int type = s[i], pid = ((s[i + 1] & 0x1F) << 8) | s[i + 2], es = ((s[i + 3] & 0x0F) << 8) | s[i + 4];
            if (_audioPid < 0 && type is 0x0F or 0x03 or 0x04) { _audioPid = pid; ContentType ??= type == 0x0F ? "audio/aac" : "audio/mpeg"; }
            if (type == 0x15) _id3Pid = pid; // timed ID3 metadata
            i += 5 + es;
        }
    }

    private static ReadOnlySpan<byte> PesData(ReadOnlySpan<byte> s)
    {
        if (s.Length < 9 || s[0] != 0 || s[1] != 0 || s[2] != 1) return s;
        var at = 9 + s[8];
        return at <= s.Length ? s[at..] : [];
    }

    // ------------------------------------------------------------------ fragmented MP4 (AAC)

    private byte[] Mp4(byte[] seg)
    {
        var esds = Find(seg, "esds"u8);
        if (esds >= 0) ReadEsds(seg.AsSpan(esds + 4));
        using var output = new MemoryStream(seg.Length + seg.Length / 50);
        var moofStart = -1;
        var sizes = new List<int>();
        var dataOffset = -1;
        var defaultSize = 0;
        for (var at = 0; at + 8 <= seg.Length;)
        {
            var size = (int)Math.Min(int.MaxValue, Be32(seg, at));
            var header = 8;
            if (size == 1 && at + 16 <= seg.Length) { size = (int)Math.Min(int.MaxValue, (long)((ulong)Be32(seg, at + 8) << 32 | Be32(seg, at + 12))); header = 16; }
            if (size == 0) size = seg.Length - at;
            if (size < header || at + size > seg.Length) break;
            if (Box(seg, at + 4, "moof"u8))
            {
                moofStart = at; sizes.Clear(); dataOffset = -1; defaultSize = 0;
                Moof(seg, at + header, at + size, sizes, ref dataOffset, ref defaultSize);
            }
            else if (Box(seg, at + 4, "mdat"u8) && moofStart >= 0)
            {
                var pos = dataOffset >= 0 ? moofStart + dataOffset : at + header;
                foreach (var n in sizes)
                {
                    if (pos + n > seg.Length) break;
                    WriteAdts(output, seg.AsSpan(pos, n));
                    pos += n;
                }
                moofStart = -1;
            }
            at += size;
        }
        ContentType ??= "audio/aac";
        return output.ToArray();
    }

    private static void Moof(byte[] s, int from, int to, List<int> sizes, ref int dataOffset, ref int defaultSize)
    {
        for (var at = from; at + 8 <= to;)
        {
            var size = (int)Be32(s, at);
            if (size < 8 || at + size > to) return;
            if (Box(s, at + 4, "traf"u8)) Moof(s, at + 8, at + size, sizes, ref dataOffset, ref defaultSize);
            else if (Box(s, at + 4, "tfhd"u8))
            {
                var flags = (int)(Be32(s, at + 8) & 0xFFFFFF);
                var p = at + 16; // after the track id
                if ((flags & 0x01) != 0) p += 8;
                if ((flags & 0x02) != 0) p += 4;
                if ((flags & 0x08) != 0) p += 4;
                if ((flags & 0x10) != 0 && p + 4 <= at + size) defaultSize = (int)Be32(s, p);
            }
            else if (Box(s, at + 4, "trun"u8))
            {
                var flags = (int)(Be32(s, at + 8) & 0xFFFFFF);
                var count = (int)Be32(s, at + 12);
                var p = at + 16;
                if ((flags & 0x01) != 0) { dataOffset = (int)Be32(s, p); p += 4; }
                if ((flags & 0x04) != 0) p += 4;
                for (var k = 0; k < count && p <= at + size; k++)
                {
                    if ((flags & 0x100) != 0) p += 4;
                    var n = defaultSize;
                    if ((flags & 0x200) != 0) { n = (int)Be32(s, p); p += 4; }
                    if ((flags & 0x400) != 0) p += 4;
                    if ((flags & 0x800) != 0) p += 4;
                    if (n > 0 && n < 1 << 13) sizes.Add(n);
                }
            }
            at += size;
        }
    }

    /// <summary>The AudioSpecificConfig in an esds box (its content, after the box header): object type, rate, channels.</summary>
    private void ReadEsds(ReadOnlySpan<byte> s)
    {
        var i = 4; // version and flags
        while (i + 2 < s.Length)
        {
            var tag = s[i++];
            var len = 0;
            for (var k = 0; k < 4 && i < s.Length; k++) { var b = s[i++]; len = (len << 7) | (b & 0x7F); if ((b & 0x80) == 0) break; }
            if (tag == 0x03) { i += 3; continue; } // ES descriptor: id and flags, then the descriptors inside it
            if (tag == 0x04) { i += 13; continue; } // decoder config: then the decoder-specific info
            if (tag == 0x05 && i + 2 <= s.Length)
            {
                int bits = (s[i] << 8) | s[i + 1];
                var aot = bits >> 11;
                var freq = (bits >> 7) & 0x0F;
                var ch = (bits >> 3) & 0x0F;
                // HE-AAC: the core is plain AAC at the base rate; the decoder finds the rest by itself.
                if (aot is 5 or 29) aot = 2;
                if (aot is >= 1 and <= 4 && freq < 13 && ch is >= 1 and <= 7) { _aot = aot; _freqIndex = freq; _channels = ch; _haveConfig = true; }
                return;
            }
            i += len;
        }
    }

    private void WriteAdts(Stream o, ReadOnlySpan<byte> frame)
    {
        var len = frame.Length + 7;
        Span<byte> h = stackalloc byte[7];
        h[0] = 0xFF;
        h[1] = 0xF1;
        h[2] = (byte)(((_aot - 1) << 6) | (_freqIndex << 2) | (_channels >> 2));
        h[3] = (byte)(((_channels & 3) << 6) | (len >> 11));
        h[4] = (byte)((len >> 3) & 0xFF);
        h[5] = (byte)(((len & 7) << 5) | 0x1F);
        h[6] = 0xFC;
        o.Write(h);
        o.Write(frame);
    }

    public bool HasAacConfig => _haveConfig;

    // ------------------------------------------------------------------ ID3 titles

    /// <summary>"Artist - Title" (or the title, or a StreamTitle) from an ID3v2 tag, or null.</summary>
    public static string? Id3Title(ReadOnlySpan<byte> tag)
    {
        if (tag.Length < 10 || tag[0] != 'I' || tag[1] != 'D' || tag[2] != '3') return null;
        int version = tag[3], end = Math.Min(tag.Length, 10 + Synchsafe(tag, 6));
        string? title = null, artist = null, other = null;
        for (var at = 10; at + 10 <= end;)
        {
            var id = Encoding.ASCII.GetString(tag.Slice(at, 4));
            if (id[0] == '\0') break;
            var size = version >= 4 ? Synchsafe(tag, at + 4) : (int)Be32(tag, at + 4);
            if (size <= 0 || at + 10 + size > end) break;
            var body = tag.Slice(at + 10, size);
            if (id == "TIT2") title = Text(body);
            else if (id == "TPE1") artist = Text(body);
            else if (id == "TXXX")
            {
                var t = Text(body);
                if (t != null) other ??= t.Contains("StreamTitle=", StringComparison.Ordinal) ? IcyReader.ParseTitle(Encoding.UTF8.GetBytes(t)) : null;
            }
            at += 10 + size;
        }
        if (title != null) return artist != null ? $"{artist} - {title}" : title;
        return other;
    }

    private static string? Text(ReadOnlySpan<byte> body)
    {
        if (body.Length < 2) return null;
        var enc = body[0];
        var data = body[1..];
        var bigEndian = data.Length >= 2 && data[0] == 0xFE && data[1] == 0xFF;
        var littleEndian = data.Length >= 2 && data[0] == 0xFF && data[1] == 0xFE;
        var s = enc switch
        {
            1 => bigEndian ? Encoding.BigEndianUnicode.GetString(data[2..]) : Encoding.Unicode.GetString(littleEndian ? data[2..] : data),
            2 => Encoding.BigEndianUnicode.GetString(data),
            3 => Encoding.UTF8.GetString(data),
            _ => Encoding.Latin1.GetString(data),
        };
        s = s.Replace("\0", " ").Trim();
        return s.Length is > 0 and <= 300 ? s : null;
    }

    // ------------------------------------------------------------------ bytes

    private static int Synchsafe(ReadOnlySpan<byte> b, int at) => at + 4 > b.Length ? 0 : (b[at] & 0x7F) << 21 | (b[at + 1] & 0x7F) << 14 | (b[at + 2] & 0x7F) << 7 | (b[at + 3] & 0x7F);
    private static uint Be32(ReadOnlySpan<byte> b, int at) => at + 4 > b.Length ? 0 : (uint)(b[at] << 24 | b[at + 1] << 16 | b[at + 2] << 8 | b[at + 3]);
    private static bool Box(ReadOnlySpan<byte> b, int at, ReadOnlySpan<byte> name) => at + 4 <= b.Length && b.Slice(at, 4).SequenceEqual(name);
    private static int Find(ReadOnlySpan<byte> b, ReadOnlySpan<byte> name) { var i = b.IndexOf(name); return i < 0 ? -1 : i + 4; }
}

/// <summary>
/// Follows an HLS station: the playlist (a master's chosen variant), each new segment in order (decrypted, unpacked)
/// written to <c>write</c>, the playlist read again as a live station adds to it. Stops when cancelled, when a
/// finished playlist has played, or when the station stops answering.
/// </summary>
public sealed class HlsReader(HttpClient http)
{
    /// <summary>How many segments before the live end to start from (a few seconds of buffer, still nearly live).</summary>
    public const int StartBehind = 3;
    private const int MaxPlaylistBytes = 2 * 1024 * 1024, MaxSegmentBytes = 32 * 1024 * 1024;

    public async Task RunAsync(Uri url, string firstText, Func<string, ReadOnlyMemory<byte>, Task> write, Action<string>? title, CancellationToken ct)
    {
        var playlistUri = url;
        var playlist = HlsPlaylist.Parse(firstText, url);
        for (var depth = 0; playlist.IsMaster && depth < 3; depth++)
        {
            var v = playlist.Choose()!;
            playlistUri = v.AudioOnly || v.AudioUri == null ? v.Uri : v.AudioUri;
            playlist = HlsPlaylist.Parse(await GetText(playlistUri, ct), playlistUri);
        }
        var demux = new HlsDemuxer();
        long next = playlist.Segments.Count > 0 ? (playlist.Ended ? playlist.Segments[0].Sequence : playlist.Segments[Math.Max(0, playlist.Segments.Count - StartBehind)].Sequence) : 0;
        Uri? mapDone = null;
        var keys = new Dictionary<Uri, byte[]>();
        string? lastTitle = null;
        var failures = 0;
        while (!ct.IsCancellationRequested)
        {
            var fresh = playlist.Segments.Where(s => s.Sequence >= next).ToList();
            foreach (var seg in fresh)
            {
                if (seg.Map != null && seg.Map != mapDone) { demux.Init(await GetBytes(seg.Map, ct)); mapDone = seg.Map; }
                byte[] data;
                try { data = await GetBytes(seg.Uri, ct); failures = 0; }
                catch (HttpRequestException) when (++failures < 4) { next = seg.Sequence + 1; continue; } // a segment gone: skip it
                if (seg.Key is { Method: "AES-128", Uri: { } ku })
                {
                    if (!keys.TryGetValue(ku, out var k)) keys[ku] = k = await GetBytes(ku, ct);
                    data = Decrypt(data, k, seg.Key.Iv ?? HlsPlaylist.SequenceIv(seg.Sequence));
                }
                else if (seg.Key != null) throw new InvalidOperationException("This station's stream is protected (" + seg.Key.Method + "), which NoorMD can't play.");
                var (sound, t) = demux.Feed(data);
                t ??= seg.Title is { } st && st.Contains(" - ", StringComparison.Ordinal) ? st : null;
                if (t != null && t != lastTitle) { lastTitle = t; title?.Invoke(t); }
                if (sound.Length > 0) await write(demux.ContentType ?? "audio/aac", sound);
                next = seg.Sequence + 1;
            }
            if (playlist.Ended) return; // a finished playlist: all of it has played
            // Live: wait about half a segment if nothing was new, then read the playlist again.
            if (fresh.Count == 0) await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(playlist.TargetDuration / 2, 1, 10)), ct);
            playlist = HlsPlaylist.Parse(await GetText(playlistUri, ct), playlistUri);
            // The station restarted its numbering: start again near its end.
            if (playlist.Segments.Count > 0 && playlist.Segments[^1].Sequence < next - 1) next = playlist.Segments[Math.Max(0, playlist.Segments.Count - StartBehind)].Sequence;
        }
    }

    public static byte[] Decrypt(byte[] data, byte[] key, byte[] iv)
    {
        using var aes = Aes.Create();
        aes.Key = key;
        return aes.DecryptCbc(data, iv, PaddingMode.PKCS7);
    }

    private async Task<string> GetText(Uri u, CancellationToken ct) => Encoding.UTF8.GetString(await GetBytes(u, ct, MaxPlaylistBytes));

    private async Task<byte[]> GetBytes(Uri u, CancellationToken ct, int max = MaxSegmentBytes)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        using var resp = await http.GetAsync(u, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        resp.EnsureSuccessStatusCode();
        await using var s = await resp.Content.ReadAsStreamAsync(timeout.Token);
        using var ms = new MemoryStream();
        var buf = new byte[64 * 1024];
        int n;
        while ((n = await s.ReadAsync(buf, timeout.Token)) > 0)
        {
            ms.Write(buf, 0, n);
            if (ms.Length > max) throw new HttpRequestException("A piece of the stream is far too big.");
        }
        return ms.ToArray();
    }
}
