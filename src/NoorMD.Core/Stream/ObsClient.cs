using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NoorMD.Core.Stream;

public sealed record ObsInput(string Name, string Kind);

public sealed class ObsException(string message) : Exception(message);

/// <summary>
/// A small obs-websocket 5.x client (built into OBS 28+): connects, authenticates, reads and sets the mute state of
/// an audio input, and reports mute changes as OBS announces them. Mute is always set explicitly, never toggled, so
/// NoorMD can't drift out of step with OBS. The password is used for the handshake only and never stored here.
/// </summary>
public sealed class ObsClient : IAsyncDisposable
{
    private const int EventInputs = 1 << 3;
    private ClientWebSocket? _ws;
    private CancellationTokenSource? _cts;
    private Task? _reader;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonObject>> _pending = new();
    private readonly SemaphoreSlim _send = new(1, 1);
    private int _nextId;

    /// <summary>Raised from a background thread when OBS reports a mute change: (input name, muted).</summary>
    public event Action<string, bool>? MuteChanged;
    /// <summary>Raised once when the connection ends (OBS closed, network error or Dispose).</summary>
    public event Action<string>? Disconnected;

    public bool Connected => _ws is { State: WebSocketState.Open };
    public string? ObsVersion { get; private set; }

    /// <summary>The obs-websocket authentication string: base64(sha256(base64(sha256(password + salt)) + challenge)).</summary>
    public static string AuthString(string password, string salt, string challenge)
    {
        var secret = Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(password + salt)));
        return Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(secret + challenge)));
    }

    public async Task ConnectAsync(Uri url, string? password, TimeSpan timeout, CancellationToken ct = default)
    {
        if (url.Scheme is not ("ws" or "wss")) throw new ObsException("The OBS address must start with ws://");
        await DisposeAsync();
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
        limit.CancelAfter(timeout);
        var ws = new ClientWebSocket();
        ws.Options.AddSubProtocol("obswebsocket.json");
        try { await ws.ConnectAsync(url, limit.Token); }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or HttpRequestException)
        {
            ws.Dispose();
            throw new ObsException($"OBS is not answering on {url}. Start OBS and turn on Tools › WebSocket Server Settings › Enable WebSocket server.");
        }
        try
        {
            var hello = await ReceiveAsync(ws, limit.Token) ?? throw new ObsException("OBS closed the connection.");
            if ((int?)hello["op"] != 0) throw new ObsException("That address is not an obs-websocket 5 server (OBS 28 or newer).");
            var d = hello["d"] as JsonObject ?? new JsonObject();
            var identify = new JsonObject { ["rpcVersion"] = 1, ["eventSubscriptions"] = EventInputs };
            if (d["authentication"] is JsonObject auth)
            {
                if (string.IsNullOrEmpty(password)) throw new ObsException("OBS asks for a password. Copy it from OBS › Tools › WebSocket Server Settings › Show Connect Info.");
                identify["authentication"] = AuthString(password, (string?)auth["salt"] ?? "", (string?)auth["challenge"] ?? "");
            }
            ObsVersion = (string?)d["obsWebSocketVersion"];
            await SendAsync(ws, new JsonObject { ["op"] = 1, ["d"] = identify }, limit.Token);
            var identified = await ReceiveAsync(ws, limit.Token);
            if (identified == null || (int?)identified["op"] != 2)
            {
                var reason = ws.CloseStatus == (WebSocketCloseStatus)4009 ? "OBS refused the password." : $"OBS refused the connection{(ws.CloseStatusDescription is { Length: > 0 } s ? ": " + s : ".")}";
                throw new ObsException(reason);
            }
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException)
        {
            ws.Dispose();
            throw new ObsException(ws.CloseStatus == (WebSocketCloseStatus)4009 ? "OBS refused the password." : "OBS did not finish the handshake.");
        }
        catch { ws.Dispose(); throw; }
        _ws = ws;
        _cts = new CancellationTokenSource();
        _reader = Task.Run(() => ReadLoopAsync(ws, _cts.Token));
    }

    private async Task ReadLoopAsync(ClientWebSocket ws, CancellationToken ct)
    {
        var why = "OBS closed the connection.";
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var msg = await ReceiveAsync(ws, ct);
                if (msg == null) break;
                var d = msg["d"] as JsonObject;
                switch ((int?)msg["op"])
                {
                    case 7 when d != null && (string?)d["requestId"] is { } id && _pending.TryRemove(id, out var tcs):
                        tcs.TrySetResult(d);
                        break;
                    case 5 when d != null && (string?)d["eventType"] == "InputMuteStateChanged" && d["eventData"] is JsonObject e:
                        MuteChanged?.Invoke((string?)e["inputName"] ?? "", (bool?)e["inputMuted"] ?? false);
                        break;
                }
            }
        }
        catch (OperationCanceledException) { why = "Disconnected."; }
        catch (Exception ex) when (ex is WebSocketException or JsonException) { why = "The connection to OBS was lost."; }
        foreach (var p in _pending) { if (_pending.TryRemove(p.Key, out var t)) t.TrySetException(new ObsException(why)); }
        Disconnected?.Invoke(why);
    }

    public async Task<JsonObject?> RequestAsync(string type, JsonObject? data = null, CancellationToken ct = default)
    {
        var ws = _ws;
        if (ws is not { State: WebSocketState.Open }) throw new ObsException("Not connected to OBS.");
        var id = "n" + Interlocked.Increment(ref _nextId);
        var tcs = new TaskCompletionSource<JsonObject>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[id] = tcs;
        var d = new JsonObject { ["requestType"] = type, ["requestId"] = id };
        if (data != null) d["requestData"] = data;
        try { await SendAsync(ws, new JsonObject { ["op"] = 6, ["d"] = d }, ct); }
        catch (Exception ex) when (ex is WebSocketException or ObjectDisposedException or InvalidOperationException or IOException)
        {
            _pending.TryRemove(id, out _);
            throw new ObsException("The connection to OBS was lost."); // OBS closed in the meantime: one kind of error for callers
        }
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
        limit.CancelAfter(TimeSpan.FromSeconds(5));
        using var reg = limit.Token.Register(() => { if (_pending.TryRemove(id, out var t)) t.TrySetException(new ObsException("OBS did not answer.")); });
        var res = await tcs.Task;
        if (res["requestStatus"] is JsonObject st && (bool?)st["result"] != true)
            throw new ObsException((string?)st["comment"] ?? $"OBS could not do {type}.");
        return res["responseData"] as JsonObject;
    }

    /// <summary>Audio inputs (microphones and other sound sources) that can be muted.</summary>
    public async Task<IReadOnlyList<ObsInput>> AudioInputsAsync(CancellationToken ct = default)
    {
        var data = await RequestAsync("GetInputList", null, ct);
        var list = new List<ObsInput>();
        foreach (var n in data?["inputs"] as JsonArray ?? [])
        {
            if (n is not JsonObject o || (string?)o["inputName"] is not { } name) continue;
            var kind = (string?)o["unversionedInputKind"] ?? (string?)o["inputKind"] ?? "";
            if (IsAudioKind(kind)) list.Add(new ObsInput(name, kind));
        }
        return list;
    }

    /// <summary>Capture and output audio kinds on Windows, macOS and Linux (video sources are left out).</summary>
    public static bool IsAudioKind(string kind) =>
        kind.Contains("audio", StringComparison.OrdinalIgnoreCase) || kind.Contains("wasapi", StringComparison.OrdinalIgnoreCase)
        || kind.Contains("pulse", StringComparison.OrdinalIgnoreCase) || kind.Contains("alsa", StringComparison.OrdinalIgnoreCase)
        || kind.Contains("coreaudio", StringComparison.OrdinalIgnoreCase) || kind.Contains("jack", StringComparison.OrdinalIgnoreCase);

    public async Task<bool> GetMuteAsync(string input, CancellationToken ct = default) =>
        (bool?)(await RequestAsync("GetInputMute", new JsonObject { ["inputName"] = input }, ct))?["inputMuted"] ?? throw new ObsException("OBS did not report the mute state.");

    public Task SetMuteAsync(string input, bool muted, CancellationToken ct = default) =>
        RequestAsync("SetInputMute", new JsonObject { ["inputName"] = input, ["inputMuted"] = muted }, ct);

    private async Task SendAsync(ClientWebSocket ws, JsonObject msg, CancellationToken ct)
    {
        var bytes = Encoding.UTF8.GetBytes(msg.ToJsonString());
        await _send.WaitAsync(ct);
        try { await ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct); }
        finally { _send.Release(); }
    }

    private static async Task<JsonObject?> ReceiveAsync(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[16 * 1024];
        using var ms = new MemoryStream();
        while (true)
        {
            var r = await ws.ReceiveAsync(buffer, ct);
            if (r.MessageType == WebSocketMessageType.Close) return null;
            ms.Write(buffer, 0, r.Count);
            if (ms.Length > 4 * 1024 * 1024) throw new JsonException("Message too large.");
            if (r.EndOfMessage) break;
        }
        return JsonNode.Parse(ms.ToArray()) as JsonObject;
    }

    public async ValueTask DisposeAsync()
    {
        var ws = _ws; _ws = null;
        if (ws == null) return;
        _cts?.Cancel();
        try { if (ws.State == WebSocketState.Open) await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(1)); } catch { /* closing anyway */ }
        if (_reader != null) try { await _reader.WaitAsync(TimeSpan.FromSeconds(2)); } catch { /* ignore */ }
        ws.Dispose();
        _cts?.Dispose(); _cts = null;
    }
}
