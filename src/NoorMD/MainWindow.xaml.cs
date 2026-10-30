using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Recovery;
using NoorMD.Core.Security;
using NoorMD.Core.Settings;
using NoorMD.Core.Snapshots;
using NoorMD.Host;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// The application window: owns WebView2 setup, security restrictions, window chrome and lifecycle.
/// Bridge commands are in MainWindow.Bridge.cs; document operations in MainWindow.Documents.cs.
/// </summary>
public partial class MainWindow : Window
{
    private const string WebView2DownloadUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

    private readonly SettingsStore _settingsStore;
    private readonly AppSettings _settings;
    private readonly RecoveryStore _recovery;
    private readonly SnapshotStore _snapshots;
    private readonly DispatcherTimer _settingsSaveTimer;
    private readonly string _webRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
    private readonly SemaphoreSlim _docGate = new(1, 1);
    private string? _startupFile;
    private bool _closeConfirmed;
    private bool _webReady;
    private int _readyCount;

    private CoreWebView2 Core => Web.CoreWebView2;
    /// <summary>Shared with NoorSketch windows (one browser process, one profile).</summary>
    internal CoreWebView2Environment? WebEnvironment { get; private set; }

    /// <summary>The language NoorMD started in: its dialogs speak it until the next start.</summary>
    private readonly string _startLanguage;

    public MainWindow(string? startupFile)
    {
        _startupFile = startupFile;
        _settingsStore = new SettingsStore(App.Paths.SettingsFile);
        _settings = _settingsStore.Load();
        _startLanguage = _settings.Prefs.Language;
        UseStartLanguage();
        _recovery = new RecoveryStore(App.Paths.Recovery);
        _snapshots = new SnapshotStore(App.Paths.Snapshots);
        _snapshots.PruneUntitled(TimeSpan.FromDays(30));
        _settingsSaveTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(600) };
        _settingsSaveTimer.Tick += (_, _) => SaveSettingsNow();

        ThemeManager.Apply(_settings.Prefs.Theme);
        InitializeComponent();
        RestorePlacement();
        SourceInitialized += (_, _) => ThemeManager.ApplyChrome(this);
        Loaded += async (_, _) => await InitializeWebViewAsync();
        Closing += OnClosing;
        Closed += OnClosed;
        Activated += async (_, _) => await CheckExternalChangesAsync();
        // WPF would treat Ctrl+Tab as "move focus to the next control" before the page ever sees it.
        System.Windows.Input.KeyboardNavigation.SetControlTabNavigation(this, System.Windows.Input.KeyboardNavigationMode.None);
        Web.PreviewKeyDown += OnWebPreviewKeyDown;
        UpdateWindowTitle();
        StartSelfTestWatchdog();
    }

    // ------------------------------------------------------------------ WebView2

    private async Task InitializeWebViewAsync()
    {
        try
        {
            Web.DefaultBackgroundColor = ToDrawing(ThemeManager.Background(_settings.Prefs.Theme));
            // AudioVideoTracks: lets NoorVideo list and switch a video's audio tracks (several languages or commentary).
            var options = new CoreWebView2EnvironmentOptions("--enable-blink-features=AudioVideoTracks");
            var env = await CoreWebView2Environment.CreateAsync(browserExecutableFolder: null, userDataFolder: App.Paths.WebViewData, options);
            WebEnvironment = env;
            await Web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException ex)
        {
            Log.Error("WebView2 runtime missing", ex);
            ShowSplashError("Microsoft Edge WebView2 Runtime is required",
                "NoorMD uses the WebView2 Runtime that ships with Windows 11 and current Windows 10. It was not found on this PC. Install it (free, from Microsoft), then start NoorMD again.",
                "Get WebView2 Runtime", () => OpenExternal(WebView2DownloadUrl));
            return;
        }
        catch (Exception ex)
        {
            Log.Error("WebView2 initialization failed", ex);
            ShowSplashError("The editor could not start", ex.Message, "Close", Close);
            return;
        }

        var s = Core.Settings;
#if DEBUG
        s.AreDevToolsEnabled = true;
#else
        s.AreDevToolsEnabled = false;
#endif
        s.AreBrowserAcceleratorKeysEnabled = false; // Ctrl+S/P/F/R etc. are app shortcuts, not browser ones
        s.AreDefaultScriptDialogsEnabled = false;
        s.AreHostObjectsAllowed = false;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPinchZoomEnabled = false;
        s.IsSwipeNavigationEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsWebMessageEnabled = true;
        s.IsBuiltInErrorPageEnabled = true;
        s.IsReputationCheckingRequired = false; // all content is local; no SmartScreen lookups

        Core.AddWebResourceRequestedFilter(AssetResolver.Origin + "/*", CoreWebView2WebResourceContext.All);
        Core.WebResourceRequested += OnWebResourceRequested;
        Core.NavigationStarting += OnNavigationStarting;
        Core.NavigationCompleted += OnNavigationCompleted;
        Core.NewWindowRequested += OnNewWindowRequested;
        Core.FrameNavigationStarting += (_, e) => { if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var u) || !AssetResolver.IsAppUri(u)) e.Cancel = true; };
        Core.DownloadStarting += (_, e) => { e.Cancel = true; };
        Core.PermissionRequested += OnPermissionRequested; // everything denied, except the microphone right after Record (voice notes)
        // Earlier versions let WebView2 remember a microphone answer; forget it so the Record-only rule always applies.
        try { await Core.Profile.SetPermissionStateAsync(CoreWebView2PermissionKind.Microphone, AssetResolver.Origin, CoreWebView2PermissionState.Default); }
        catch (Exception ex) when (ex is NotImplementedException or System.Runtime.InteropServices.COMException or ArgumentException) { Log.Error("Could not reset the microphone permission", ex); }
        Core.ContextMenuRequested += OnContextMenuRequested;
        Core.ProcessFailed += OnProcessFailed;
        Core.WebMessageReceived += OnWebMessageReceived;
        // A slideshow or video asking for full screen fills the whole screen, then the window comes back as it was.
        WindowState? beforeFull = null;
        Core.ContainsFullScreenElementChanged += (_, _) =>
        {
            if (Core.ContainsFullScreenElement)
            {
                beforeFull = WindowState;
                WindowStyle = WindowStyle.None;
                if (WindowState == WindowState.Maximized) WindowState = WindowState.Normal; // re-maximize to cover the taskbar
                WindowState = WindowState.Maximized;
            }
            else if (beforeFull is { } st)
            {
                WindowStyle = WindowStyle.SingleBorderWindow;
                WindowState = st;
                beforeFull = null;
            }
        };

        var boot = JsonSerializer.Serialize(new { theme = _settings.Prefs.Theme, background = ThemeCatalog.Get(_settings.Prefs.Theme).Bg }, SettingsStore.Json);
        await Core.AddScriptToExecuteOnDocumentCreatedAsync($"window.__NOORMD_BOOT__ = Object.freeze({boot});");
        Core.Navigate(AssetResolver.Origin + "/");
    }

    private void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        try
        {
            if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri)) return;
            if (e.Request.Method == "GET" && AssetResolver.IsAppUri(uri) && TryServeMedia(uri, e)) return;
            if (e.Request.Method == "GET" && AssetResolver.IsAppUri(uri) && TryServeHubIcon(uri, e, Core.Environment)) return;
            if (e.Request.Method == "GET" && AssetResolver.IsAppUri(uri) && TryServeVoice(uri, e, Core.Environment)) return;
            if (e.Request.Method == "GET" && AssetResolver.IsAppUri(uri) && TryServeVideo(uri, e, Core.Environment)) return;
            if (e.Request.Method == "GET" && AssetResolver.IsAppUri(uri) && TryServeGallery(uri, e, Core.Environment)) return;
            if (e.Request.Method == "GET" && AssetResolver.IsAppUri(uri) && TryServeSound(uri, e, Core.Environment)) return;
            if (e.Request.Method == "GET" && AssetResolver.IsAppUri(uri) && TryServeTexture(uri, e, Core.Environment)) return;
            if (e.Request.Method == "GET" && AssetResolver.IsAppUri(uri) && TryServeAsset(uri, e, Core.Environment)) return;
            if (e.Request.Method == "GET" && AssetResolver.IsAppUri(uri) && TryServeForge(uri, e, Core.Environment)) return;
            var file = e.Request.Method == "GET" ? AssetResolver.Resolve(uri, _webRoot, ActiveSession?.Folder, VaultRootFor(ActiveSession?.Path)) : null;
            if (file == null)
            {
                e.Response = Core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
                return;
            }
            if (AssetResolver.IsSprite(file))
            {
                // A sprite in a note, drawn by the app (small ones grown by whole steps): playing as a GIF, or one frame.
                // ?tag=walk plays a tag; ?frame=3 shows one frame (from 1); ?size=128 fits it in 128 pixels.
                var q = System.Web.HttpUtility.ParseQueryString(uri.Query);
                int? oneFrame = int.TryParse(q["frame"], out var fq) ? fq - 1 : null;
                var fit = int.TryParse(q["size"], out var sq) ? Math.Clamp(sq, 16, 1024) : 256;
                var shown = NoorMD.Core.Sprite.SpriteRender.ForNote(file, fit, q["tag"], oneFrame);
                e.Response = shown is not { } sh
                    ? Core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain")
                    : Core.Environment.CreateWebResourceResponse(new MemoryStream(sh.Bytes), 200, "OK", $"Content-Type: {sh.ContentType}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
                return;
            }
            var headers = $"Content-Type: {AssetResolver.ContentType(file)}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff";
            if (AssetResolver.IsAppPage(uri) || AssetResolver.IsSketchPage(uri))
                headers += "\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self'; connect-src 'self'; media-src 'self' blob: http://127.0.0.1:*; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
            e.Response = Core.Environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(file)), 200, "OK", headers);
        }
        catch (Exception ex)
        {
            Log.Error("Serving " + e.Request.Uri + " failed", ex);
            e.Response = Core.Environment.CreateWebResourceResponse(null, 500, "Error", "Content-Type: text/plain");
        }
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) && AssetResolver.IsAppPage(uri)) return;
        // The page itself never navigates away; anything else (a link that slipped past the page's
        // click handler, a dropped file) is cancelled and routed through the link policy.
        e.Cancel = true;
        var target = e.Uri;
        Dispatcher.BeginInvoke(async () => await HandleLinkAsync(target));
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            Log.Error($"Editor page failed to load: {e.WebErrorStatus}");
            ShowSplashError("The editor page could not be loaded", $"WebView2 reported: {e.WebErrorStatus}. Reinstalling NoorMD usually fixes this.", "Close", Close);
            return;
        }
        Web.Visibility = Visibility.Visible;
        Splash.Visibility = Visibility.Collapsed;
        Web.Focus();
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true; // never open popups
        var target = e.Uri;
        Dispatcher.BeginInvoke(async () => await HandleLinkAsync(target));
    }

    private static readonly HashSet<string> BrowserMenuItems = new(StringComparer.OrdinalIgnoreCase)
    {
        "back", "forward", "reload", "saveAs", "print", "createQrCode", "inspectElement", "viewPageSource", "share", "webCapture",
        "openLinkInNewWindow", "copyLinkLocation", "saveLinkAs", "saveImageAs", "openImageInNewWindow", "copyImageLocation", "saveMediaAs",
        "openLinkInNewTab", "openLinkInProfile", "readAloud", "translate", "searchWeb", "smartSelect",
    };

    internal static void OnContextMenuRequested(object? sender, CoreWebView2ContextMenuRequestedEventArgs e)
    {
        // Keep editing and spelling items; drop browser items (Back, Reload, Save as, Print, Inspect, link actions).
        var items = e.MenuItems;
        for (int i = items.Count - 1; i >= 0; i--)
            if (BrowserMenuItems.Contains(items[i].Name)) items.RemoveAt(i);
        for (int i = items.Count - 1; i > 0; i--)
            if (items[i].Kind == CoreWebView2ContextMenuItemKind.Separator && items[i - 1].Kind == CoreWebView2ContextMenuItemKind.Separator) items.RemoveAt(i);
        while (items.Count > 0 && items[0].Kind == CoreWebView2ContextMenuItemKind.Separator) items.RemoveAt(0);
        while (items.Count > 0 && items[^1].Kind == CoreWebView2ContextMenuItemKind.Separator) items.RemoveAt(items.Count - 1);
        if (items.Count == 0) e.Handled = true;
    }

    private void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        Log.Error($"WebView2 process failed: {e.ProcessFailedKind} ({e.Reason})");
        if (e.ProcessFailedKind is not (CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive or CoreWebView2ProcessFailedKind.BrowserProcessExited)) return;
        Dispatcher.BeginInvoke(() =>
        {
            var hasDraft = _tabs.Values.Any(s => s.Dirty && s.LastMarkdown != null);
            var msg = hasDraft
                ? "The editor stopped unexpectedly. Your text up to the last autosave (about a second before the problem) is safe in the recovery draft."
                : "The editor stopped unexpectedly. No unsaved changes were lost.";
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                ThemedDialog.ShowError(this, "The editor engine closed", msg + " Please restart NoorMD; your work will be offered for recovery.");
                return;
            }
            if (ThemedDialog.Confirm(this, "Reload the editor?", msg, "Reload editor")) Core.Reload();
        });
    }

    private void OnWebPreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        var mods = System.Windows.Input.Keyboard.Modifiers;
        if (!mods.HasFlag(System.Windows.Input.ModifierKeys.Control) || mods.HasFlag(System.Windows.Input.ModifierKeys.Alt)) return;
        var key = e.Key == System.Windows.Input.Key.System ? e.SystemKey : e.Key;
        string? cmd = key switch
        {
            System.Windows.Input.Key.Tab => mods.HasFlag(System.Windows.Input.ModifierKeys.Shift) ? "tab.prev" : "tab.next",
            System.Windows.Input.Key.PageDown when !mods.HasFlag(System.Windows.Input.ModifierKeys.Shift) => "tab.next",
            System.Windows.Input.Key.PageUp when !mods.HasFlag(System.Windows.Input.ModifierKeys.Shift) => "tab.prev",
            _ => null,
        };
        if (cmd == null || !_webReady) return;
        e.Handled = true;
        PushEvent("command", new { id = cmd });
    }

    // ------------------------------------------------------------------ chrome, placement, settings

    private void ShowSplashError(string title, string message, string action, Action onAction)
    {
        Web.Visibility = Visibility.Hidden;
        Splash.Visibility = Visibility.Visible;
        SplashTitle.Text = title;
        SplashText.Text = message;
        SplashAction.Content = action;
        SplashAction.Tag = onAction;
        SplashAction.Visibility = Visibility.Visible;
    }

    private void SplashAction_Click(object sender, RoutedEventArgs e) => (SplashAction.Tag as Action)?.Invoke();

    internal void UpdateWindowTitle()
    {
        var s = ActiveSession;
        var others = _tabs.Values.Count(t => t.Dirty && t != s);
        Title = s == null ? "NoorMD" : $"{(s.Dirty ? "● " : "")}{s.FileName}{(others > 0 ? $" (+{others} unsaved)" : "")} — NoorMD";
    }

    private void RestorePlacement()
    {
        var p = _settings.Window;
        if (p == null || p.Width < MinWidth || p.Height < MinHeight) return;
        var vs = new Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop, SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight);
        var r = new Rect(p.Left, p.Top, p.Width, p.Height);
        if (!vs.IntersectsWith(r) || r.Left < vs.Left - 40 || r.Top < vs.Top - 40) return; // monitor no longer present
        WindowStartupLocation = WindowStartupLocation.Manual;
        Left = p.Left; Top = p.Top; Width = p.Width; Height = p.Height;
        if (p.Maximized) WindowState = WindowState.Maximized;
    }

    private void CapturePlacement()
    {
        var r = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
        if (r.IsEmpty) return;
        _settings.Window = new WindowPlacement { Left = r.Left, Top = r.Top, Width = r.Width, Height = r.Height, Maximized = WindowState == WindowState.Maximized };
    }

    internal void ScheduleSettingsSave()
    {
        _settingsSaveTimer.Stop();
        _settingsSaveTimer.Start();
    }

    private void SaveSettingsNow()
    {
        _settingsSaveTimer.Stop();
        try
        {
            // An extra window never overwrites the main window's remembered tabs with its own stale copy.
            if (!_persistSession) _settings.Session = _settingsStore.Load().Session;
            _settingsStore.Save(_settings);
        }
        catch (Exception ex) { Log.Error("Saving settings failed", ex); }
    }

    // ------------------------------------------------------------------ closing

    private async void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (_closeConfirmed || App.SessionIsEnding || !_webReady) return;
        e.Cancel = true;
        if (!await _docGate.WaitAsync(0)) return; // a save/open dialog is already in progress
        try
        {
            if (!await ConfirmCloseWindowAsync()) return;
            if (!ConfirmCloseSketches()) return;
        }
        finally { _docGate.Release(); }
        try { _streamWindow?.Close(); } catch { /* NoorStream window goes with the main window */ }
        if (_streamWindow != null) { _streamWindow.Activate(); return; } // it asked about unsaved supporters and you kept it open
        try { _videoWindow?.Close(); } catch { /* the pop-out player goes with the main window */ }
        try { _overlay?.StopAsync().Wait(2000); } catch { /* the overlay server stops with the app */ }
        try { _radioRelay?.DisposeAsync().AsTask().Wait(1000); } catch { /* the radio relay stops with the app */ }
        _closeConfirmed = true;
        Close();
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        ShutdownMic();
        CapturePlacement();
        PersistSession();
        _vault?.Cts.Cancel();
        _vault?.Watcher?.Dispose();
        SaveSettingsNow();
        // Keep a tab's draft only if the user is leaving unsaved work behind (Windows shutdown, crash paths).
        foreach (var s in _tabs.Values)
            if (!s.Dirty) _recovery.DeleteOwn(s.TabId);
        _recovery.Dispose();
        try { Web.Dispose(); } catch { }
    }

    // ------------------------------------------------------------------ helpers

    private static System.Drawing.Color ToDrawing(System.Windows.Media.Color c) => System.Drawing.Color.FromArgb(c.A, c.R, c.G, c.B);

    internal static void OpenExternal(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) { Log.Error("Opening " + url + " failed", ex); }
    }
}
