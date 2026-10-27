using System.Net;
using System.Net.Sockets;
using System.Text;
using NoorMD.Core.Stream;
using Xunit;

namespace NoorMD.Core.Tests;

public class SupportersTests
{
    [Fact]
    public void Table_Round_Trips_And_Keeps_The_Rest_Of_The_Note()
    {
        var md = "---\nnoormd: supporters\n---\n# Supporters\n\nThank you!\n\n| Name | Channel | Tier | Since | Until | Note |\n|---|---|---|---|---|---|\n| Ania | https://youtube.com/@ania | Gold | 2026-01-03 |  | first \\| best |\n| Bartek | [yt](https://youtube.com/@bartek) |  | 2025-12-01 | 2026-09-30 |  |\n\nFooter text\n";
        var list = SupportersFile.Parse(md);
        Assert.Equal(2, list.Count);
        Assert.Equal(new Supporter("Ania", "https://youtube.com/@ania", "Gold", new DateOnly(2026, 1, 3), null, "first | best"), list[0]);
        Assert.False(list[1].Active);
        Assert.Equal("https://youtube.com/@bartek", list[1].Channel);
        var written = SupportersFile.Write(md, [.. list, new Supporter("Ćma", null, "Silver", new DateOnly(2026, 10, 26))]);
        Assert.Contains("Thank you!", written);
        Assert.EndsWith("Footer text\n", written);
        Assert.Contains("| Ćma |  | Silver | 2026-10-26 |  |  |", written);
        Assert.Contains("first \\| best", written);
        Assert.Equal(3, SupportersFile.Parse(written).Count);
        Assert.Equal(list[0], SupportersFile.Parse(written)[0]);
    }

    [Fact]
    public void New_Note_Uses_The_Template_And_Crlf_Is_Kept()
    {
        var fresh = SupportersFile.Write(null, [new Supporter("Ania")]);
        Assert.StartsWith("---\nnoormd: supporters", fresh);
        Assert.Single(SupportersFile.Parse(fresh));
        var crlf = SupportersFile.Write("# S\r\n\r\n| Name | Channel |\r\n|---|---|\r\n| X | |\r\n", [new Supporter("Y")]);
        Assert.Contains("\r\n", crlf);
        Assert.DoesNotContain("\n\n\n", crlf.Replace("\r\n", "\n"));
        Assert.Equal("Y", SupportersFile.Parse(crlf).Single().Name);
    }

    [Theory]
    [InlineData("https://youtube.com/@x", "https://youtube.com/@x")]
    [InlineData("youtube.com/@x", "https://youtube.com/@x")]
    [InlineData("@noor_fan", "https://www.youtube.com/@noor_fan")]
    [InlineData("javascript:alert(1)", null)]
    [InlineData("not a link", null)]
    public void Only_Web_Links_Are_Kept(string input, string? expected) => Assert.Equal(expected, SupportersFile.CleanLink(input));

    [Fact]
    public void Import_Reads_Csv_With_Header_Tsv_And_Plain_Lines()
    {
        var yt = "Member,Link to profile,Current level,Total time on level (months),Last update\nAnia,https://www.youtube.com/channel/UC1,Gold,3,2026-08-01\n\"Kowalski, Jan\",https://www.youtube.com/channel/UC2,Silver,1,2026-10-01\n";
        var a = SupportersFile.Import(yt);
        Assert.Equal(["Ania", "Kowalski, Jan"], a.Select(s => s.Name));
        Assert.Equal("Gold", a[0].Tier);
        Assert.Equal("https://www.youtube.com/channel/UC2", a[1].Channel);
        Assert.Equal(new DateOnly(2026, 8, 1), a[0].Since);
        var tsv = SupportersFile.Import("Ania\thttps://youtube.com/@ania\nBartek\t@bartek");
        Assert.Equal("https://www.youtube.com/@bartek", tsv[1].Channel);
        var plain = SupportersFile.Import("Ania - https://youtube.com/@ania\nhttps://www.twitch.tv/zosia\nJust A Name\n\nJust a name");
        Assert.Equal(["Ania", "zosia", "Just A Name"], plain.Select(s => s.Name));
    }

    [Fact]
    public void Merge_Adds_Updates_Brings_Back_And_Marks_Missing_As_Left()
    {
        var today = new DateOnly(2026, 10, 26);
        List<Supporter> cur = [new("Ania", "https://youtube.com/@ania", "Silver", new(2026, 1, 1)), new("Bartek", null, null, new(2025, 1, 1), new(2026, 5, 1)), new("Celina", null, null, new(2026, 2, 2))];
        List<Supporter> imp = [new("ania-renamed", "https://youtube.com/@ania/", "Gold"), new("BARTEK"), new("Dawid", "https://youtube.com/@d")];
        var r = SupportersFile.Merge(cur, imp, markMissingAsLeft: true, today);
        Assert.Equal(["Dawid"], r.Added);
        Assert.Equal(["Ania"], r.Updated);
        Assert.Equal(["Bartek"], r.Returned);
        Assert.Equal(["Celina"], r.Left);
        Assert.Equal("Gold", r.Merged[0].Tier);
        Assert.Equal("Ania", r.Merged[0].Name); // the name in the list is kept
        Assert.True(r.Merged[1].Active);
        Assert.Equal(today, r.Merged[2].Until);
        Assert.Equal(today, r.Merged[3].Since);
        Assert.Empty(SupportersFile.Merge(cur, imp, markMissingAsLeft: false, today).Left);
    }
}

public class StreamLogTests
{
    [Fact]
    public void Templates_Fill_Known_Placeholders_And_Dates()
    {
        var v = new Dictionary<string, string?> { ["number"] = "12", ["game"] = "Wayfarer's Wake" };
        Assert.Equal("Stream #12 – Wayfarer's Wake (26.10.2026) {typo}", StreamLog.Fill("Stream #{number} – {game} ({date:dd.MM.yyyy}) {typo}", v, new DateOnly(2026, 10, 26)));
        Assert.Equal("2026-10-26", StreamLog.Fill("{date}", v, new DateOnly(2026, 10, 26)));
    }

    [Fact]
    public void Chapters_Start_At_Zero_And_Drop_Short_Tracks()
    {
        var c = StreamLog.Chapters([new(12, "First"), new(15, "Skipped quickly"), new(200, "Second"), new(3700, "Late")]);
        Assert.Equal("0:00:00 Skipped quickly\n0:03:20 Second\n1:01:40 Late", c);
        Assert.Equal("00:00 A\n01:00 B", StreamLog.Chapters([new(3, "A"), new(60, "B")]));
    }

    [Fact]
    public void Stream_Note_Round_Trips()
    {
        var e = new StreamEntry
        {
            Title = "Night drive: synthwave & chill", Date = new DateOnly(2026, 10, 26), Number = 12, Description = "Line one\n\nLine two",
            Keywords = ["suno", "synthwave", "lo-fi, chill"], Thumbnail = "../attachments/thumb 12.png", Url = "https://youtu.be/abc",
            Tracklist = [new(0, "Noor – Intro"), new(3725, "Noor – Żółw nocą")], Notes = "Chat loved track 2.",
        };
        var md = StreamLog.Serialize(e);
        Assert.Contains("title: \"Night drive: synthwave & chill\"", md);
        Assert.Contains("![Thumbnail](<../attachments/thumb 12.png>)", md);
        Assert.Contains("- 01:02:05 Noor – Żółw nocą", md);
        var back = StreamLog.Parse(md, "Streams/x.md")!;
        Assert.Equal(e.Title, back.Title);
        Assert.Equal(e.Date, back.Date);
        Assert.Equal(12, back.Number);
        Assert.Equal(e.Keywords, back.Keywords);
        Assert.Equal(e.Thumbnail, back.Thumbnail);
        Assert.Equal(e.Url, back.Url);
        Assert.Equal(e.Description, back.Description);
        Assert.Equal(e.Tracklist, back.Tracklist);
        Assert.Equal(e.Notes, back.Notes);
        Assert.Null(StreamLog.Parse("# Just a note"));
        // Hand-edited with Windows paths: backslashes that aren't escapes are kept, and nothing throws.
        var edited = StreamLog.Parse("---\nnoormd: stream\ntitle: \"C:\\Users stream\"\nthumbnail: \"..\\Thumbs\\a.png\"\nkeywords: [\"a\\b\", c]\n---\n")!;
        Assert.Equal(@"..\Thumbs\a.png", edited.Thumbnail);
        Assert.Equal(["a\\b", "c"], edited.Keywords);
    }

    [Fact]
    public void Keywords_And_File_Names()
    {
        Assert.Equal(["suno", "synthwave", "Chill"], StreamLog.Keywords("#suno, synthwave; Chill\nchill"));
        Assert.Equal("2026-10-26 #12 Q- A-B.md", StreamLog.FileName(new StreamEntry { Date = new(2026, 10, 26), Number = 12, Title = "Q? A/B" }));
    }
}

public class OverlayServerTests
{
    private static async Task<string> Raw(int port, string request)
    {
        using var c = new TcpClient();
        await c.ConnectAsync(IPAddress.Loopback, port);
        var s = c.GetStream();
        await s.WriteAsync(Encoding.ASCII.GetBytes(request));
        using var r = new StreamReader(s);
        return await r.ReadToEndAsync().WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task Serves_Files_And_Dynamic_Paths_Only_To_Loopback_Hosts()
    {
        var dir = Path.Combine(Path.GetTempPath(), "noormd-overlay-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "now-playing.html"), "<p>np</p>");
        File.WriteAllText(Path.Combine(dir, "secret.txt"), "no");
        await using var server = new OverlayServer(dir, p => p == "/state.json" ? (Encoding.UTF8.GetBytes("{\"a\":1}"), "application/json") : null);
        server.Start(0);
        var port = server.Port;
        var ok = await Raw(port, $"GET /now-playing.html HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n");
        Assert.StartsWith("HTTP/1.1 200", ok);
        Assert.Contains("<p>np</p>", ok);
        Assert.Contains("Content-Security-Policy", ok);
        Assert.Contains("{\"a\":1}", await Raw(port, $"GET /state.json HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n"));
        Assert.StartsWith("HTTP/1.1 404", await Raw(port, $"GET /secret.txt HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"));
        Assert.StartsWith("HTTP/1.1 404", await Raw(port, $"GET /..%2f..%2fetc%2fpasswd.html HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"));
        Assert.StartsWith("HTTP/1.1 421", await Raw(port, $"GET /now-playing.html HTTP/1.1\r\nHost: evil.example:{port}\r\n\r\n"));
        Assert.StartsWith("HTTP/1.1 421", await Raw(port, "GET /now-playing.html HTTP/1.1\r\n\r\n"));
        Assert.StartsWith("HTTP/1.1 405", await Raw(port, $"POST /now-playing.html HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\n\r\n"));
        await server.StopAsync();
        Assert.False(server.Running);
        Directory.Delete(dir, true);
    }

    [Fact]
    public async Task An_Overlay_That_Stops_Reading_Never_Blocks_Broadcasts()
    {
        await using var server = new OverlayServer(Path.GetTempPath(), _ => null);
        server.Start(0);
        using var c = new TcpClient { ReceiveBufferSize = 1024 };
        await c.ConnectAsync(IPAddress.Loopback, server.Port);
        await c.GetStream().WriteAsync(Encoding.ASCII.GetBytes($"GET /events HTTP/1.1\r\nHost: 127.0.0.1:{server.Port}\r\n\r\n"));
        for (var i = 0; i < 50 && server.SseClients == 0; i++) await Task.Delay(20);
        Assert.Equal(1, server.SseClients);
        var big = "{\"t\":\"" + new string('x', 60_000) + "\"}";
        var sw = System.Diagnostics.Stopwatch.StartNew();
        for (var i = 0; i < 400; i++) server.Broadcast("nowplaying", big); // ~24 MB to a client that reads nothing
        Assert.True(sw.ElapsedMilliseconds < 1500, $"{sw.ElapsedMilliseconds} ms");
        for (var i = 0; i < 100 && server.SseClients > 0; i++) await Task.Delay(50);
        Assert.Equal(0, server.SseClients); // dropped once it fell behind
    }

    [Fact]
    public async Task Pushes_Events_And_Replays_The_Last_One()
    {
        await using var server = new OverlayServer(Path.GetTempPath(), _ => null);
        server.Start(0);
        server.Broadcast("nowplaying", "{\"title\":\"Before\"}");
        using var c = new TcpClient();
        await c.ConnectAsync(IPAddress.Loopback, server.Port);
        var s = c.GetStream();
        await s.WriteAsync(Encoding.ASCII.GetBytes($"GET /events HTTP/1.1\r\nHost: 127.0.0.1:{server.Port}\r\n\r\n"));
        var buf = new byte[8192];
        var text = new StringBuilder();
        async Task Until(string needle)
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            while (!text.ToString().Contains(needle))
            {
                var n = await s.ReadAsync(buf, cts.Token);
                if (n == 0) break;
                text.Append(Encoding.UTF8.GetString(buf, 0, n));
            }
        }
        await Until("Before");
        Assert.Contains("text/event-stream", text.ToString());
        Assert.Contains("event: nowplaying\ndata: {\"title\":\"Before\"}", text.ToString());
        for (var i = 0; i < 50 && server.SseClients == 0; i++) await Task.Delay(20);
        server.Broadcast("nowplaying", "{\"title\":\"Żółw\"}");
        await Until("Żółw");
        Assert.Contains("Żółw", text.ToString());
        Assert.Throws<ArgumentException>(() => server.Broadcast("bad\nname", "{}"));
    }
}
