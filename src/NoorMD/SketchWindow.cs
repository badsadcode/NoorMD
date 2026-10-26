using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Documents;
using NoorMD.Core.Security;
using NoorMD.Core.Settings;
using NoorMD.Core.Sketch;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// NoorSketch: a modeless drawing window. It has its own page (wwwroot/sketch.html) and its own bridge; it never
/// touches a document except through "Insert into document", which goes through the main window's rules.
/// Music, tabs and the editor carry on untouched while it is open.
/// </summary>
public sealed class SketchWindow : Window
{
    private const string SketchFilter = "NoorSketch (*.noorsketch)|*.noorsketch";
    private readonly MainWindow _main;
    private readonly WebView2 _web = new() { Visibility = Visibility.Hidden };
    private readonly string _webRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
    private string? _openPath;
    private string? _path;
    private bool _dirty;
    private string _name = "Untitled sketch";
    private bool _closeConfirmed;

    internal bool IsDirty => _dirty;
    internal string SketchName => _name;

    public SketchWindow(MainWindow main, string? openPath)
    {
        _main = main;
        _openPath = openPath;
        Title = "NoorSketch";
        Width = 1240; Height = 820; MinWidth = 700; MinHeight = 460;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        Content = new Grid { Children = { _web } };
        ThemeManager.Apply(main.CurrentTheme);
        Background = new System.Windows.Media.SolidColorBrush(ThemeManager.Background(main.CurrentTheme));
        SourceInitialized += (_, _) => ThemeManager.ApplyChrome(this);
        Loaded += async (_, _) => await InitAsync();
        Closing += OnClosing;
        Closed += (_, _) => { _main.SketchClosed(this); try { _web.Dispose(); } catch { } };
    }

    private async Task InitAsync()
    {
        try
        {
            _web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 20, 20, 28);
            await _web.EnsureCoreWebView2Async(_main.WebEnvironment);
        }
        catch (Exception ex)
        {
            Log.Error("NoorSketch could not start", ex);
            ThemedDialog.ShowError(this, "NoorSketch could not start", ex.Message);
            _closeConfirmed = true;
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
        s.IsReputationCheckingRequired = false;
        core.AddWebResourceRequestedFilter(AssetResolver.Origin + "/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, e) =>
        {
            if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri)) return;
            var file = e.Request.Method == "GET" && uri.AbsolutePath.StartsWith(AssetResolver.AppPrefix, StringComparison.Ordinal) ? AssetResolver.Resolve(uri, _webRoot, null) : null;
            if (file == null) { e.Response = core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain"); return; }
            var headers = $"Content-Type: {AssetResolver.ContentType(file)}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff";
            if (AssetResolver.IsSketchPage(uri)) headers += "\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
            e.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(file)), 200, "OK", headers);
        };
        core.NavigationStarting += (_, e) => { if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var u) || !AssetResolver.IsSketchPage(u)) e.Cancel = true; };
        core.NavigationCompleted += (_, e) => { _web.Visibility = Visibility.Visible; _web.Focus(); };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.DownloadStarting += (_, e) => e.Cancel = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.ContextMenuRequested += MainWindow.OnContextMenuRequested;
        core.WebMessageReceived += OnMessage;
        var boot = JsonSerializer.Serialize(new { theme = _main.CurrentTheme, background = ThemeCatalog.Get(_main.CurrentTheme).Bg }, SettingsStore.Json);
        await core.AddScriptToExecuteOnDocumentCreatedAsync($"window.__NOORMD_BOOT__ = Object.freeze({boot});");
        core.Navigate(AssetResolver.Origin + AssetResolver.SketchPagePath);
    }

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || !AssetResolver.IsSketchPage(source)) return;
        if (!BridgeProtocol.TryParse(e.WebMessageAsJson, out var req, out var error) || req == null) { Log.Error("Rejected sketch message: " + error); return; }
        try
        {
            var result = await DispatchAsync(req);
            if (req.Id is long id) Post(BridgeProtocol.Reply(id, result));
        }
        catch (Exception ex)
        {
            if (ex is not (InvalidDataException or IOException or UnauthorizedAccessException or InvalidOperationException)) Log.Error($"Sketch request {req.Type} failed", ex);
            if (req.Id is long id) Post(BridgeProtocol.ReplyError(id, ex.Message));
        }
    }

    private void Post(string json)
    {
        try { _web.CoreWebView2?.PostWebMessageAsJson(json); } catch (Exception ex) { Log.Error("Posting to NoorSketch failed", ex); }
    }

    private static byte[] PngFrom(BridgeRequest req)
    {
        var b64 = req.GetString("png", 400_000_000) ?? throw new InvalidOperationException("No image was sent.");
        var png = Convert.FromBase64String(b64);
        var (w, h) = SketchFile.PngSize(png);
        if (SketchFile.SizeProblem(w, h) is { } problem) throw new InvalidDataException(problem);
        return png;
    }

    private async Task<object?> DispatchAsync(BridgeRequest req)
    {
        switch (req.Type)
        {
            case "sketch.ready":
                if (_openPath is { } open)
                {
                    _openPath = null;
                    return new { file = LoadPayload(open) };
                }
                return new { width = 1920, height = 1080, background = "white" };
            case "sketch.dirty":
                _dirty = Json.IsTrue(req.Payload, "dirty");
                _name = req.GetString("name", 200) ?? _name;
                Title = (_dirty ? "● " : "") + _name + " — NoorSketch";
                return null;
            case "sketch.save":
                {
                    var png = PngFrom(req);
                    var path = _path;
                    if (path == null || Json.IsTrue(req.Payload, "saveAs"))
                    {
                        var dlg = new SaveFileDialog { Title = "Save sketch", Filter = SketchFilter, DefaultExt = ".noorsketch", AddExtension = true, OverwritePrompt = true, FileName = DocumentFile.SafeFileName(_name, ".noorsketch"), InitialDirectory = DefaultFolder() };
                        if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                        path = dlg.FileName;
                    }
                    var bg = req.GetString("background", 20) ?? "white";
                    await Task.Run(() => SketchFile.Save(path, png, bg));
                    _path = path;
                    _name = Path.GetFileNameWithoutExtension(path);
                    return new { path, name = _name };
                }
            case "sketch.open":
                {
                    var dlg = new OpenFileDialog { Title = "Open sketch", Filter = SketchFilter, CheckFileExists = true, InitialDirectory = DefaultFolder() };
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    return LoadPayload(dlg.FileName);
                }
            case "sketch.exportPng":
                {
                    var png = PngFrom(req);
                    var dlg = new SaveFileDialog { Title = "Export PNG", Filter = "PNG image (*.png)|*.png", DefaultExt = ".png", AddExtension = true, OverwritePrompt = true, FileName = DocumentFile.SafeFileName(req.GetString("name", 200) ?? _name, ".png"), InitialDirectory = DefaultFolder() };
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    await Task.Run(() => AtomicFile.WriteAllBytes(dlg.FileName, png));
                    return new { path = dlg.FileName };
                }
            case "sketch.insert":
                return await _main.InsertSketchAsync(PngFrom(req), req.GetString("background", 20) ?? "white", Json.IsTrue(req.Payload, "withSource"), req.GetString("name", 200) ?? _name, this);
            case "sketch.closeNow":
                _closeConfirmed = true;
                Close();
                return null;
            default:
                throw new InvalidOperationException($"Unknown command \"{req.Type}\".");
        }
    }

    private object LoadPayload(string path)
    {
        var (png, m) = SketchFile.Load(path);
        _path = path;
        _name = Path.GetFileNameWithoutExtension(path);
        return new { png = Convert.ToBase64String(png), background = m.Background, path, name = _name };
    }

    private string DefaultFolder() =>
        _path != null ? Path.GetDirectoryName(_path)! : Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (_closeConfirmed || !_dirty || App.SessionIsEnding) return;
        e.Cancel = true;
        var choice = ThemedDialog.Show(this, $"Save changes to “{_name}”?", "Your drawing will be lost if you close without saving.",
            [new DialogButton("Cancel", "cancel", Cancel: true), new DialogButton("Don't save", "discard"), new DialogButton("Save", "save", Primary: true)]);
        if (choice == "discard") { _closeConfirmed = true; Dispatcher.BeginInvoke(Close); }
        else if (choice == "save") Post(BridgeProtocol.Event("sketch.saveAndClose", new { }));
    }

    /// <summary>For the self-test: the page's exact pixels as PNG, through the page's own encoder.</summary>
    internal async Task<string> EvalAsync(string script) => await _web.CoreWebView2.ExecuteScriptAsync(script);

    internal void CloseWithoutPrompt() { _closeConfirmed = true; Close(); }
}
