using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace NoorMD.Media;

public sealed record RadioStation(long Id, string Name, string Url, string? Homepage, IReadOnlyList<string> Tags, bool Favorite,
    DateTime AddedUtc, DateTime? LastPlayedUtc, int Plays);

/// <summary>A station found in the Radio Browser directory (not saved until you add it).</summary>
public sealed record DirectoryStation(string Name, string Url, string? Homepage, IReadOnlyList<string> Tags, string? Country, string? Codec, int Bitrate, bool Hls);

/// <summary>Station addresses: only http and https, without a user name or password in them.</summary>
public static class RadioUrl
{
    public static string Clean(string? url)
    {
        var u = (url ?? "").Trim();
        if (u.Length == 0) throw new ArgumentException("Give the station's stream address (http:// or https://).");
        if (u.Length > 2048) throw new ArgumentException("That address is too long.");
        if (!Uri.TryCreate(u, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) || string.IsNullOrEmpty(uri.Host))
            throw new ArgumentException("A station address starts with http:// or https://.");
        if (!string.IsNullOrEmpty(uri.UserInfo)) throw new ArgumentException("Addresses with a user name or password in them aren't supported.");
        return uri.AbsoluteUri;
    }

    public static bool TryClean(string? url, out string clean)
    {
        try { clean = Clean(url); return true; } catch (ArgumentException) { clean = ""; return false; }
    }

    /// <summary>Whether the address is a playlist file that points to the stream (.pls, .m3u, .m3u8) rather than the stream.</summary>
    public static bool LooksLikePlaylist(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var u) && System.IO.Path.GetExtension(u.AbsolutePath).ToLowerInvariant() is ".pls" or ".m3u" or ".m3u8";
}

/// <summary>Reading and writing station lists: .pls and .m3u/.m3u8 (HLS playlists are recognised, not read as stations).</summary>
public static class RadioPlaylist
{
    /// <summary>An HLS media playlist (a stream cut into pieces), which NoorMD can't play.</summary>
    public static bool IsHls(string text) => text.Contains("#EXT-X-", StringComparison.Ordinal);

    public static List<(string? Name, string Url)> Parse(string text)
    {
        var list = new List<(string?, string)>();
        var lines = (text ?? "").Replace("\r", "").Split('\n').Select(l => l.Trim()).ToList();
        if (lines.Any(l => l.Equals("[playlist]", StringComparison.OrdinalIgnoreCase)))
        {
            var files = new SortedDictionary<int, string>();
            var titles = new Dictionary<int, string>();
            foreach (var l in lines)
            {
                var eq = l.IndexOf('=');
                if (eq < 0) continue;
                var key = l[..eq].Trim();
                var value = l[(eq + 1)..].Trim();
                if (key.StartsWith("File", StringComparison.OrdinalIgnoreCase) && int.TryParse(key[4..], NumberStyles.None, CultureInfo.InvariantCulture, out var f)) files[f] = value;
                else if (key.StartsWith("Title", StringComparison.OrdinalIgnoreCase) && int.TryParse(key[5..], NumberStyles.None, CultureInfo.InvariantCulture, out var t)) titles[t] = value;
            }
            foreach (var (n, url) in files)
                if (RadioUrl.TryClean(url, out var clean)) list.Add((titles.TryGetValue(n, out var title) && title.Length > 0 ? title : null, clean));
            return list;
        }
        string? name = null;
        foreach (var l in lines)
        {
            if (l.Length == 0) continue;
            if (l.StartsWith("#EXTINF", StringComparison.OrdinalIgnoreCase)) { var comma = l.IndexOf(','); name = comma >= 0 ? l[(comma + 1)..].Trim() : null; continue; }
            if (l.StartsWith('#')) continue;
            if (RadioUrl.TryClean(l, out var clean)) list.Add((string.IsNullOrEmpty(name) ? null : name, clean));
            name = null;
        }
        return list;
    }

    public static string ToM3u(IEnumerable<RadioStation> stations)
    {
        var sb = new StringBuilder("#EXTM3U\n");
        foreach (var s in stations) sb.Append("#EXTINF:-1,").Append(s.Name.Replace('\n', ' ').Replace('\r', ' ')).Append('\n').Append(s.Url).Append('\n');
        return sb.ToString();
    }
}

/// <summary>Your radio stations, in a small local database.</summary>
public sealed class RadioLibrary
{
    private readonly string _cs;

    public RadioLibrary(string databasePath)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(databasePath)!);
        _cs = new SqliteConnectionStringBuilder { DataSource = databasePath, Mode = SqliteOpenMode.ReadWriteCreate, Pooling = true }.ToString();
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS stations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, url_key TEXT NOT NULL UNIQUE, homepage TEXT,
              tags TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0, added TEXT NOT NULL, last_played TEXT, plays INTEGER NOT NULL DEFAULT 0);
            """;
        cmd.ExecuteNonQuery();
    }

    private SqliteConnection Open() { var c = new SqliteConnection(_cs); c.Open(); return c; }
    private static SqliteCommand Cmd(SqliteConnection c, string sql, params (string, object?)[] args)
    {
        var cmd = c.CreateCommand(); cmd.CommandText = sql;
        foreach (var (n, v) in args) cmd.Parameters.AddWithValue(n, v ?? DBNull.Value);
        return cmd;
    }
    private static string Iso(DateTime d) => d.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
    private static DateTime ParseIso(string s) => DateTime.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
    private static string Key(string url) => url.ToLowerInvariant();

    public static string CleanName(string? name, string url)
    {
        var n = new string((name ?? "").Where(ch => !char.IsControl(ch)).ToArray()).Trim();
        if (n.Length == 0) n = Uri.TryCreate(url, UriKind.Absolute, out var u) ? u.Host : "Radio";
        return n.Length > 120 ? n[..120].TrimEnd() : n;
    }

    public static IReadOnlyList<string> CleanTags(IEnumerable<string>? tags) =>
        (tags ?? []).Select(t => new string(t.Where(ch => !char.IsControl(ch) && ch != ',').ToArray()).Trim().TrimStart('#').Trim())
            .Where(t => t.Length > 0).Select(t => t.Length > 40 ? t[..40] : t).DistinctBy(t => t.ToLowerInvariant()).Take(12).ToList();

    private static RadioStation Read(SqliteDataReader r) => new(r.GetInt64(0), r.GetString(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetString(3),
        r.GetString(4).Split('\u001f', StringSplitOptions.RemoveEmptyEntries), r.GetInt64(5) == 1, ParseIso(r.GetString(6)), r.IsDBNull(7) ? null : ParseIso(r.GetString(7)), r.GetInt32(8));

    private const string Cols = "id, name, url, homepage, tags, favorite, added, last_played, plays";

    public IReadOnlyList<RadioStation> All()
    {
        using var c = Open();
        using var cmd = Cmd(c, $"SELECT {Cols} FROM stations ORDER BY lower(name), id");
        using var r = cmd.ExecuteReader();
        var list = new List<RadioStation>();
        while (r.Read()) list.Add(Read(r));
        return list;
    }

    public RadioStation? Get(long id)
    {
        using var c = Open();
        using var cmd = Cmd(c, $"SELECT {Cols} FROM stations WHERE id = $id", ("$id", id));
        using var r = cmd.ExecuteReader();
        return r.Read() ? Read(r) : null;
    }

    /// <summary>Adds a station; a station with the same address is kept as it is. Returns its id and whether it was new.</summary>
    public (long Id, bool Added) Add(string? name, string url, string? homepage = null, IEnumerable<string>? tags = null)
    {
        var u = RadioUrl.Clean(url);
        using var c = Open();
        using (var find = Cmd(c, "SELECT id FROM stations WHERE url_key = $k", ("$k", Key(u))))
            if (find.ExecuteScalar() is long existing) return (existing, false);
        var home = homepage != null && RadioUrl.TryClean(homepage, out var h) ? h : null;
        using var ins = Cmd(c, "INSERT INTO stations(name, url, url_key, homepage, tags, added) VALUES ($n, $u, $k, $h, $t, $a) RETURNING id",
            ("$n", CleanName(name, u)), ("$u", u), ("$k", Key(u)), ("$h", home), ("$t", string.Join('\u001f', CleanTags(tags))), ("$a", Iso(DateTime.UtcNow)));
        return ((long)ins.ExecuteScalar()!, true);
    }

    public void Update(long id, string? name, string url, string? homepage, IEnumerable<string>? tags)
    {
        var u = RadioUrl.Clean(url);
        using var c = Open();
        using (var find = Cmd(c, "SELECT id FROM stations WHERE url_key = $k AND id <> $id", ("$k", Key(u)), ("$id", id)))
            if (find.ExecuteScalar() is long) throw new ArgumentException("Another station already has that address.");
        var home = homepage != null && RadioUrl.TryClean(homepage, out var h) ? h : null;
        using var up = Cmd(c, "UPDATE stations SET name = $n, url = $u, url_key = $k, homepage = $h, tags = $t WHERE id = $id",
            ("$n", CleanName(name, u)), ("$u", u), ("$k", Key(u)), ("$h", home), ("$t", string.Join('\u001f', CleanTags(tags))), ("$id", id));
        if (up.ExecuteNonQuery() == 0) throw new ArgumentException("That station is gone.");
    }

    public void Delete(long id)
    {
        using var c = Open();
        using var cmd = Cmd(c, "DELETE FROM stations WHERE id = $id", ("$id", id));
        cmd.ExecuteNonQuery();
    }

    public void SetFavorite(long id, bool on)
    {
        using var c = Open();
        using var cmd = Cmd(c, "UPDATE stations SET favorite = $f WHERE id = $id", ("$f", on ? 1 : 0), ("$id", id));
        cmd.ExecuteNonQuery();
    }

    public void MarkPlayed(long id)
    {
        using var c = Open();
        using var cmd = Cmd(c, "UPDATE stations SET plays = plays + 1, last_played = $t WHERE id = $id", ("$t", Iso(DateTime.UtcNow)), ("$id", id));
        cmd.ExecuteNonQuery();
    }

    /// <summary>Adds the stations of a .pls/.m3u text. Returns how many were new and how many were already there.</summary>
    public (int Added, int Known) Import(string playlistText)
    {
        if (RadioPlaylist.IsHls(playlistText)) throw new ArgumentException("This is a stream playlist (HLS), not a list of stations.");
        var entries = RadioPlaylist.Parse(playlistText);
        if (entries.Count == 0) throw new ArgumentException("No station addresses (http:// or https://) were found in that file.");
        var added = 0; var known = 0;
        foreach (var (name, url) in entries.Take(2000)) { if (Add(name, url).Added) added++; else known++; }
        return (added, known);
    }
}

/// <summary>
/// Reads Shoutcast/Icecast ("ICY") streams: the sound comes in blocks of <c>icy-metaint</c> bytes, each followed by a
/// length byte (×16) and that much metadata ("StreamTitle='Artist - Song';"). The sound is passed on, the titles reported.
/// </summary>
public sealed class IcyReader
{
    private readonly int _metaInt;
    private int _untilMeta;
    private int _state; // 0 sound, 1 length byte, 2 metadata
    private byte[] _meta = [];
    private int _metaGot;

    public IcyReader(int metaInt) { _metaInt = metaInt; _untilMeta = metaInt; }

    /// <summary>Passes the sound in <paramref name="data"/> to <paramref name="sound"/> and each title in it to <paramref name="title"/>.</summary>
    public void Feed(ReadOnlySpan<byte> data, Stream sound, Action<string> title)
    {
        if (_metaInt <= 0) { sound.Write(data); return; }
        var i = 0;
        while (i < data.Length)
        {
            switch (_state)
            {
                case 0:
                {
                    var n = Math.Min(_untilMeta, data.Length - i);
                    sound.Write(data.Slice(i, n));
                    i += n; _untilMeta -= n;
                    if (_untilMeta == 0) _state = 1;
                    break;
                }
                case 1:
                {
                    var len = data[i++] * 16;
                    if (len == 0) { _untilMeta = _metaInt; _state = 0; }
                    else { _meta = new byte[len]; _metaGot = 0; _state = 2; }
                    break;
                }
                default:
                {
                    var n = Math.Min(_meta.Length - _metaGot, data.Length - i);
                    data.Slice(i, n).CopyTo(_meta.AsSpan(_metaGot));
                    i += n; _metaGot += n;
                    if (_metaGot == _meta.Length)
                    {
                        if (ParseTitle(_meta) is { } t) title(t);
                        _untilMeta = _metaInt; _state = 0;
                    }
                    break;
                }
            }
        }
    }

    /// <summary>The StreamTitle in a metadata block (UTF-8, or Latin-1 when it isn't valid UTF-8); null when there is none.</summary>
    public static string? ParseTitle(byte[] meta)
    {
        var end = Array.IndexOf(meta, (byte)0);
        var bytes = end >= 0 ? meta.AsSpan(0, end) : meta.AsSpan();
        string text;
        try { text = new UTF8Encoding(false, true).GetString(bytes); }
        catch (DecoderFallbackException) { text = Encoding.Latin1.GetString(bytes); }
        const string key = "StreamTitle='";
        var start = text.IndexOf(key, StringComparison.Ordinal);
        if (start < 0) return null;
        start += key.Length;
        var stop = text.IndexOf("';", start, StringComparison.Ordinal);
        if (stop < 0) stop = text.LastIndexOf('\'');
        if (stop < start) return null;
        var title = new string(text[start..stop].Where(ch => !char.IsControl(ch)).ToArray()).Trim();
        return title.Length > 300 ? title[..300] : title;
    }
}

/// <summary>
/// Passes a radio stream to the page through the loopback address, reading the song titles on the way (browsers don't
/// show ICY metadata, and the page may only play from itself or this address). It listens on 127.0.0.1 only, refuses
/// other Host headers (DNS rebinding), and forwards only the stations the app opened, by a random one-time path.
/// </summary>
public sealed class RadioRelay : IAsyncDisposable
{
    private const int MaxRequestBytes = 16 * 1024;
    private readonly HttpClient _http;
    private TcpListener? _listener;
    private CancellationTokenSource? _cts;
    private readonly ConcurrentDictionary<string, Session> _sessions = new();

    private sealed record Session(Uri Upstream, CancellationTokenSource Cts);

    /// <summary>(token, title): a new song title from the stream.</summary>
    public event Action<string, string>? Title;
    /// <summary>(token, message): the station could not be reached or stopped sending.</summary>
    public event Action<string, string>? Failed;

    public RadioRelay(HttpClient? http = null)
    {
        _http = http ?? new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = true, MaxAutomaticRedirections = 5, ConnectTimeout = TimeSpan.FromSeconds(10) }) { Timeout = Timeout.InfiniteTimeSpan };
        if (!_http.DefaultRequestHeaders.UserAgent.Any()) _http.DefaultRequestHeaders.UserAgent.ParseAdd("NoorMD/2.0");
    }

    public int Port { get; private set; }

    private void EnsureStarted()
    {
        if (_listener != null) return;
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        _listener = l;
        Port = ((IPEndPoint)l.LocalEndpoint).Port;
        _cts = new CancellationTokenSource();
        _ = Task.Run(() => AcceptLoop(l, _cts.Token));
    }

    /// <summary>Opens a station (closing the one before: one stream at a time). Returns the token and the address the page plays.</summary>
    public (string Token, string Url) Open(string stationUrl)
    {
        var upstream = new Uri(RadioUrl.Clean(stationUrl));
        EnsureStarted();
        CloseAll();
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        _sessions[token] = new Session(upstream, new CancellationTokenSource());
        return (token, $"http://127.0.0.1:{Port}/radio/{token}");
    }

    /// <summary>Stops every stream.</summary>
    public void CloseAll()
    {
        foreach (var (k, s) in _sessions) { if (_sessions.TryRemove(k, out _)) { try { s.Cts.Cancel(); } catch (ObjectDisposedException) { } s.Cts.Dispose(); } }
    }

    private async Task AcceptLoop(TcpListener l, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await l.AcceptTcpClientAsync(ct); }
            catch (Exception) when (ct.IsCancellationRequested) { return; }
            catch (SocketException) { continue; }
            catch (ObjectDisposedException) { return; }
            _ = Task.Run(() => Serve(client, ct), ct);
        }
    }

    private async Task Serve(TcpClient client, CancellationToken appCt)
    {
        using var _ = client;
        client.NoDelay = true;
        var net = client.GetStream();
        try
        {
            var (method, path, host) = await ReadRequest(net, appCt);
            if (method is not ("GET" or "HEAD") || path == null) { await Status(net, "405 Method Not Allowed"); return; }
            if (host != $"127.0.0.1:{Port}" && host != $"localhost:{Port}") { await Status(net, "403 Forbidden"); return; }
            var token = path.StartsWith("/radio/", StringComparison.Ordinal) ? path[7..] : "";
            if (!_sessions.TryGetValue(token, out var session)) { await Status(net, "404 Not Found"); return; }
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(appCt, session.Cts.Token);
            var ct = linked.Token;
            using var req = new HttpRequestMessage(HttpMethod.Get, session.Upstream);
            req.Headers.TryAddWithoutValidation("Icy-MetaData", "1");
            HttpResponseMessage resp;
            try { resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct); }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                Failed?.Invoke(token, "The station can't be reached: " + ex.Message);
                await Status(net, "502 Bad Gateway");
                return;
            }
            using (resp)
            {
                var type = resp.Content.Headers.ContentType?.MediaType ?? "audio/mpeg";
                if (!resp.IsSuccessStatusCode || type.StartsWith("text/html", StringComparison.OrdinalIgnoreCase))
                {
                    Failed?.Invoke(token, resp.IsSuccessStatusCode ? "That address is a web page, not a stream." : $"The station answered {(int)resp.StatusCode} {resp.ReasonPhrase}.");
                    await Status(net, "502 Bad Gateway");
                    return;
                }
                var metaInt = resp.Headers.TryGetValues("icy-metaint", out var mi) && int.TryParse(mi.FirstOrDefault(), NumberStyles.None, CultureInfo.InvariantCulture, out var m) && m is > 0 and < 1_000_000 ? m : 0;
                if (type.Contains("mpegurl", StringComparison.OrdinalIgnoreCase) || session.Upstream.AbsolutePath.EndsWith(".m3u8", StringComparison.OrdinalIgnoreCase))
                {
                    // HLS: a playlist of pieces, unpacked here into one stream.
                    await using var body = await resp.Content.ReadAsStreamAsync(ct);
                    var text = await ReadText(body, 2 * 1024 * 1024, ct);
                    if (!RadioPlaylist.IsHls(text))
                    {
                        Failed?.Invoke(token, "That address is a playlist, not a stream: add the station by its playlist and NoorMD finds the stream in it.");
                        await Status(net, "502 Bad Gateway");
                        return;
                    }
                    await ServeHls(net, method, token, resp.RequestMessage?.RequestUri ?? session.Upstream, text, ct);
                    return;
                }
                var head = $"HTTP/1.1 200 OK\r\nContent-Type: {type}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n";
                await net.WriteAsync(Encoding.ASCII.GetBytes(head), ct);
                if (method == "HEAD") return;
                var icy = new IcyReader(metaInt);
                await using var upstream = await resp.Content.ReadAsStreamAsync(ct);
                var buf = new byte[16 * 1024];
                using var sound = new MemoryStream();
                string? last = null;
                while (!ct.IsCancellationRequested)
                {
                    var n = await upstream.ReadAsync(buf, ct);
                    if (n == 0) { Failed?.Invoke(token, "The station stopped sending."); return; }
                    sound.SetLength(0);
                    icy.Feed(buf.AsSpan(0, n), sound, t => { if (t != last) { last = t; Title?.Invoke(token, t); } });
                    if (sound.Length > 0) await net.WriteAsync(sound.GetBuffer().AsMemory(0, (int)sound.Length), ct);
                }
            }
        }
        catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException or ObjectDisposedException or HttpRequestException)
        {
            // The page stopped listening, the station was closed, or the connection broke.
        }
    }

    /// <summary>An HLS station: the answer's type is known from its first piece, then every piece follows as sound.</summary>
    private async Task ServeHls(NetworkStream net, string method, string token, Uri playlist, string text, CancellationToken ct)
    {
        var started = false;
        string? last = null;
        async Task Write(string type, ReadOnlyMemory<byte> data)
        {
            if (!started)
            {
                started = true;
                var head = $"HTTP/1.1 200 OK\r\nContent-Type: {type}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n";
                await net.WriteAsync(Encoding.ASCII.GetBytes(head), ct);
                if (method == "HEAD") throw new OperationCanceledException();
            }
            await net.WriteAsync(data, ct);
        }
        try
        {
            await new HlsReader(_http).RunAsync(playlist, text, Write, t => { if (t != last) { last = t; Title?.Invoke(token, t); } }, ct);
            if (!ct.IsCancellationRequested) Failed?.Invoke(token, "The station stopped sending.");
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            Failed?.Invoke(token, ex is InvalidOperationException ? ex.Message : "The station can't be reached: " + ex.Message);
            if (!started) await Status(net, "502 Bad Gateway");
        }
    }

    private static async Task<string> ReadText(Stream s, int max, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        var buf = new byte[16 * 1024];
        int n;
        while (ms.Length < max && (n = await s.ReadAsync(buf, ct)) > 0) ms.Write(buf, 0, n);
        return Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)Math.Min(ms.Length, max));
    }

    private static async Task<(string? Method, string? Path, string? Host)> ReadRequest(NetworkStream net, CancellationToken ct)
    {
        var buf = new byte[MaxRequestBytes];
        var len = 0;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        while (len < buf.Length)
        {
            var n = await net.ReadAsync(buf.AsMemory(len), timeout.Token);
            if (n == 0) break;
            len += n;
            if (buf.AsSpan(0, len).IndexOf("\r\n\r\n"u8) >= 0) break;
        }
        var text = Encoding.ASCII.GetString(buf, 0, len);
        var lines = text.Split("\r\n");
        var first = lines[0].Split(' ');
        if (first.Length < 3) return (null, null, null);
        var host = lines.Skip(1).Select(l => l.Split(':', 2)).Where(p => p.Length == 2 && p[0].Trim().Equals("Host", StringComparison.OrdinalIgnoreCase)).Select(p => p[1].Trim()).FirstOrDefault();
        var path = first[1];
        var q = path.IndexOf('?');
        if (q >= 0) path = path[..q];
        return (first[0], path, host);
    }

    private static async Task Status(NetworkStream net, string status)
    {
        var bytes = Encoding.ASCII.GetBytes($"HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        try { await net.WriteAsync(bytes); } catch (IOException) { }
    }

    public async ValueTask DisposeAsync()
    {
        CloseAll();
        if (_cts != null) { await _cts.CancelAsync(); _cts.Dispose(); }
        _listener?.Stop();
        _listener = null;
    }
}

/// <summary>
/// The Radio Browser directory (radio-browser.info): a free, community-run list of stations. NoorMD asks it only when
/// you search, and sends only what you typed.
/// </summary>
public static class RadioDirectory
{
    private static readonly string[] Servers = ["de1.api.radio-browser.info", "de2.api.radio-browser.info", "fi1.api.radio-browser.info", "at1.api.radio-browser.info", "nl1.api.radio-browser.info"];

    public static async Task<IReadOnlyList<DirectoryStation>> SearchAsync(HttpClient http, string query, CancellationToken ct = default)
    {
        var q = (query ?? "").Trim();
        if (q.Length < 2) throw new ArgumentException("Type at least two letters to search.");
        if (q.Length > 100) q = q[..100];
        Exception? last = null;
        foreach (var server in Servers.OrderBy(_ => Random.Shared.Next()))
        {
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(8));
                var url = $"https://{server}/json/stations/search?name={Uri.EscapeDataString(q)}&limit=60&hidebroken=true&order=clickcount&reverse=true";
                using var resp = await http.GetAsync(url, timeout.Token);
                resp.EnsureSuccessStatusCode();
                var json = await resp.Content.ReadAsStringAsync(timeout.Token);
                return Parse(json);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException && !ct.IsCancellationRequested) { last = ex; }
        }
        throw new InvalidOperationException("The Radio Browser directory can't be reached right now. " + last?.Message);
    }

    public static IReadOnlyList<DirectoryStation> Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var list = new List<DirectoryStation>();
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return list;
        foreach (var e in doc.RootElement.EnumerateArray())
        {
            string? Str(string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && v.GetString() is { Length: > 0 } s ? s.Trim() : null;
            var url = Str("url_resolved") ?? Str("url");
            if (url == null || !RadioUrl.TryClean(url, out var clean)) continue;
            var name = Str("name") ?? clean;
            var hls = e.TryGetProperty("hls", out var h) && h.ValueKind == JsonValueKind.Number && h.GetInt32() == 1;
            var bitrate = e.TryGetProperty("bitrate", out var b) && b.ValueKind == JsonValueKind.Number ? b.GetInt32() : 0;
            var tags = (Str("tags") ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(8).ToList();
            var home = Str("homepage");
            list.Add(new DirectoryStation(RadioLibrary.CleanName(name, clean), clean, home != null && RadioUrl.TryClean(home, out var hc) ? hc : null, tags, Str("countrycode") ?? Str("country"), Str("codec"), bitrate, hls));
        }
        return list.DistinctBy(s => s.Url.ToLowerInvariant()).ToList();
    }
}
