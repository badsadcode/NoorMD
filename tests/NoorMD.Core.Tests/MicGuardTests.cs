using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using NoorMD.Core.Stream;
using Xunit;

namespace NoorMD.Core.Tests;

public class MicGuardTests
{
    [Theory]
    [InlineData(MicSide.Off, MicSide.Off, MicVerdict.NotSetUp)]
    [InlineData(MicSide.Live, MicSide.Off, MicVerdict.Live)]
    [InlineData(MicSide.Off, MicSide.Muted, MicVerdict.Muted)]
    [InlineData(MicSide.Live, MicSide.Live, MicVerdict.Live)]
    [InlineData(MicSide.Muted, MicSide.Muted, MicVerdict.Muted)]
    [InlineData(MicSide.Muted, MicSide.Live, MicVerdict.Mismatch)]
    [InlineData(MicSide.Live, MicSide.Muted, MicVerdict.Mismatch)]
    [InlineData(MicSide.Unknown, MicSide.Muted, MicVerdict.Unknown)]
    [InlineData(MicSide.Unknown, MicSide.Live, MicVerdict.Live)]
    public void Verdict_Combines_The_Sides_That_Are_Used(MicSide windows, MicSide obs, MicVerdict expected) =>
        Assert.Equal(expected, MicGuard.Verdict(windows, obs));

    [Fact]
    public void The_Hotkey_Mutes_Everything_Unless_Everything_Is_Already_Muted()
    {
        Assert.True(MicGuard.ToggleTarget(MicSide.Live, MicSide.Live));
        Assert.True(MicGuard.ToggleTarget(MicSide.Muted, MicSide.Live));   // out of step → mute both, never "swap" them
        Assert.True(MicGuard.ToggleTarget(MicSide.Live, MicSide.Muted));
        Assert.True(MicGuard.ToggleTarget(MicSide.Unknown, MicSide.Muted)); // unsure → the safe side
        Assert.False(MicGuard.ToggleTarget(MicSide.Muted, MicSide.Muted));
        Assert.False(MicGuard.ToggleTarget(MicSide.Muted, MicSide.Off));
        Assert.Contains("Windows mic muted, OBS live", MicGuard.Explain(MicVerdict.Mismatch, MicSide.Muted, MicSide.Live));
    }

    [Fact]
    public void Auth_String_Matches_The_Protocol_Example()
    {
        // obs-websocket 5 protocol documentation: password "supersecretpassword".
        Assert.Equal("1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=",
            ObsClient.AuthString("supersecretpassword", "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=", "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY="));
    }

    [Fact]
    public async Task Connects_With_A_Password_Lists_Audio_Inputs_And_Sets_Mute_Explicitly()
    {
        await using var obs = new FakeObs("hunter2");
        await using var client = new ObsClient();
        var changes = new List<(string, bool)>();
        client.MuteChanged += (n, m) => { lock (changes) changes.Add((n, m)); };
        await client.ConnectAsync(obs.Url, "hunter2", TimeSpan.FromSeconds(5));
        Assert.True(client.Connected);
        Assert.Equal("5.5.0", client.ObsVersion);

        var inputs = await client.AudioInputsAsync();
        Assert.Equal(["Mic/Aux", "Desktop Audio"], inputs.Select(i => i.Name));
        Assert.False(await client.GetMuteAsync("Mic/Aux"));
        await client.SetMuteAsync("Mic/Aux", true);
        await client.SetMuteAsync("Mic/Aux", true); // explicit: setting twice keeps it muted
        Assert.True(await client.GetMuteAsync("Mic/Aux"));
        Assert.Equal([("SetInputMute", "Mic/Aux", true), ("SetInputMute", "Mic/Aux", true)], obs.Sets);

        // OBS announces changes made in OBS itself.
        await obs.PushMuteAsync("Mic/Aux", false);
        for (var i = 0; i < 50 && changes.Count == 0; i++) await Task.Delay(20);
        lock (changes) Assert.Equal([("Mic/Aux", false)], changes);

        var ex = await Assert.ThrowsAsync<ObsException>(() => client.GetMuteAsync("Nope"));
        Assert.Contains("No source", ex.Message);
    }

    [Fact]
    public async Task Wrong_Or_Missing_Password_And_No_Server_Are_Explained()
    {
        await using var obs = new FakeObs("hunter2");
        await using var client = new ObsClient();
        var wrong = await Assert.ThrowsAsync<ObsException>(() => client.ConnectAsync(obs.Url, "nope", TimeSpan.FromSeconds(5)));
        Assert.Contains("password", wrong.Message);
        var missing = await Assert.ThrowsAsync<ObsException>(() => client.ConnectAsync(obs.Url, null, TimeSpan.FromSeconds(5)));
        Assert.Contains("asks for a password", missing.Message);
        Assert.False(client.Connected);

        var free = FreePort();
        var none = await Assert.ThrowsAsync<ObsException>(() => client.ConnectAsync(new Uri($"ws://127.0.0.1:{free}/"), null, TimeSpan.FromSeconds(3)));
        Assert.Contains("not answering", none.Message);
        await Assert.ThrowsAsync<ObsException>(() => client.ConnectAsync(new Uri("http://127.0.0.1/"), null, TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public async Task A_Lost_Connection_Is_Reported()
    {
        await using var obs = new FakeObs(null);
        await using var client = new ObsClient();
        var lost = new TaskCompletionSource<string>();
        client.Disconnected += (why) => lost.TrySetResult(why);
        await client.ConnectAsync(obs.Url, null, TimeSpan.FromSeconds(5));
        await obs.DisposeAsync();
        var why = await lost.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(client.Connected);
        Assert.Contains("OBS", why);
        await Assert.ThrowsAsync<ObsException>(() => client.GetMuteAsync("Mic/Aux"));
    }

    private static int FreePort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    /// <summary>Just enough of obs-websocket 5 for the tests: hello/identify with auth, inputs, mute, events.</summary>
    private sealed class FakeObs : IAsyncDisposable
    {
        private readonly HttpListener _http = new();
        private readonly string? _password;
        private readonly CancellationTokenSource _cts = new();
        private readonly Dictionary<string, bool> _mute = new() { ["Mic/Aux"] = false, ["Desktop Audio"] = false };
        private WebSocket? _ws;
        private readonly Task _loop;
        public List<(string, string, bool)> Sets { get; } = [];
        public Uri Url { get; }

        public FakeObs(string? password)
        {
            _password = password;
            var port = FreePort();
            _http.Prefixes.Add($"http://127.0.0.1:{port}/");
            _http.Start();
            Url = new Uri($"ws://127.0.0.1:{port}/");
            _loop = Task.Run(AcceptLoop);
        }

        private async Task AcceptLoop()
        {
            while (!_cts.IsCancellationRequested)
            {
                HttpListenerContext ctx;
                try { ctx = await _http.GetContextAsync(); } catch { return; }
                _ = Task.Run(() => Serve(ctx));
            }
        }

        private async Task Serve(HttpListenerContext ctx)
        {
            var wsc = await ctx.AcceptWebSocketAsync("obswebsocket.json");
            var ws = wsc.WebSocket;
            _ws = ws;
            const string salt = "c2FsdA==", challenge = "Y2hhbGxlbmdl";
            var hello = new JsonObject { ["obsWebSocketVersion"] = "5.5.0", ["rpcVersion"] = 1 };
            if (_password != null) hello["authentication"] = new JsonObject { ["salt"] = salt, ["challenge"] = challenge };
            await Send(ws, new JsonObject { ["op"] = 0, ["d"] = hello });
            try
            {
                while (ws.State == WebSocketState.Open)
                {
                    var msg = await Receive(ws);
                    if (msg == null) return;
                    var d = (JsonObject)msg["d"]!;
                    if ((int)msg["op"]! == 1)
                    {
                        if (_password != null && (string?)d["authentication"] != ObsClient.AuthString(_password, salt, challenge))
                        { await ws.CloseAsync((WebSocketCloseStatus)4009, "Authentication failed.", CancellationToken.None); return; }
                        await Send(ws, new JsonObject { ["op"] = 2, ["d"] = new JsonObject { ["negotiatedRpcVersion"] = 1 } });
                        continue;
                    }
                    var type = (string)d["requestType"]!;
                    var data = d["requestData"] as JsonObject;
                    var name = (string?)data?["inputName"];
                    JsonObject? res = null;
                    var ok = true;
                    string? comment = null;
                    switch (type)
                    {
                        case "GetInputList":
                            res = new JsonObject { ["inputs"] = new JsonArray(
                                new JsonObject { ["inputName"] = "Mic/Aux", ["inputKind"] = "wasapi_input_capture", ["unversionedInputKind"] = "wasapi_input_capture" },
                                new JsonObject { ["inputName"] = "Camera", ["inputKind"] = "dshow_input", ["unversionedInputKind"] = "dshow_input" },
                                new JsonObject { ["inputName"] = "Desktop Audio", ["inputKind"] = "wasapi_output_capture", ["unversionedInputKind"] = "wasapi_output_capture" }) };
                            break;
                        case "GetInputMute" when name != null && _mute.TryGetValue(name, out var m):
                            res = new JsonObject { ["inputMuted"] = m };
                            break;
                        case "SetInputMute" when name != null && _mute.ContainsKey(name):
                            _mute[name] = (bool)data!["inputMuted"]!;
                            lock (Sets) Sets.Add((type, name, _mute[name]));
                            break;
                        default:
                            ok = false; comment = $"No source was found by the name of `{name}`.";
                            break;
                    }
                    var reply = new JsonObject { ["requestType"] = type, ["requestId"] = (string)d["requestId"]!, ["requestStatus"] = new JsonObject { ["result"] = ok, ["code"] = ok ? 100 : 600, ["comment"] = comment } };
                    if (res != null) reply["responseData"] = res;
                    await Send(ws, new JsonObject { ["op"] = 7, ["d"] = reply });
                }
            }
            catch (WebSocketException) { }
        }

        public Task PushMuteAsync(string name, bool muted)
        {
            _mute[name] = muted;
            return Send(_ws!, new JsonObject { ["op"] = 5, ["d"] = new JsonObject { ["eventType"] = "InputMuteStateChanged", ["eventIntent"] = 8, ["eventData"] = new JsonObject { ["inputName"] = name, ["inputMuted"] = muted } } });
        }

        private readonly SemaphoreSlim _sendLock = new(1, 1);
        private async Task Send(WebSocket ws, JsonObject o)
        {
            await _sendLock.WaitAsync();
            try { await ws.SendAsync(Encoding.UTF8.GetBytes(o.ToJsonString()), WebSocketMessageType.Text, true, CancellationToken.None); }
            finally { _sendLock.Release(); }
        }

        private static async Task<JsonObject?> Receive(WebSocket ws)
        {
            var buf = new byte[65536];
            var r = await ws.ReceiveAsync(buf, CancellationToken.None);
            return r.MessageType == WebSocketMessageType.Close ? null : JsonNode.Parse(Encoding.UTF8.GetString(buf, 0, r.Count)) as JsonObject;
        }

        private bool _disposed;
        public async ValueTask DisposeAsync()
        {
            if (_disposed) return;
            _disposed = true;
            _cts.Cancel();
            if (_ws is { State: WebSocketState.Open } ws) try { await ws.CloseOutputAsync(WebSocketCloseStatus.EndpointUnavailable, "OBS is closing", CancellationToken.None); } catch { }
            _http.Close();
            try { await _loop.WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
        }
    }
}
