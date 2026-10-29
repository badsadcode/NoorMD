using System.Net;
using System.Security.Cryptography;
using System.Text;
using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>HLS radio: playlists, the pieces unpacked (MPEG-TS, plain AAC, fragmented MP4), encryption, live following.</summary>
public class RadioHlsTests
{
    private static readonly Uri Base = new("https://radio.example/live/master.m3u8");

    [Fact]
    public void A_master_playlist_lists_its_variants_and_the_sound_only_one_is_chosen()
    {
        var p = HlsPlaylist.Parse("""
            #EXTM3U
            #EXT-X-STREAM-INF:BANDWIDTH=1280000,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aud"
            video/720.m3u8
            #EXT-X-STREAM-INF:BANDWIDTH=96000,CODECS="mp4a.40.2"
            audio/96k.m3u8
            #EXT-X-STREAM-INF:BANDWIDTH=320000,CODECS="mp4a.40.2"
            audio/320k.m3u8
            #EXT-X-STREAM-INF:BANDWIDTH=640000,CODECS="mp4a.40.2"
            audio/640k.m3u8
            #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",DEFAULT=YES,URI="audio/main.m3u8"
            """, Base);
        Assert.True(p.IsMaster);
        Assert.Equal(4, p.Variants.Count);
        Assert.Equal(new Uri("https://radio.example/live/audio/main.m3u8"), p.Variants[0].AudioUri);
        Assert.False(p.Variants[0].AudioOnly);
        Assert.Equal("https://radio.example/live/audio/320k.m3u8", p.Choose()!.Uri.ToString());
    }

    [Fact]
    public void A_media_playlist_has_its_pieces_numbered_with_keys_and_titles()
    {
        var p = HlsPlaylist.Parse("""
            #EXTM3U
            #EXT-X-TARGETDURATION:10
            #EXT-X-MEDIA-SEQUENCE:120
            #EXTINF:9.98,Artist A - Song One
            seg120.ts
            #EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/k1",IV=0x000102030405060708090A0B0C0D0E0F
            #EXTINF:10.0,
            https://cdn.example/seg121.ts
            #EXT-X-KEY:METHOD=NONE
            #EXT-X-MAP:URI="init.mp4"
            #EXTINF:10,
            seg122.m4s
            #EXT-X-ENDLIST
            """, Base);
        Assert.False(p.IsMaster);
        Assert.True(p.Ended);
        Assert.Equal(10, p.TargetDuration);
        Assert.Equal([120L, 121, 122], p.Segments.Select(s => s.Sequence));
        Assert.Equal("Artist A - Song One", p.Segments[0].Title);
        Assert.Equal("https://cdn.example/seg121.ts", p.Segments[1].Uri.ToString());
        Assert.Equal("AES-128", p.Segments[1].Key!.Method);
        Assert.Equal(Enumerable.Range(0, 16).Select(i => (byte)i), p.Segments[1].Key!.Iv!);
        Assert.Null(p.Segments[2].Key);
        Assert.Equal("https://radio.example/live/init.mp4", p.Segments[2].Map!.ToString());
        Assert.Equal(new byte[] { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2 }, HlsPlaylist.SequenceIv(258));
    }

    // ------------------------------------------------------------------ test data

    /// <summary>ADTS frames (AAC-LC, 44.1 kHz, stereo) with numbered payloads.</summary>
    private static byte[] Adts(int frames, int payload = 40)
    {
        var ms = new MemoryStream();
        for (var f = 0; f < frames; f++)
        {
            var len = payload + 7;
            ms.Write([0xFF, 0xF1, (byte)((1 << 6) | (4 << 2) | 0), (byte)((2 << 6) | (len >> 11)), (byte)((len >> 3) & 0xFF), (byte)(((len & 7) << 5) | 0x1F), 0xFC]);
            for (var i = 0; i < payload; i++) ms.WriteByte((byte)(f * 7 + i));
        }
        return ms.ToArray();
    }

    private static byte[] Id3(params (string Id, string Text)[] frames)
    {
        var body = new MemoryStream();
        foreach (var (id, text) in frames)
        {
            var t = Encoding.UTF8.GetBytes(text);
            body.Write(Encoding.ASCII.GetBytes(id));
            var n = t.Length + 1;
            body.Write([(byte)(n >> 21 & 0x7F), (byte)(n >> 14 & 0x7F), (byte)(n >> 7 & 0x7F), (byte)(n & 0x7F), 0, 0, 3]);
            body.Write(t);
        }
        var size = (int)body.Length;
        return [.. "ID3"u8, 4, 0, 0, (byte)(size >> 21 & 0x7F), (byte)(size >> 14 & 0x7F), (byte)(size >> 7 & 0x7F), (byte)(size & 0x7F), .. body.ToArray()];
    }

    /// <summary>An MPEG-TS segment: PAT, PMT (AAC on PID 0x101, ID3 on 0x102), the sound in PES packets cut into TS packets.</summary>
    private static byte[] Ts(byte[] adts, byte[]? id3 = null)
    {
        var ms = new MemoryStream();
        var cc = new Dictionary<int, int>();
        void Packet(int pid, bool start, ReadOnlySpan<byte> payload)
        {
            var p = new byte[188];
            p[0] = 0x47; p[1] = (byte)((start ? 0x40 : 0) | (pid >> 8)); p[2] = (byte)pid;
            var c = cc.GetValueOrDefault(pid); cc[pid] = (c + 1) & 15;
            if (payload.Length >= 184) { p[3] = (byte)(0x10 | c); payload[..184].CopyTo(p.AsSpan(4)); }
            else
            {
                // Adaptation field stuffing so the payload ends the packet.
                var af = 184 - payload.Length - 1;
                p[3] = (byte)(0x30 | c); p[4] = (byte)af;
                if (af > 0) { p[5] = 0; for (var i = 6; i < 5 + af; i++) p[i] = 0xFF; }
                payload.CopyTo(p.AsSpan(5 + af));
            }
            ms.Write(p);
        }
        void Pes(int pid, byte streamId, byte[] data)
        {
            var pes = new byte[] { 0, 0, 1, streamId, 0, 0, 0x80, 0x00, 0x00 }.Concat(data).ToArray();
            for (var at = 0; at < pes.Length; at += 184) Packet(pid, at == 0, pes.AsSpan(at, Math.Min(184, pes.Length - at)));
        }
        Packet(0, true, [0, 0x00, 0xB0, 13, 0, 1, 0xC1, 0, 0, 0, 1, 0xE1, 0x00, 0, 0, 0, 0]);
        Packet(0x100, true, [0, 0x02, 0xB0, 23, 0, 1, 0xC1, 0, 0, 0xE1, 0x01, 0xF0, 0x00, 0x0F, 0xE1, 0x01, 0xF0, 0x00, 0x15, 0xE1, 0x02, 0xF0, 0x00, 0, 0, 0, 0]);
        if (id3 != null) Pes(0x102, 0xBD, id3);
        Pes(0x101, 0xC0, adts);
        return ms.ToArray();
    }

    private static byte[] BoxOf(string type, params byte[][] parts)
    {
        var body = parts.SelectMany(x => x).ToArray();
        var n = body.Length + 8;
        return [(byte)(n >> 24), (byte)(n >> 16), (byte)(n >> 8), (byte)n, .. Encoding.ASCII.GetBytes(type), .. body];
    }

    private static byte[] U32(int v) => [(byte)(v >> 24), (byte)(v >> 16), (byte)(v >> 8), (byte)v];

    // ------------------------------------------------------------------ unpacking

    [Fact]
    public void MpegTs_pieces_give_the_aac_inside_and_the_id3_title()
    {
        var sound = Adts(30);
        var d = new HlsDemuxer();
        var (got, title) = d.Feed(Ts(sound, Id3(("TPE1", "Kora"), ("TIT2", "Zabawa w chowanego"))));
        Assert.Equal(sound, got);
        Assert.Equal("audio/aac", d.ContentType);
        Assert.Equal("Kora - Zabawa w chowanego", title);
    }

    [Fact]
    public void Plain_aac_pieces_lose_their_id3_tag()
    {
        var sound = Adts(5);
        var d = new HlsDemuxer();
        var (got, title) = d.Feed([.. Id3(("TIT2", "Only a title")), .. sound]);
        Assert.Equal(sound, got);
        Assert.Equal("Only a title", title);
        Assert.Equal("audio/aac", d.ContentType);
        var mp3 = new HlsDemuxer();
        mp3.Feed([0xFF, 0xFB, 0x90, 0x64, 1, 2, 3]);
        Assert.Equal("audio/mpeg", mp3.ContentType);
    }

    [Fact]
    public void Fragmented_mp4_samples_become_adts_frames()
    {
        // esds: ES descriptor › decoder config › decoder-specific info = AAC-LC, 48 kHz (index 3), stereo.
        byte[] asc = [0x11, 0x90];
        byte[] esdsBody = [0, 0, 0, 0, 0x03, 25, 0, 1, 0, 0x04, 17, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x05, 2, .. asc, 0x06, 1, 2];
        var init = BoxOf("ftyp", "iso6"u8.ToArray(), U32(0)).Concat(BoxOf("moov", BoxOf("trak", BoxOf("esds", esdsBody)))).ToArray();
        byte[] s1 = [.. Enumerable.Repeat((byte)0xAA, 20)], s2 = [.. Enumerable.Repeat((byte)0xBB, 33)];
        var trun = BoxOf("trun", U32(0x000201), U32(2), U32(0), U32(s1.Length), U32(s2.Length)); // flags: data offset, sizes
        var tfhd = BoxOf("tfhd", U32(0x020000), U32(1));
        var moof = BoxOf("moof", BoxOf("traf", tfhd, trun));
        // The data offset: from the moof's start to the mdat's data.
        var offset = moof.Length + 8;
        trun = BoxOf("trun", U32(0x000201), U32(2), U32(offset), U32(s1.Length), U32(s2.Length));
        moof = BoxOf("moof", BoxOf("traf", tfhd, trun));
        var seg = moof.Concat(BoxOf("mdat", s1, s2)).ToArray();
        var d = new HlsDemuxer();
        d.Init(init);
        Assert.True(d.HasAacConfig);
        var (got, _) = d.Feed(seg);
        Assert.Equal("audio/aac", d.ContentType);
        Assert.Equal(7 + s1.Length + 7 + s2.Length, got.Length);
        Assert.Equal(new byte[] { 0xFF, 0xF1 }, got[..2]);
        Assert.Equal(1, got[2] >> 6);           // AAC-LC
        Assert.Equal(3, (got[2] >> 2) & 0x0F);   // 48 kHz
        Assert.Equal(2, ((got[2] & 1) << 2) | (got[3] >> 6)); // stereo
        Assert.Equal(7 + s1.Length, ((got[3] & 3) << 11) | (got[4] << 3) | (got[5] >> 5));
        Assert.Equal(s1, got[7..(7 + s1.Length)]);
        Assert.Equal(s2, got[^s2.Length..]);
    }

    // ------------------------------------------------------------------ following a station

    private sealed class FakeServer : HttpMessageHandler
    {
        public readonly Dictionary<string, Func<byte[]>> Files = new();
        public readonly List<string> Asked = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var u = request.RequestUri!.ToString();
            lock (Asked) Asked.Add(u);
            if (!Files.TryGetValue(u, out var f)) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
            var r = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(f()), RequestMessage = request };
            r.Content.Headers.ContentType = new(u.EndsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "application/octet-stream");
            return Task.FromResult(r);
        }
    }

    [Fact]
    public async Task A_finished_playlist_plays_through_decrypting_and_reporting_titles()
    {
        var srv = new FakeServer();
        var a = Adts(10); var b = Adts(12);
        var key = Enumerable.Range(100, 16).Select(i => (byte)i).ToArray();
        byte[] encrypted;
        using (var aes = Aes.Create()) { aes.Key = key; encrypted = aes.EncryptCbc(Ts(b), HlsPlaylist.SequenceIv(8), PaddingMode.PKCS7); }
        srv.Files["https://radio.example/live/master.m3u8"] = () => "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS=\"mp4a.40.2\"\nlow/index.m3u8\n"u8.ToArray();
        srv.Files["https://radio.example/live/low/index.m3u8"] = () => Encoding.UTF8.GetBytes("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:6,Band - Tune\ns7.aac\n#EXT-X-KEY:METHOD=AES-128,URI=\"/key\"\n#EXTINF:6,\ns8.ts\n#EXT-X-ENDLIST\n");
        srv.Files["https://radio.example/live/low/s7.aac"] = () => a;
        srv.Files["https://radio.example/live/low/s8.ts"] = () => encrypted;
        srv.Files["https://radio.example/key"] = () => key;
        using var http = new HttpClient(srv);
        var output = new MemoryStream();
        var types = new List<string>(); var titles = new List<string>();
        var master = Encoding.UTF8.GetString(srv.Files[Base.ToString()]());
        await new HlsReader(http).RunAsync(Base, master, (t, d) => { types.Add(t); output.Write(d.Span); return Task.CompletedTask; }, titles.Add, CancellationToken.None);
        Assert.Equal([.. a, .. b], output.ToArray());
        Assert.All(types, t => Assert.Equal("audio/aac", t));
        Assert.Equal(["Band - Tune"], titles);
    }

    [Fact]
    public async Task A_live_playlist_is_followed_from_near_its_end_without_repeating_pieces()
    {
        var srv = new FakeServer();
        var first = 0;
        var reads = 0;
        // Each read of the playlist adds a piece; it always lists the last five.
        srv.Files["https://radio.example/live/master.m3u8"] = () =>
        {
            var n = Interlocked.Increment(ref reads);
            first = 10 + n;
            var sb = new StringBuilder($"#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:{first}\n");
            for (var k = first; k < first + 5; k++) sb.Append($"#EXTINF:2,\np{k}.aac\n");
            return Encoding.UTF8.GetBytes(sb.ToString());
        };
        for (var k = 0; k < 40; k++) { var kk = k; srv.Files[$"https://radio.example/live/p{kk}.aac"] = () => Adts(1, 8 + kk); }
        using var http = new HttpClient(srv);
        var got = new List<int>();
        using var cts = new CancellationTokenSource();
        var text = Encoding.UTF8.GetString(srv.Files[Base.ToString()]());
        var run = new HlsReader(http).RunAsync(Base, text, (_, d) =>
        {
            got.Add(d.Length - 7 - 8); // which piece (its payload length)
            if (got.Count == 6) cts.Cancel();
            return Task.CompletedTask;
        }, null, cts.Token);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => run);
        // Started three pieces before the end (13, 14, 15), then each new one once.
        Assert.Equal([13, 14, 15, 16, 17, 18], got);
    }

    [Fact]
    public async Task The_relay_plays_an_hls_station_as_one_stream()
    {
        var srv = new FakeServer();
        var a = Adts(6); var b = Adts(9);
        srv.Files["https://radio.example/live/master.m3u8"] = () => "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts\n#EXT-X-ENDLIST\n"u8.ToArray();
        srv.Files["https://radio.example/live/a.ts"] = () => Ts(a);
        srv.Files["https://radio.example/live/b.ts"] = () => Ts(b, Id3(("TIT2", "Hello"), ("TPE1", "World")));
        await using var relay = new RadioRelay(new HttpClient(srv)) { AllowedOrigin = "https://noormd.local" };
        var titles = new List<string>();
        relay.Title += (_, t) => { lock (titles) titles.Add(t); };
        var (_, url) = relay.Open(Base.ToString());
        using var http = new HttpClient();
        using var resp = await http.GetAsync(url);
        Assert.Equal("audio/aac", resp.Content.Headers.ContentType!.MediaType);
        // The page may read it (for its equalizer), and only that page.
        Assert.Equal("https://noormd.local", resp.Headers.GetValues("Access-Control-Allow-Origin").Single());
        var body = await resp.Content.ReadAsByteArrayAsync();
        Assert.Equal(a.Concat(b).ToArray(), body);
        Assert.Equal(["World - Hello"], titles);
    }
}
