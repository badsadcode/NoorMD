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
/// The Stream Desk in its own window (wwwroot/stream.html), so it can sit on a second monitor next to OBS while the
/// editor stays free. Its page may only use the Stream Desk and Mic Guard commands (plus copying text and opening a
/// Vault note); everything else is refused. Size and position are remembered.
/// </summary>
public sealed class StreamWindow : Window
{
    private static readonly string[] Allowed = ["stream.", "mic."];
    private static readonly HashSet<string> AllowedExact = ["clipboard.copyText", "vault.open", "vault.openFile"];
    private readonly MainWindow _main;
    private readonly WebView2 _web = new(); // visible from the start (a hidden WebView2 stays blank until resized)
    private readonly string _webRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
    private bool _ready;
    private bool _dirty, _closeConfirmed;
    private string? _pendingTab;

    public StreamWindow(MainWindow main, Rect? placement)
    {
        _main = main;
        Title = "Stream Desk — NoorMD";
        Width = 1180; Height = 820; MinWidth = 560; MinHeight = 420;
        if (placement is { } r && r.Width >= MinWidth && r.Height >= MinHeight && OnScreen(r)) { Left = r.Left; Top = r.Top; Width = r.Width; Height = r.Height; WindowStartupLocation = WindowStartupLocation.Manual; }
        else WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Content = new Grid { Children = { _web } };
        ThemeManager.Apply(main.CurrentTheme);
        Background = new System.Windows.Media.SolidColorBrush(ThemeManager.Background(main.CurrentTheme));
        SourceInitialized += (_, _) => ThemeManager.ApplyChrome(this);
        Loaded += async (_, _) => await InitAsync();
        Closing += (_, e) =>
        {
            if (!_dirty || _closeConfirmed || App.SessionIsEnding) return;
            if (ThemedDialog.Confirm(this, "Close with unsaved supporters?", "The supporters list has changes that are not saved yet.", "Close without saving")) _closeConfirmed = true;
            else e.Cancel = true;
        };
        Closed += (_, _) => { _main.StreamWindowClosed(new Rect(Left, Top, Width, Height)); try { _web.Dispose(); } catch { } };
    }

    private static bool OnScreen(Rect r) =>
        r.Right > SystemParameters.VirtualScreenLeft + 40 && r.Left < SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - 40
        && r.Top >= SystemParameters.VirtualScreenTop - 10 && r.Top < SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - 40;

    /// <summary>Shows a tab (or the last one) and brings the window forward.</summary>
    internal void ShowTab(string? tab)
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        if (_ready) PostEvent("stream.tab", new { tab });
        else _pendingTab = tab;
    }

    private async Task InitAsync()
    {
        try { await _web.EnsureCoreWebView2Async(_main.WebEnvironment); }
        catch (Exception ex)
        {
            Log.Error("The Stream Desk window could not start", ex);
            ThemedDialog.ShowError(this, "The Stream Desk could not start", ex.Message);
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
                if (e.Request.Method == "GET" && AssetResolver.IsAppUri(uri) && uri.AbsolutePath.StartsWith("/_art/", StringComparison.Ordinal))
                {
                    var art = long.TryParse(uri.AbsolutePath[6..], out var id) ? _main.ArtFor(id) : null;
                    e.Response = art is { } a
                        ? core.Environment.CreateWebResourceResponse(new MemoryStream(a.Data), 200, "OK", $"Content-Type: {a.Mime}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff")
                        : core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
                    return;
                }
                var file = e.Request.Method == "GET" && uri.AbsolutePath.StartsWith(AssetResolver.AppPrefix, StringComparison.Ordinal) ? AssetResolver.Resolve(uri, _webRoot, null) : null;
                if (file == null) { e.Response = core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain"); return; }
                var headers = $"Content-Type: {AssetResolver.ContentType(file)}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff";
                if (AssetResolver.IsStreamPage(uri)) headers += "\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
                e.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(file)), 200, "OK", headers);
            }
            catch (Exception ex)
            {
                Log.Error("Serving " + e.Request.Uri + " to the Stream Desk failed", ex);
                e.Response = core.Environment.CreateWebResourceResponse(null, 500, "Error", "Content-Type: text/plain");
            }
        };
        core.NavigationStarting += (_, e) => { if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var u) || !AssetResolver.IsStreamPage(u)) e.Cancel = true; };
        core.NavigationCompleted += (_, _) => { _web.Focus(); NudgeLayout(); };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.DownloadStarting += (_, e) => e.Cancel = true;
        core.PermissionRequested += (_, e) => { e.State = CoreWebView2PermissionState.Deny; e.SavesInProfile = false; };
        core.ContextMenuRequested += MainWindow.OnContextMenuRequested;
        core.WebMessageReceived += OnMessage;
        var boot = JsonSerializer.Serialize(new { theme = _main.CurrentTheme, background = "#" + ThemeManager.Background(_main.CurrentTheme).ToString()[3..] }, SettingsStore.Json);
        await core.AddScriptToExecuteOnDocumentCreatedAsync($"window.__NOORMD_BOOT__ = Object.freeze({boot});");
        core.Navigate(AssetResolver.Origin + AssetResolver.StreamPagePath);
    }

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || !AssetResolver.IsStreamPage(source)) return;
        if (!BridgeProtocol.TryParse(e.WebMessageAsJson, out var req, out var error) || req == null) { Log.Error("Rejected Stream Desk message: " + error); return; }
        try
        {
            object? result = null;
            switch (req.Type)
            {
                case "streamwin.ready":
                    _ready = true;
                    result = new { tab = _pendingTab };
                    _pendingTab = null;
                    break;
                case "streamwin.close":
                    _closeConfirmed = true; // the page already asked about unsaved supporters
                    Close();
                    break;
                case "streamwin.dirty":
                    _dirty = Json.IsTrue(req.Payload, "dirty");
                    break;
                default:
                    if (!AllowedExact.Contains(req.Type) && !Allowed.Any(p => req.Type.StartsWith(p, StringComparison.Ordinal)))
                        throw new InvalidOperationException($"The Stream Desk can't use \"{req.Type}\".");
                    result = await _main.RequestFromStreamWindowAsync(req);
                    break;
            }
            if (req.Id is long id) Post(BridgeProtocol.Reply(id, result));
        }
        catch (Exception ex)
        {
            if (ex.GetType().Name != "BridgeError" && ex is not InvalidOperationException) Log.Error($"Stream Desk request {req.Type} failed", ex);
            if (req.Id is long id) Post(BridgeProtocol.ReplyError(id, ex.Message));
        }
    }

    internal void PostEvent(string name, object? payload) { if (_ready) Post(BridgeProtocol.Event(name, payload)); }

    private void Post(string json)
    {
        try { _web.CoreWebView2?.PostWebMessageAsJson(json); } catch (Exception ex) { Log.Error("Posting to the Stream Desk failed", ex); }
    }

    internal async Task<string> EvalAsync(string script) => await _web.CoreWebView2.ExecuteScriptAsync(script);

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
