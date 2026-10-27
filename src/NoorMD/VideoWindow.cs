using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Security;
using NoorMD.Core.Settings;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// The detached Video Bench player: a small window that can stay on top of other programs (a game, the editor, OBS)
/// while a tutorial or episode plays. It has its own page (wwwroot/video.html) and reports the position back, so
/// resume and notes keep working; closing it hands the video back to the Video Bench at the same moment.
/// </summary>
public sealed class VideoWindow : Window
{
    private readonly MainWindow _main;
    private readonly WebView2 _web = new(); // visible from the start: a WebView2 created hidden keeps a zero-size view until the window is resized
    private readonly string _webRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
    private bool _ready;
    private (long Id, double Time, bool Paused, bool PauseOnNote)? _pending;
    private long? _id;
    private double _time;

    public VideoWindow(MainWindow main)
    {
        _main = main;
        Title = "Video — NoorMD";
        Width = 720; Height = 450; MinWidth = 320; MinHeight = 200;
        Topmost = true;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Content = new Grid { Children = { _web } };
        ThemeManager.Apply(main.CurrentTheme);
        Background = System.Windows.Media.Brushes.Black;
        SourceInitialized += (_, _) => ThemeManager.ApplyChrome(this);
        Loaded += async (_, _) => await InitAsync();
        Closed += (_, _) => { _main.VideoWindowClosed(_id, _time); try { _web.Dispose(); } catch { } };
    }

    internal void Play(long id, double time, bool paused, bool pauseOnNote = true)
    {
        _id = id; _time = time;
        if (_ready) Post(BridgeProtocol.Event("video.load", new { id, time, paused, pauseOnNote }));
        else _pending = (id, time, paused, pauseOnNote);
    }

    private async Task InitAsync()
    {
        try
        {
            _web.DefaultBackgroundColor = System.Drawing.Color.Black;
            await _web.EnsureCoreWebView2Async(_main.WebEnvironment);
        }
        catch (Exception ex)
        {
            Log.Error("The video window could not start", ex);
            ThemedDialog.ShowError(this, "The video window could not start", ex.Message);
            Close();
            return;
        }
        var core = _web.CoreWebView2;
        var s = core.Settings;
#if DEBUG
        s.AreDevToolsEnabled = true;
#else
        s.AreDevToolsEnabled = false;
#endif
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.AreDefaultScriptDialogsEnabled = false;
        s.AreHostObjectsAllowed = false;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPinchZoomEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        core.AddWebResourceRequestedFilter(AssetResolver.Origin + "/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, e) =>
        {
            try
            {
                if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri)) return;
                if (e.Request.Method == "GET" && AssetResolver.IsAppUri(uri) && _main.TryServeVideo(uri, e, core.Environment)) return;
                var file = e.Request.Method == "GET" && uri.AbsolutePath.StartsWith(AssetResolver.AppPrefix, StringComparison.Ordinal) ? AssetResolver.Resolve(uri, _webRoot, null) : null;
                if (file == null) { e.Response = core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain"); return; }
                var headers = $"Content-Type: {AssetResolver.ContentType(file)}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff";
                if (AssetResolver.IsVideoPage(uri)) headers += "\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
                e.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(file)), 200, "OK", headers);
            }
            catch (Exception ex)
            {
                Log.Error("Serving " + e.Request.Uri + " to the video window failed", ex);
                e.Response = core.Environment.CreateWebResourceResponse(null, 500, "Error", "Content-Type: text/plain");
            }
        };
        core.NavigationStarting += (_, e) => { if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var u) || !AssetResolver.IsVideoPage(u)) e.Cancel = true; };
        core.NavigationCompleted += (_, _) => { _web.Focus(); NudgeLayout(); };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.DownloadStarting += (_, e) => e.Cancel = true;
        core.PermissionRequested += (_, e) => { e.State = CoreWebView2PermissionState.Deny; e.SavesInProfile = false; };
        core.ContextMenuRequested += MainWindow.OnContextMenuRequested;
        core.ContainsFullScreenElementChanged += (_, _) =>
        {
            var full = core.ContainsFullScreenElement;
            WindowStyle = full ? WindowStyle.None : WindowStyle.SingleBorderWindow;
            WindowState = full ? WindowState.Maximized : WindowState.Normal;
        };
        core.WebMessageReceived += OnMessage;
        var boot = JsonSerializer.Serialize(new { theme = _main.CurrentTheme, background = "#000000" }, SettingsStore.Json);
        await core.AddScriptToExecuteOnDocumentCreatedAsync($"window.__NOORMD_BOOT__ = Object.freeze({boot});");
        core.Navigate(AssetResolver.Origin + AssetResolver.VideoPagePath);
    }

    private void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || !AssetResolver.IsVideoPage(source)) return;
        if (!BridgeProtocol.TryParse(e.WebMessageAsJson, out var req, out var error) || req == null) { Log.Error("Rejected video window message: " + error); return; }
        try
        {
            object? result = null;
            switch (req.Type)
            {
                case "video.ready":
                    _ready = true;
                    if (_pending is { } p) { _pending = null; Post(BridgeProtocol.Event("video.load", new { id = p.Id, time = p.Time, paused = p.Paused, pauseOnNote = p.PauseOnNote })); }
                    break;
                case "video.topmost":
                    Topmost = Json.IsTrue(req.Payload, "value");
                    result = new { topmost = Topmost };
                    break;
                case "video.title":
                    Title = (req.GetString("title", 300) ?? "Video") + " — NoorMD";
                    break;
                case "video.close":
                    Close();
                    break;
                case "video.position":
                    _id = Json.OptLong(req.Payload, "id") ?? _id;
                    _time = Json.OptDouble(req.Payload, "position") ?? _time;
                    result = _main.VideoRequestFromWindow(req.Type, req.Payload);
                    break;
                case "video.note.add":
                    result = _main.VideoRequestFromWindow(req.Type, req.Payload);
                    if (Json.OptLong(req.Payload, "id") is long vid) _main.VideoNotesChanged(vid);
                    break;
                default:
                    result = _main.VideoRequestFromWindow(req.Type, req.Payload);
                    break;
            }
            if (req.Id is long id) Post(BridgeProtocol.Reply(id, result));
        }
        catch (Exception ex)
        {
            if (ex is not (IOException or InvalidOperationException or ArgumentException) && ex.GetType().Name != "BridgeError") Log.Error($"Video window request {req.Type} failed", ex);
            if (req.Id is long id) Post(BridgeProtocol.ReplyError(id, ex.Message));
        }
    }

    private void Post(string json)
    {
        try { _web.CoreWebView2?.PostWebMessageAsJson(json); } catch (Exception ex) { Log.Error("Posting to the video window failed", ex); }
    }

    internal async Task<string> EvalAsync(string script) => await _web.CoreWebView2.ExecuteScriptAsync(script);

    /// <summary>
    /// Makes WebView2 pick up the window's real size once the page is there (otherwise it can stay blank until the
    /// user resizes the window): a one-pixel resize and back, plus a layout pass.
    /// </summary>
    private void NudgeLayout()
    {
        _web.InvalidateMeasure();
        _web.UpdateLayout();
        if (WindowState != WindowState.Normal) return;
        var w = Width;
        Width = w + 1;
        Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Background, () => Width = w);
    }
}
