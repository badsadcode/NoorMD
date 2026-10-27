using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Stream;
using NoorMD.Host;

namespace NoorMD;

/// <summary>
/// Mic Guard: one hotkey that sets the Windows microphone and OBS's mic source to the same explicit state, reads both
/// back, and shows the truth in a floating indicator. Muting the Windows microphone silences it for Discord and every
/// other program too. Everything is off until switched on; the OBS password lives in Windows Credential Manager.
/// </summary>
public partial class MainWindow
{
    internal const string ObsCredential = "NoorMD/obs-websocket";
    private CaptureEndpoint? _mic;
    private string? _micError;
    private MicSide _micWin = MicSide.Off, _micObs = MicSide.Off;
    private ObsClient? _obs;
    private string? _obsError;
    private IReadOnlyList<ObsInput> _obsInputs = [];
    private bool _obsConnecting;
    private DispatcherTimer? _micTimer;
    private string? _micDefaultId;
    private GlobalHotkey? _hotkey;
    private string? _hotkeyError;
    private MicIndicatorWindow? _micIndicator;
    private MicVerdict _lastVerdict = MicVerdict.NotSetUp;

    private JsonObject MicCfg => StreamCfg["mic"] as JsonObject ?? (JsonObject)(StreamCfg["mic"] = new JsonObject());
    private bool MicBool(string key, bool fallback = false) => MicCfg[key] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : fallback;
    private string? MicString(string key) => MicCfg[key] is JsonValue v && v.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s) ? s : null;
    private double MicNumber(string key, double fallback) => MicCfg[key] is JsonValue v && v.TryGetValue<double>(out var d) && double.IsFinite(d) ? d : fallback;
    private string ObsUrl => MicString("obsUrl") ?? "ws://127.0.0.1:4455";

    /// <summary>Called once the page is ready (primary window only: a hotkey belongs to one window).</summary>
    private void RestoreMic()
    {
        try { ApplyMicConfig(); }
        catch (Exception ex) { Log.Error("Mic Guard could not start", ex); }
    }

    private void ApplyMicConfig()
    {
        // Windows microphone
        if (MicBool("windows"))
        {
            var want = MicString("deviceId");
            if (_mic == null || (want != null && _mic.Id != want) || (want == null && _mic.Id != CaptureEndpoint.DefaultId())) OpenMic(want);
        }
        else { CloseMic(); _micWin = MicSide.Off; }

        // OBS
        if (MicBool("obs")) { if (_obs is not { Connected: true } && !_obsConnecting) _ = ConnectObsAsync(null, false, quiet: true); else _ = ReadObsAsync(); }
        else { _ = DisconnectObsAsync(); _micObs = MicSide.Off; _obsError = null; }

        // Hotkey
        var gesture = MicString("hotkey");
        if (gesture != _hotkey?.Gesture)
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            _hotkey ??= hwnd != IntPtr.Zero ? new GlobalHotkey(hwnd, () => _ = MicToggleAsync("hotkey")) : null;
            _hotkeyError = _hotkey?.Set(gesture);
        }

        // Indicator
        if (MicBool("indicator")) ShowMicIndicator(); else { _micIndicator?.Close(); _micIndicator = null; }

        // Re-check now and then: OBS started later, a headset plugged in (default microphone changed).
        _micTimer ??= new DispatcherTimer(TimeSpan.FromSeconds(4), DispatcherPriority.Background, (_, _) => MicTick(), Dispatcher);
        _micTimer.IsEnabled = MicBool("windows") || MicBool("obs");
        MicPublish();
    }

    private void MicTick()
    {
        if (MicBool("windows") && MicString("deviceId") == null)
        {
            string? id = null;
            try { id = CaptureEndpoint.DefaultId(); } catch { /* audio service restarting */ }
            if (id != _micDefaultId) { _micDefaultId = id; OpenMic(null); MicPublish(); }
        }
        if (MicBool("windows") && _mic == null) { OpenMic(MicString("deviceId")); MicPublish(); }
        if (MicBool("obs") && _obs is not { Connected: true } && !_obsConnecting) _ = ConnectObsAsync(null, false, quiet: true);
    }

    private void OpenMic(string? id)
    {
        CloseMic();
        try
        {
            _mic = CaptureEndpoint.Open(id);
            _micDefaultId = id == null ? _mic?.Id : _micDefaultId;
            if (_mic == null) { _micWin = MicSide.Unknown; _micError = id == null ? "No microphone is connected." : "That microphone is not connected."; return; }
            _mic.MuteChanged += muted => Dispatcher.BeginInvoke(() => { _micWin = muted ? MicSide.Muted : MicSide.Live; MicPublish(); });
            _micWin = _mic.Muted ? MicSide.Muted : MicSide.Live;
            _micError = null;
        }
        catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or InvalidCastException or UnauthorizedAccessException)
        {
            Log.Error("Opening the microphone failed", ex);
            _mic = null; _micWin = MicSide.Unknown; _micError = "Windows did not give access to the microphone.";
        }
    }

    private void CloseMic()
    {
        try { _mic?.Dispose(); } catch { /* device gone */ }
        _mic = null;
    }

    private async Task ConnectObsAsync(string? password, bool remember, bool quiet)
    {
        if (_obsConnecting) return;
        _obsConnecting = true;
        ObsClient? client = null;
        try
        {
            await DisconnectObsAsync();
            if (!Uri.TryCreate(ObsUrl, UriKind.Absolute, out var url)) throw new ObsException("The OBS address is not valid (for example ws://127.0.0.1:4455).");
            var pw = password ?? (CredentialStore.Exists(ObsCredential) ? CredentialStore.Read(ObsCredential) : null);
            client = new ObsClient();
            await client.ConnectAsync(url, pw, TimeSpan.FromSeconds(4));
            if (password != null && remember) CredentialStore.Write(ObsCredential, password);
            var c = client;
            client.MuteChanged += (name, muted) => Dispatcher.BeginInvoke(() => { if (name == MicString("obsInput")) { _micObs = muted ? MicSide.Muted : MicSide.Live; MicPublish(); } });
            client.Disconnected += why => Dispatcher.BeginInvoke(() => { if (_obs == c) { _obs = null; _micObs = MicBool("obs") ? MicSide.Unknown : MicSide.Off; _obsError = why; MicPublish(); } });
            _obs = client;
            _obsError = null;
            _obsInputs = await client.AudioInputsAsync();
            if (MicString("obsInput") is not { } chosen || _obsInputs.All(i => i.Name != chosen))
            {
                var pick = _obsInputs.FirstOrDefault(i => i.Kind.Contains("input_capture", StringComparison.OrdinalIgnoreCase)) ?? _obsInputs.FirstOrDefault();
                MicCfg["obsInput"] = pick?.Name;
                SaveStreamCfg();
            }
            await ReadObsAsync();
        }
        catch (ObsException ex)
        {
            if (client != null) await client.DisposeAsync();
            _obs = null; _micObs = MicSide.Unknown; _obsError = ex.Message;
            if (!quiet) throw new BridgeError(ex.Message);
        }
        finally { _obsConnecting = false; MicPublish(); }
    }

    private async Task ReadObsAsync()
    {
        if (_obs is not { Connected: true } obs || MicString("obsInput") is not { } input) { if (MicBool("obs") && _obs != null) _micObs = MicSide.Unknown; return; }
        try { _micObs = await obs.GetMuteAsync(input) ? MicSide.Muted : MicSide.Live; _obsError = null; }
        catch (ObsException ex) { _micObs = MicSide.Unknown; _obsError = ex.Message; }
        MicPublish();
    }

    private async Task DisconnectObsAsync()
    {
        var o = _obs; _obs = null;
        if (o != null) await o.DisposeAsync();
    }

    /// <summary>Sets every switched-on side to the same state, then reads them back.</summary>
    private async Task MicSetAsync(bool muted)
    {
        var errors = new List<string>();
        if (_mic != null)
        {
            try { _mic.Muted = muted; _micWin = _mic.Muted ? MicSide.Muted : MicSide.Live; }
            catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException) { _micWin = MicSide.Unknown; errors.Add("Windows microphone: " + ex.Message); }
        }
        if (MicBool("obs"))
        {
            if (_obs is { Connected: true } obs && MicString("obsInput") is { } input)
            {
                try { await obs.SetMuteAsync(input, muted); _micObs = await obs.GetMuteAsync(input) ? MicSide.Muted : MicSide.Live; }
                catch (ObsException ex) { _micObs = MicSide.Unknown; errors.Add("OBS: " + ex.Message); }
            }
            else errors.Add("OBS is not connected.");
        }
        MicPublish();
        if (errors.Count > 0) PushNotice("Mic Guard: " + string.Join(" ", errors));
    }

    private async Task MicToggleAsync(string source)
    {
        if (MicGuard.Verdict(_micWin, _micObs) == MicVerdict.NotSetUp) { PushNotice("Mic Guard is not set up yet: Stream Desk › Mic Guard."); return; }
        await MicSetAsync(MicGuard.ToggleTarget(_micWin, _micObs));
        Log.Info($"Mic Guard: {source} → {MicGuard.Label(MicGuard.Verdict(_micWin, _micObs))}");
    }

    internal void MicToggleFromIndicator() => _ = MicToggleAsync("indicator");
    internal void MicSetFromIndicator(bool muted) => _ = MicSetAsync(muted);
    internal void HideMicIndicator() { MicCfg["indicator"] = false; SaveStreamCfg(); _micIndicator?.Close(); _micIndicator = null; MicPublish(); }
    internal void ShowMicSettings() => OpenStreamWindow("mic", false, false);

    internal void MicIndicatorMoved(double x, double y)
    {
        if (_micIndicator is not { IsLoaded: true }) return;
        MicCfg["x"] = Math.Round(x); MicCfg["y"] = Math.Round(y);
        _micMoveTimer ??= new DispatcherTimer(TimeSpan.FromMilliseconds(600), DispatcherPriority.Background, (_, _) => { _micMoveTimer!.Stop(); SaveStreamCfg(); }, Dispatcher);
        _micMoveTimer.Stop(); _micMoveTimer.Start();
    }
    private DispatcherTimer? _micMoveTimer;

    private void ShowMicIndicator()
    {
        if (_micIndicator == null)
        {
            _micIndicator = new MicIndicatorWindow(this);
            var area = SystemParameters.WorkArea;
            var x = MicNumber("x", area.Right - 200); var y = MicNumber("y", area.Top + 20);
            // Back on screen if the monitor it was on is gone.
            if (x < SystemParameters.VirtualScreenLeft || x > SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - 40
                || y < SystemParameters.VirtualScreenTop || y > SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - 30) { x = area.Right - 200; y = area.Top + 20; }
            _micIndicator.Left = x; _micIndicator.Top = y;
            _micIndicator.Closed += (_, _) => { if (_micIndicator != null && !_micIndicator.IsVisible) _micIndicator = null; };
            _micIndicator.Configure(MicNumber("opacity", 0.92), MicNumber("scale", 1), MicBool("hideFromCapture", true));
            _micIndicator.Show();
        }
        else _micIndicator.Configure(MicNumber("opacity", 0.92), MicNumber("scale", 1), MicBool("hideFromCapture", true));
    }

    private static string SideName(MicSide s) => s.ToString().ToLowerInvariant();

    private object MicStatus()
    {
        var verdict = MicGuard.Verdict(_micWin, _micObs);
        IReadOnlyList<CaptureDevice> devices = [];
        try { devices = CaptureEndpoint.List(); } catch (Exception ex) { Log.Error("Listing microphones failed", ex); }
        return new
        {
            config = new
            {
                windows = MicBool("windows"), deviceId = MicString("deviceId"), obs = MicBool("obs"), obsUrl = ObsUrl, obsInput = MicString("obsInput"),
                hotkey = MicString("hotkey"), indicator = MicBool("indicator"), opacity = MicNumber("opacity", 0.92), scale = MicNumber("scale", 1), hideFromCapture = MicBool("hideFromCapture", true),
            },
            devices = devices.Select(d => new { id = d.Id, name = d.Name, isDefault = d.IsDefault }),
            windows = new { state = SideName(_micWin), name = _mic?.Name, error = _micError },
            obs = new { state = SideName(_micObs), connected = _obs is { Connected: true }, connecting = _obsConnecting, version = _obs?.ObsVersion, error = _obsError, inputs = _obsInputs.Select(i => new { name = i.Name, kind = i.Kind }), hasPassword = CredentialStore.Exists(ObsCredential) },
            verdict = verdict.ToString().ToLowerInvariant(), label = MicGuard.Label(verdict), explain = MicGuard.Explain(verdict, _micWin, _micObs),
            hotkey = new { gesture = _hotkey?.Gesture, error = _hotkeyError },
            indicator = new { shown = _micIndicator != null, excludedFromCapture = _micIndicator?.ExcludedFromCapture ?? false },
        };
    }

    private void MicPublish()
    {
        var verdict = MicGuard.Verdict(_micWin, _micObs);
        if (_micIndicator != null)
        {
            var parts = new List<string>();
            if (_micWin != MicSide.Off) parts.Add("Win " + MicWord(_micWin));
            if (_micObs != MicSide.Off) parts.Add("OBS " + MicWord(_micObs));
            _micIndicator.SetState(verdict, verdict is MicVerdict.Mismatch or MicVerdict.Unknown ? string.Join(" · ", parts) : "", MicGuard.Explain(verdict, _micWin, _micObs));
        }
        if (verdict != _lastVerdict && verdict == MicVerdict.Mismatch) Log.Info($"Mic Guard: out of step (Windows {_micWin}, OBS {_micObs})");
        _lastVerdict = verdict;
        var state = new { verdict = verdict.ToString().ToLowerInvariant(), label = MicGuard.Label(verdict), explain = MicGuard.Explain(verdict, _micWin, _micObs), windows = SideName(_micWin), obs = SideName(_micObs), obsConnected = _obs is { Connected: true }, obsError = _obsError };
        if (_webReady) PushEvent("mic.state", state);
        _streamWindow?.PostEvent("mic.state", state);
    }

    private static string MicWord(MicSide s) => s switch { MicSide.Live => "live", MicSide.Muted => "muted", _ => "?" };

    private async Task<object?> DispatchMicAsync(BridgeRequest req)
    {
        var p = req.Payload;
        switch (req.Type)
        {
            case "mic.status":
                return MicStatus();
            case "mic.config":
            {
                foreach (var key in new[] { "windows", "obs", "indicator", "hideFromCapture" })
                    if (p.TryGetProperty(key, out var v) && v.ValueKind is System.Text.Json.JsonValueKind.True or System.Text.Json.JsonValueKind.False) MicCfg[key] = v.GetBoolean();
                foreach (var key in new[] { "opacity", "scale" })
                    if (NoorMD.Core.Bridge.Json.OptDouble(p, key) is double d && double.IsFinite(d)) MicCfg[key] = Math.Round(d, 2);
                if (p.TryGetProperty("deviceId", out _)) MicCfg["deviceId"] = req.GetString("deviceId", 1000);
                if (p.TryGetProperty("obsInput", out _)) { MicCfg["obsInput"] = req.GetString("obsInput", 500); }
                if (p.TryGetProperty("obsUrl", out _))
                {
                    var u = req.GetString("obsUrl", 300)?.Trim();
                    if (u != null && (!Uri.TryCreate(u, UriKind.Absolute, out var parsed) || parsed.Scheme is not ("ws" or "wss"))) throw new BridgeError("The OBS address must look like ws://127.0.0.1:4455");
                    MicCfg["obsUrl"] = u;
                }
                if (p.TryGetProperty("hotkey", out _))
                {
                    var g = req.GetString("hotkey", 60)?.Trim();
                    HotkeyGesture? parsed = null;
                    if (!string.IsNullOrEmpty(g) && !GlobalHotkey.TryParse(g, out parsed, out _, out var err)) throw new BridgeError(err!);
                    MicCfg["hotkey"] = parsed?.ToString();
                }
                SaveStreamCfg();
                ApplyMicConfig();
                if (p.TryGetProperty("obsInput", out _)) await ReadObsAsync();
                return MicStatus();
            }
            case "mic.obs.connect":
            {
                var pw = req.GetString("password", 500);
                await ConnectObsAsync(string.IsNullOrEmpty(pw) ? null : pw, NoorMD.Core.Bridge.Json.IsTrue(p, "remember"), quiet: false);
                return MicStatus();
            }
            case "mic.obs.forget":
                CredentialStore.Delete(ObsCredential);
                return MicStatus();
            case "mic.toggle":
                await MicToggleAsync("page");
                return MicStatus();
            case "mic.set":
                await MicSetAsync(NoorMD.Core.Bridge.Json.IsTrue(p, "muted"));
                return MicStatus();
            default:
                throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }

    private void ShutdownMic()
    {
        _micTimer?.Stop();
        try { _hotkey?.Dispose(); } catch { /* window going away */ }
        try { _micIndicator?.Close(); } catch { /* ignore */ }
        CloseMic();
        try { _obs?.DisposeAsync().AsTask().Wait(1500); } catch { /* ignore */ }
    }
}
