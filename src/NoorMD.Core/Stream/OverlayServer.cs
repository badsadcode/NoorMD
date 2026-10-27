using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace NoorMD.Core.Stream;

/// <summary>
/// A tiny read-only web server for OBS Browser Sources (Now Playing, credits roll). It listens on the loopback address
/// only, answers GET/HEAD, serves a fixed set of overlay files, and pushes live updates over Server-Sent Events.
/// Requests whose Host header isn't the loopback address are refused (protection against DNS rebinding), so a web
/// page in a normal browser can't read it through a rogue domain either. It never accepts commands.
/// </summary>
public sealed class OverlayServer : IAsyncDisposable
{
    public const int DefaultPort = 47321;
    private const int MaxClients = 32;
    private const int MaxRequestBytes = 16 * 1024;

    private static readonly Dictionary<string, string> Types = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8", [".js"] = "text/javascript; charset=utf-8", [".css"] = "text/css; charset=utf-8",
        [".png"] = "image/png", [".svg"] = "image/svg+xml", [".woff2"] = "font/woff2", [".json"] = "application/json; charset=utf-8",
    };

    private readonly string _root;
    private readonly Func<string, (byte[] Body, string Type)?> _dynamic;
    private TcpListener? _listener;
    private CancellationTokenSource? _cts;
    private Task? _loop;
    private readonly ConcurrentDictionary<int, SseClient> _sse = new();
    private readonly ConcurrentDictionary<string, string> _lastEvents = new();
    private int _clients;
    private int _nextId;

    public int Port { get; private set; }
    public bool Running => _listener != null;
    public int SseClients => _sse.Count;

    /// <param name="root">Folder with the overlay pages (wwwroot/overlay); only files directly in it are served.</param>
    /// <param name="dynamic">Answers dynamic paths ("/state.json", "/art") or returns null for 404.</param>
    public OverlayServer(string root, Func<string, (byte[] Body, string Type)?> dynamic)
    {
        _root = Path.GetFullPath(root);
        _dynamic = dynamic;
    }

    public string BaseUrl => $"http://127.0.0.1:{Port}/";

    /// <summary>Starts on the given port (0 picks a free one). Throws SocketException when the port is taken.</summary>
    public void Start(int port)
    {
        if (_listener != null) return;
        var l = new TcpListener(IPAddress.Loopback, port);
        l.Start();
        _listener = l;
        Port = ((IPEndPoint)l.LocalEndpoint).Port;
        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => AcceptLoop(l, _cts.Token));
    }

    public async Task StopAsync()
    {
        var l = _listener;
        if (l == null) return;
        _listener = null;
        _cts?.Cancel();
        try { l.Stop(); } catch { }
        foreach (var c in _sse.Values) c.Close();
        _sse.Clear();
        if (_loop != null) try { await _loop.ConfigureAwait(false); } catch { }
    }

    public async ValueTask DisposeAsync() => await StopAsync().ConfigureAwait(false);

    /// <summary>Sends an event to every connected overlay. The last event of each name is replayed to new connections.</summary>
    public void Broadcast(string eventName, string json)
    {
        if (eventName.Any(c => c is '\n' or '\r')) throw new ArgumentException("Invalid event name.");
        _lastEvents[eventName] = json;
        var frame = Encoding.UTF8.GetBytes(Frame(eventName, json));
        foreach (var (id, c) in _sse)
            if (!c.TrySend(frame)) { _sse.TryRemove(id, out _); c.Close(); }
    }

    /// <summary>Forgets the replay value of an event (e.g. "credits.start" must not restart credits on reconnect).</summary>
    public void ForgetEvent(string eventName) => _lastEvents.TryRemove(eventName, out _);

    private static string Frame(string name, string json) =>
        $"event: {name}\ndata: {json.Replace("\r", "").Replace("\n", "\ndata: ")}\n\n";

    private async Task AcceptLoop(TcpListener l, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await l.AcceptTcpClientAsync(ct).ConfigureAwait(false); }
            catch (Exception) when (ct.IsCancellationRequested) { break; }
            catch (SocketException) { continue; }
            catch (ObjectDisposedException) { break; }
            if (Interlocked.Increment(ref _clients) > MaxClients) { Interlocked.Decrement(ref _clients); client.Dispose(); continue; }
            _ = Task.Run(async () =>
            {
                try { await Handle(client, ct).ConfigureAwait(false); }
                catch (Exception) { /* a client went away mid-request */ }
                finally { Interlocked.Decrement(ref _clients); }
            }, CancellationToken.None);
        }
    }

    private async Task Handle(TcpClient client, CancellationToken ct)
    {
        using var _ = client;
        client.NoDelay = true;
        var stream = client.GetStream();
        stream.ReadTimeout = 5000;
        var head = await ReadHead(stream, ct).ConfigureAwait(false);
        if (head == null) return;
        var lines = head.Split("\r\n");
        var parts = lines[0].Split(' ');
        if (parts.Length != 3 || !parts[2].StartsWith("HTTP/1.", StringComparison.Ordinal)) { await Respond(stream, 400, "Bad Request", "text/plain", "Bad request"u8.ToArray(), false).ConfigureAwait(false); return; }
        var method = parts[0];
        var host = lines.Skip(1).Select(x => x.Split(':', 2)).Where(x => x.Length == 2 && x[0].Trim().Equals("Host", StringComparison.OrdinalIgnoreCase)).Select(x => x[1].Trim()).FirstOrDefault();
        if (!IsLoopbackHost(host, Port)) { await Respond(stream, 421, "Misdirected Request", "text/plain", "NoorMD overlays answer only on 127.0.0.1 / localhost."u8.ToArray(), false).ConfigureAwait(false); return; }
        if (method is not ("GET" or "HEAD")) { await Respond(stream, 405, "Method Not Allowed", "text/plain", "Read only."u8.ToArray(), false, "Allow: GET, HEAD").ConfigureAwait(false); return; }
        var target = parts[1];
        var path = Uri.UnescapeDataString(target.Split('?', 2)[0]);
        if (path == "/events")
        {
            await ServeEvents(client, stream, ct).ConfigureAwait(false);
            return;
        }
        var head_only = method == "HEAD";
        if (path == "/" ) path = "/index.html";
        if (_dynamic(path) is { } dyn) { await Respond(stream, 200, "OK", dyn.Type, dyn.Body, head_only).ConfigureAwait(false); return; }
        var name = path.TrimStart('/');
        if (name.Length == 0 || name.Contains('/') || name.Contains('\\') || name.Contains("..") || !Types.TryGetValue(Path.GetExtension(name), out var type))
        { await Respond(stream, 404, "Not Found", "text/plain", "Not found"u8.ToArray(), head_only).ConfigureAwait(false); return; }
        var file = Path.Combine(_root, name);
        if (!File.Exists(file) || !Path.GetFullPath(file).StartsWith(_root, StringComparison.OrdinalIgnoreCase))
        { await Respond(stream, 404, "Not Found", "text/plain", "Not found"u8.ToArray(), head_only).ConfigureAwait(false); return; }
        await Respond(stream, 200, "OK", type, await File.ReadAllBytesAsync(file, ct).ConfigureAwait(false), head_only).ConfigureAwait(false);
    }

    public static bool IsLoopbackHost(string? host, int port)
    {
        if (string.IsNullOrEmpty(host)) return false;
        var p = port.ToString(CultureInfo.InvariantCulture);
        return host == "127.0.0.1:" + p || host.Equals("localhost:" + p, StringComparison.OrdinalIgnoreCase) || host == "[::1]:" + p;
    }

    private static async Task<string?> ReadHead(NetworkStream s, CancellationToken ct)
    {
        var buf = new byte[MaxRequestBytes];
        var n = 0;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(5000);
        while (n < buf.Length)
        {
            int r;
            try { r = await s.ReadAsync(buf.AsMemory(n), timeout.Token).ConfigureAwait(false); }
            catch (OperationCanceledException) { return null; }
            if (r == 0) return null;
            n += r;
            var text = Encoding.ASCII.GetString(buf, 0, n);
            var end = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (end >= 0) return text[..end];
        }
        return null;
    }

    private static readonly string Security =
        "X-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n" +
        "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\r\n";

    private static async Task Respond(NetworkStream s, int status, string reason, string type, byte[] body, bool headOnly, string? extra = null)
    {
        var head = $"HTTP/1.1 {status} {reason}\r\nContent-Type: {type}\r\nContent-Length: {body.Length}\r\n{Security}{(extra != null ? extra + "\r\n" : "")}Connection: close\r\n\r\n";
        await s.WriteAsync(Encoding.ASCII.GetBytes(head)).ConfigureAwait(false);
        if (!headOnly && body.Length > 0) await s.WriteAsync(body).ConfigureAwait(false);
        await s.FlushAsync().ConfigureAwait(false);
    }

    private async Task ServeEvents(TcpClient client, NetworkStream s, CancellationToken ct)
    {
        var head = $"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\n{Security}Connection: keep-alive\r\n\r\nretry: 2000\n\n";
        await s.WriteAsync(Encoding.ASCII.GetBytes(head), ct).ConfigureAwait(false);
        var c = new SseClient(s);
        var id = Interlocked.Increment(ref _nextId);
        foreach (var (name, json) in _lastEvents) c.TrySend(Encoding.UTF8.GetBytes(Frame(name, json)));
        _sse[id] = c;
        try
        {
            while (!ct.IsCancellationRequested && client.Connected && !c.Closed)
            {
                await Task.Delay(15_000, ct).ConfigureAwait(false);
                if (!c.TrySend(": keep-alive\n\n"u8.ToArray())) break;
            }
        }
        catch (OperationCanceledException) { }
        finally { _sse.TryRemove(id, out _); c.Close(); }
    }

    /// <summary>
    /// One overlay connection. Sending only queues the frame; a background writer sends it with a time limit. A client
    /// that stops reading (a hung OBS source) falls behind and is dropped, and nobody ever waits on its socket.
    /// </summary>
    private sealed class SseClient
    {
        private readonly NetworkStream _stream;
        private readonly System.Threading.Channels.Channel<byte[]> _queue =
            System.Threading.Channels.Channel.CreateBounded<byte[]>(new System.Threading.Channels.BoundedChannelOptions(64) { FullMode = System.Threading.Channels.BoundedChannelFullMode.DropWrite, SingleReader = true });
        private volatile bool _closed;

        public SseClient(NetworkStream stream)
        {
            _stream = stream;
            _stream.WriteTimeout = 5000;
            _ = Task.Run(WriteLoop);
        }

        public bool Closed => _closed;

        public bool TrySend(byte[] frame)
        {
            if (_closed) return false;
            if (_queue.Reader.Count >= 64) { Close(); return false; } // 64 frames behind: it isn't reading
            return _queue.Writer.TryWrite(frame);
        }

        private async Task WriteLoop()
        {
            try
            {
                await foreach (var frame in _queue.Reader.ReadAllAsync().ConfigureAwait(false))
                {
                    using var cts = new CancellationTokenSource(5000);
                    await _stream.WriteAsync(frame, cts.Token).ConfigureAwait(false);
                    await _stream.FlushAsync(cts.Token).ConfigureAwait(false);
                }
            }
            catch (Exception) { Close(); }
        }

        public void Close()
        {
            if (_closed) return;
            _closed = true;
            _queue.Writer.TryComplete();
            try { _stream.Close(); } catch { }
        }
    }
}
