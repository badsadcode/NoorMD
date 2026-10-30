using System.Net;
using System.Net.Sockets;
using System.Text;
using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

public class RadioTests
{
    [Fact]
    public void Station_Addresses_Are_Http_Or_Https_Without_Passwords()
    {
        Assert.Equal("https://stream.example.com/live.mp3", RadioUrl.Clean("  https://stream.example.com/live.mp3 "));
        Assert.Throws<ArgumentException>(() => RadioUrl.Clean("file:///C:/music.mp3"));
        Assert.Throws<ArgumentException>(() => RadioUrl.Clean("javascript:alert(1)"));
        Assert.Throws<ArgumentException>(() => RadioUrl.Clean("http://user:secret@example.com/s"));
        Assert.Throws<ArgumentException>(() => RadioUrl.Clean(""));
        Assert.True(RadioUrl.LooksLikePlaylist("http://x.example/listen.pls?id=4"));
        Assert.False(RadioUrl.LooksLikePlaylist("http://x.example/stream"));
    }

    [Fact]
    public void Pls_And_M3u_Lists_Are_Read_And_Hls_Is_Recognised()
    {
        var pls = "[playlist]\r\nNumberOfEntries=2\r\nFile1=http://a.example/s1\r\nTitle1=NoorRadio Kraków\r\nFile2=ftp://bad.example/x\r\nFile3=https://b.example/s3\r\nVersion=2\r\n";
        Assert.Equal([("NoorRadio Kraków", "http://a.example/s1"), (null, "https://b.example/s3")], RadioPlaylist.Parse(pls));
        var m3u = "#EXTM3U\n#EXTINF:-1,Jazz FM\nhttp://jazz.example/live\n# comment\nhttps://plain.example/s\n";
        Assert.Equal([("Jazz FM", "http://jazz.example/live"), (null, "https://plain.example/s")], RadioPlaylist.Parse(m3u));
        Assert.True(RadioPlaylist.IsHls("#EXTM3U\n#EXT-X-TARGETDURATION:6\nseg1.aac\n"));
        Assert.False(RadioPlaylist.IsHls(m3u));
        var out_ = RadioPlaylist.ToM3u([new RadioStation(1, "Jazz\nFM", "http://jazz.example/live", null, [], false, DateTime.UtcNow, null, 0)]);
        Assert.Equal("#EXTM3U\n#EXTINF:-1,Jazz FM\nhttp://jazz.example/live\n", out_);
    }

    [Fact]
    public void Stations_Are_Kept_With_Favourites_Tags_And_Plays()
    {
        using var t = new TempDir();
        var lib = new RadioLibrary(t.P("radio.db"));
        var (id, added) = lib.Add("  Radio Nowy Świat ", "https://stream.example/nowyswiat", "https://nowyswiat.online", ["#polskie", "talk", "Talk", ""]);
        Assert.True(added);
        Assert.Equal((id, false), lib.Add("Again", "HTTPS://STREAM.EXAMPLE/nowyswiat")); // the same address: kept once
        var (other, _) = lib.Add(null, "http://jazz.example/live");
        Assert.Equal("jazz.example", lib.Get(other)!.Name); // no name: the host
        lib.SetFavorite(id, true);
        lib.MarkPlayed(id);
        var s = lib.Get(id)!;
        Assert.Equal(("Radio Nowy Świat", true, 1, "polskie,talk"), (s.Name, s.Favorite, s.Plays, string.Join(',', s.Tags)));
        Assert.NotNull(s.LastPlayedUtc);
        Assert.Throws<ArgumentException>(() => lib.Update(other, "Jazz", "https://stream.example/nowyswiat", null, null)); // taken
        lib.Update(other, "Jazz FM", "http://jazz.example/live2", "not a url", ["jazz"]);
        Assert.Equal(("Jazz FM", "http://jazz.example/live2", null), (lib.Get(other)!.Name, lib.Get(other)!.Url, lib.Get(other)!.Homepage));
        Assert.Equal(["Jazz FM", "Radio Nowy Świat"], lib.All().Select(x => x.Name));
        Assert.Equal((1, 1), lib.Import("#EXTM3U\n#EXTINF:-1,Nowa\nhttp://new.example/s\nhttp://jazz.example/live2\n"));
        Assert.Throws<ArgumentException>(() => lib.Import("#EXTM3U\n#EXT-X-VERSION:3\n"));
        lib.Delete(other);
        Assert.Null(lib.Get(other));
    }

    [Fact]
    public void Icy_Metadata_Is_Taken_Out_Of_The_Sound_And_Read_In_Any_Chunking()
    {
        var stream = IcyStream(metaInt: 8, ["StreamTitle='Kult - Arahja';", "StreamTitle='Zażółć gęślą';StreamUrl='';"], blocks: 3, out var sound);
        foreach (var chunk in new[] { 1, 3, 7, 64 })
        {
            var reader = new IcyReader(8);
            var outp = new MemoryStream();
            var titles = new List<string>();
            for (var i = 0; i < stream.Length; i += chunk)
                reader.Feed(stream.AsSpan(i, Math.Min(chunk, stream.Length - i)), outp, titles.Add);
            Assert.Equal(sound, outp.ToArray());
            Assert.Contains("Kult - Arahja", titles);
            Assert.Contains("Zażółć gęślą", titles);
        }
        Assert.Equal("Café", IcyReader.ParseTitle(Encoding.Latin1.GetBytes("StreamTitle='Café';\0\0\0")));
        Assert.Null(IcyReader.ParseTitle(Encoding.ASCII.GetBytes("StreamUrl='x';")));
        var plain = new MemoryStream();
        new IcyReader(0).Feed([1, 2, 3], plain, _ => Assert.Fail("no metadata here"));
        Assert.Equal(new byte[] { 1, 2, 3 }, plain.ToArray());
    }

    [Fact]
    public void Directory_Results_Keep_Only_Playable_Addresses()
    {
        var json = """
            [{"name":"NoorRadio 357","url":"http://x.example/a.pls","url_resolved":"https://stream.radio357.example/","homepage":"https://radio357.pl","tags":"polish,rock","countrycode":"PL","codec":"MP3","bitrate":128,"hls":0},
             {"name":"Bad","url":"ftp://nope","url_resolved":""},
             {"name":"Dup","url_resolved":"HTTPS://stream.radio357.example/"},
             {"name":"HLS one","url_resolved":"https://h.example/live.m3u8","hls":1}]
            """;
        var r = RadioDirectory.Parse(json);
        Assert.Equal(2, r.Count);
        Assert.Equal(("NoorRadio 357", "https://stream.radio357.example/", "PL", 128, false), (r[0].Name, r[0].Url, r[0].Country, r[0].Bitrate, r[0].Hls));
        Assert.Equal(["polish", "rock"], r[0].Tags);
        Assert.True(r[1].Hls);
    }

    [Fact]
    public async Task The_Relay_Passes_The_Sound_On_Loopback_And_Reports_Titles()
    {
        var stream = IcyStream(metaInt: 16, ["StreamTitle='Pierwsza';", "StreamTitle='Druga';"], blocks: 40, out var sound);
        using var upstream = new TcpListener(IPAddress.Loopback, 0);
        upstream.Start();
        var upPort = ((IPEndPoint)upstream.LocalEndpoint).Port;
        var gotIcyHeader = false;
        var server = Task.Run(async () =>
        {
            using var c = await upstream.AcceptTcpClientAsync();
            var s = c.GetStream();
            var req = new byte[4096];
            var n = await s.ReadAsync(req);
            gotIcyHeader = Encoding.ASCII.GetString(req, 0, n).Contains("Icy-MetaData: 1", StringComparison.OrdinalIgnoreCase);
            await s.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nicy-metaint: 16\r\nConnection: close\r\n\r\n"));
            await s.WriteAsync(stream);
        });
        await using var relay = new RadioRelay();
        var titles = new List<string>();
        relay.Title += (_, t) => { lock (titles) titles.Add(t); };
        var (token, url) = relay.Open($"http://127.0.0.1:{upPort}/live");
        Assert.StartsWith($"http://127.0.0.1:{relay.Port}/radio/", url);
        using var http = new HttpClient();
        var got = await http.GetByteArrayAsync(url);
        await server;
        Assert.True(gotIcyHeader);
        Assert.Equal(sound, got);
        Assert.Equal(["Pierwsza", "Druga"], titles);
        // Another station closes this one; unknown paths and other Host names are refused.
        relay.Open($"http://127.0.0.1:{upPort}/other");
        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync(url)).StatusCode);
        using var rebind = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{relay.Port}/radio/{token}");
        rebind.Headers.Host = "evil.example";
        Assert.Equal(HttpStatusCode.Forbidden, (await http.SendAsync(rebind)).StatusCode);
    }

    /// <summary>An ICY stream: blocks of sound (bytes 0..), each followed by metadata (the titles in turn, then empty).</summary>
    private static byte[] IcyStream(int metaInt, string[] titles, int blocks, out byte[] sound)
    {
        var all = new MemoryStream();
        var snd = new MemoryStream();
        byte b = 0;
        for (var k = 0; k < blocks; k++)
        {
            for (var i = 0; i < metaInt; i++) { all.WriteByte(b); snd.WriteByte(b); b++; }
            if (k < titles.Length)
            {
                var meta = Encoding.UTF8.GetBytes(titles[k]);
                var len = (meta.Length + 15) / 16;
                all.WriteByte((byte)len);
                all.Write(meta);
                all.Write(new byte[len * 16 - meta.Length]);
            }
            else all.WriteByte(0);
        }
        sound = snd.ToArray();
        return all.ToArray();
    }
}
