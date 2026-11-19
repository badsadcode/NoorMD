using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shell;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Text.Json.Nodes;
using Noor.Contracts;
using NoorMD3.Host;

namespace NoorMD3;

/// <summary>
/// NoorMD 3.0's window (from the title bar test, spikes/NoorMD3.TitleBar): a window with no Windows frame. A web page (WebView2) fills it and draws the title bar
/// (logo, menu, title, now playing); dragging, double-click and the system menu come from WebView2's
/// <c>app-region: drag</c> support. The three window buttons are native: a hole is cut in the web view where they
/// are, and the window answers Windows' hit test there with HTMINBUTTON / HTMAXBUTTON / HTCLOSE, which is what
/// makes Windows 11 show snap layouts when you hover over maximise.
/// </summary>
public sealed class ShellWindow : Window
{
    const double TitleHeight = 38;   // the page's title bar, in DIPs
    const double ButtonWidth = 46;
    const double Edge = 5;           // the resize border around the page while not maximised

    readonly Grid _root = new();
    readonly WebView2 _web = new();
    readonly StackPanel _buttons = new() { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top };
    readonly Border _min, _max, _close;
    readonly TextBlock _maxGlyph;
    Brush _fg = Brushes.White, _hover = new SolidColorBrush(Color.FromArgb(0x22, 0xFF, 0xFF, 0xFF)), _pressed = new SolidColorBrush(Color.FromArgb(0x33, 0xFF, 0xFF, 0xFF));
    readonly Brush _closeHover = new SolidColorBrush(Color.FromRgb(0xC4, 0x2B, 0x1C));
    IntPtr _hwnd;
    int _hot, _down;                 // the hit-test code under the mouse / pressed (HTMINBUTTON, HTMAXBUTTON, HTCLOSE or 0)
    bool _trackingLeave;
    bool _webReady;
    ShellRouter? _router;
    ShellAssets? _assets;
    const string Origin = "https://noormd3.app";
    static readonly string DataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NoorMD3");

    public ShellWindow()
    {
        Title = "NoorMD";
        Width = 1200; Height = 760; MinWidth = 520; MinHeight = 320;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = new SolidColorBrush(Color.FromRgb(0x0B, 0x0D, 0x12));
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.CanResize;
        WindowChrome.SetWindowChrome(this, new WindowChrome
        {
            CaptionHeight = 0,                      // the page is the caption (app-region: drag)
            ResizeBorderThickness = new Thickness(Edge),
            GlassFrameThickness = new Thickness(0, 0, 0, 1),   // keeps the DWM shadow
            CornerRadius = new CornerRadius(0),
            UseAeroCaptionButtons = false,
        });

        _min = MakeButton("", "Minimise");
        _maxGlyph = new TextBlock();
        _max = MakeButton("", "Maximise", _maxGlyph);
        _close = MakeButton("", "Close");
        _buttons.Children.Add(_min); _buttons.Children.Add(_max); _buttons.Children.Add(_close);

        _root.Children.Add(_web);
        _root.Children.Add(_buttons);
        Content = _root;
        Layout();

        SizeChanged += (_, _) => Later(ApplyHole);
        StateChanged += (_, _) => { Layout(); Later(ApplyHole); SendState(); };
        DpiChanged += (_, _) => { Later(ApplyHole); SendState(); };
        Loaded += async (_, _) => await StartWeb();
    }

    // ------------------------------------------------------------------ layout
    Border MakeButton(string glyph, string name, TextBlock? text = null)
    {
        text ??= new TextBlock();
        text.Text = glyph;
        text.FontFamily = new FontFamily("Segoe Fluent Icons, Segoe MDL2 Assets");
        text.FontSize = 10;
        text.HorizontalAlignment = HorizontalAlignment.Center;
        text.VerticalAlignment = VerticalAlignment.Center;
        text.Foreground = _fg;
        var b = new Border { Width = ButtonWidth, Background = Brushes.Transparent, Child = text, ToolTip = name };
        System.Windows.Automation.AutomationProperties.SetName(b, name);
        return b;
    }

    /// <summary>Maximised, a frameless window overhangs the screen by its resize border: the content is pulled in by that much.</summary>
    Thickness Overhang => WindowState == WindowState.Maximized ? SystemParameters.WindowResizeBorderThickness : new Thickness(0);

    void Layout()
    {
        var max = WindowState == WindowState.Maximized;
        var o = Overhang;
        _web.Margin = max ? o : new Thickness(Edge);
        // The buttons reach the window's top and right edge (easy to hit), and are as tall as the page's title bar.
        _buttons.Margin = new Thickness(0, o.Top, o.Right, 0);
        foreach (Border b in _buttons.Children) b.Height = TitleHeight + (max ? 0 : Edge);
        _maxGlyph.Text = max ? "" : "";
        _max.ToolTip = max ? "Restore" : "Maximise";
    }

    static void Later(Action a) => Application.Current?.Dispatcher.BeginInvoke(a, System.Windows.Threading.DispatcherPriority.Render);

    /// <summary>The hole in the web view where the native buttons show (in the web view's own pixels).</summary>
    Rect HoleInWeb()
    {
        if (_web.ActualWidth <= 0) return Rect.Empty;
        var r = _buttons.TransformToVisual(_web).TransformBounds(new Rect(_buttons.RenderSize));
        r.Intersect(new Rect(0, 0, _web.ActualWidth, _web.ActualHeight));
        return r;
    }

    void ApplyHole()
    {
        var host = _web.Handle;
        if (host == IntPtr.Zero) return;
        var dpi = VisualTreeHelper.GetDpi(this);
        var hole = HoleInWeb();
        int w = (int)Math.Ceiling(_web.ActualWidth * dpi.DpiScaleX), h = (int)Math.Ceiling(_web.ActualHeight * dpi.DpiScaleY);
        var rgn = CreateRectRgn(0, 0, w, h);
        if (!hole.IsEmpty)
        {
            var cut = CreateRectRgn((int)Math.Floor(hole.Left * dpi.DpiScaleX), (int)Math.Floor(hole.Top * dpi.DpiScaleY), (int)Math.Ceiling(hole.Right * dpi.DpiScaleX) + 1, (int)Math.Ceiling(hole.Bottom * dpi.DpiScaleY));
            CombineRgn(rgn, rgn, cut, 4 /* RGN_DIFF */);
            DeleteObject(cut);
        }
        SetWindowRgn(host, rgn, true);   // the system owns rgn from here
        SendState();
    }

    // ------------------------------------------------------------------ the web page
    async Task StartWeb()
    {
        try
        {
            // The benches: every *.Bench.dll beside the app (stage 1: built and shipped with it).
            foreach (var dll in Directory.EnumerateFiles(AppContext.BaseDirectory, "*.Bench.dll"))
                try { System.Reflection.Assembly.LoadFrom(dll); } catch (Exception ex) when (ex is BadImageFormatException or FileLoadException) { }
            var registry = BenchRegistry.FromAssemblies(AppDomain.CurrentDomain.GetAssemblies().Where(a => a.GetName().Name?.EndsWith(".Bench", StringComparison.Ordinal) == true));
            _router = new ShellRouter(registry, Path.Combine(DataRoot, "settings.json"), id => new BenchHost(this, id)) { Window = WindowCommand };
            _assets = new ShellAssets(Path.Combine(AppContext.BaseDirectory, "wwwroot"), registry);

            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(DataRoot, "WebView2"));
            _web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 0x0B, 0x0D, 0x12);
            await _web.EnsureCoreWebView2Async(env);
            var core = _web.CoreWebView2;
            core.Settings.IsNonClientRegionSupportEnabled = true;   // app-region: drag in the page
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false; // F5, Ctrl+P… belong to the app
            core.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += OnResource;
            core.NewWindowRequested += (_, e) => e.Handled = true;  // no stray browser windows
            core.WebMessageReceived += OnMessage;
            core.NavigationCompleted += (_, _) => { _webReady = true; ApplyHole(); };
            core.Navigate(Origin + "/index.html");
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "NoorMD couldn't start its page (WebView2): " + ex.Message, "NoorMD");
        }
    }

    /// <summary>The page's files: the shell's own and each bench's (from its DLL); nothing else is served.</summary>
    void OnResource(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var uri = new Uri(e.Request.Uri);
        var found = _assets?.Open(uri.AbsolutePath);
        e.Response = found is { } f
            ? _web.CoreWebView2.Environment.CreateWebResourceResponse(f.Body, 200, "OK", $"Content-Type: {f.ContentType}\r\nCache-Control: no-cache")
            : _web.CoreWebView2.Environment.CreateWebResourceResponse(null, 404, "Not Found", "");
    }

    async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (_router == null) return;
        if (!string.Equals(new Uri(e.Source).GetLeftPart(UriPartial.Authority), Origin, StringComparison.OrdinalIgnoreCase)) return;   // only our page
        using var doc = JsonDocument.Parse(e.WebMessageAsJson);
        var reply = await _router.HandleAsync(doc.RootElement);
        if (_web.CoreWebView2 != null) _web.CoreWebView2.PostWebMessageAsJson(reply.ToJsonString());
    }

    /// <summary>What the page asks of the window: its buttons' colours, its title, minimise / maximise / close.</summary>
    JsonNode? WindowCommand(string cmd, JsonElement m)
    {
        switch (cmd)
        {
            case "theme":
                Background = Parse(m, "bg", Background);
                _fg = Parse(m, "fg", _fg); _hover = Parse(m, "hover", _hover); _pressed = Parse(m, "pressed", _pressed);
                foreach (Border b in _buttons.Children) ((TextBlock)b.Child).Foreground = _fg;
                Paint();
                if (Background is SolidColorBrush sb) _web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, sb.Color.R, sb.Color.G, sb.Color.B);
                break;
            case "title": if (m.TryGetProperty("text", out var t) && t.GetString() is { } text) Title = text.Length > 200 ? text[..200] : text; break;
            case "minimize": WindowState = WindowState.Minimized; break;
            case "toggleMax": WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized; break;
            case "close": Close(); break;
            default: throw new BenchException($"The window has no command \"{cmd}\".");
        }
        return null;
    }

    /// <summary>A bench's way back to its page (events), and its own data folder.</summary>
    sealed class BenchHost(ShellWindow w, string id) : IBenchHost
    {
        public string DataFolder { get { var d = Path.Combine(DataRoot, "benches", id); Directory.CreateDirectory(d); return d; } }
        public void Post(string name, object? payload = null) =>
            w.Dispatcher.BeginInvoke(() => w._web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { @event = "bench", bench = id, name, payload })));
        public void Log(string message) => System.Diagnostics.Debug.WriteLine($"[{id}] {message}");
    }

    static Brush Parse(JsonElement m, string key, Brush fallback)
    {
        if (!m.TryGetProperty(key, out var v) || v.GetString() is not string s) return fallback;
        try { var b = (Brush)new BrushConverter().ConvertFromString(s)!; b.Freeze(); return b; } catch { return fallback; }
    }

    void SendState()
    {
        if (!_webReady || _web.CoreWebView2 == null) return;
        var hole = HoleInWeb();
        _web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { @event = "window", maximized = WindowState == WindowState.Maximized, buttonsWidth = hole.IsEmpty ? 0 : hole.Width }));
    }

    // ------------------------------------------------------------------ Windows' hit test: the native buttons
    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);   // WindowChrome hooks in here; a hook added later is asked first
        _hwnd = new WindowInteropHelper(this).Handle;
        HwndSource.FromHwnd(_hwnd)!.AddHook(WndProc);
        int round = 2; // DWMWCP_ROUND: Windows 11's rounded corners for a frameless window
        DwmSetWindowAttribute(_hwnd, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, ref round, sizeof(int));
    }

    const int HTMINBUTTON = 8, HTMAXBUTTON = 9, HTCLOSE = 20;

    int HitButton(IntPtr lParam)
    {
        var screen = new Point((short)((long)lParam & 0xFFFF), (short)(((long)lParam >> 16) & 0xFFFF));
        Point p;
        try { p = PointFromScreen(screen); } catch (InvalidOperationException) { return 0; }
        // Leave the window's outer edge to resizing (top and right) while it isn't maximised.
        if (WindowState != WindowState.Maximized && (p.Y < Edge || p.X > ActualWidth - Edge)) return 0;
        foreach (var (b, code) in new[] { (_min, HTMINBUTTON), (_max, HTMAXBUTTON), (_close, HTCLOSE) })
        {
            var r = b.TransformToAncestor(this).TransformBounds(new Rect(b.RenderSize));
            if (r.Contains(p)) return code;
        }
        return 0;
    }

    IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        switch (msg)
        {
            case 0x0084: // WM_NCHITTEST
            {
                var hit = HitButton(lParam);
                if (hit != 0) { handled = true; return (IntPtr)hit; }
                break;
            }
            case 0x00A0: // WM_NCMOUSEMOVE
            {
                var hit = (int)wParam;
                var code = hit is HTMINBUTTON or HTMAXBUTTON or HTCLOSE ? hit : 0;
                if (code != _hot) { _hot = code; Paint(); }
                if (!_trackingLeave && code != 0)
                {
                    var t = new TRACKMOUSEEVENT { cbSize = (uint)Marshal.SizeOf<TRACKMOUSEEVENT>(), dwFlags = 0x2 | 0x10 /* TME_LEAVE | TME_NONCLIENT */, hwndTrack = hwnd };
                    _trackingLeave = TrackMouseEvent(ref t);
                }
                break;
            }
            case 0x02A2: // WM_NCMOUSELEAVE
                _trackingLeave = false;
                if (_hot != 0 || _down != 0) { _hot = 0; _down = 0; Paint(); }
                break;
            case 0x00A1: // WM_NCLBUTTONDOWN
            case 0x00A3: // WM_NCLBUTTONDBLCLK
            {
                var hit = (int)wParam;
                if (hit is HTMINBUTTON or HTMAXBUTTON or HTCLOSE) { _down = hit; Paint(); handled = true; return IntPtr.Zero; }   // no classic button drawn
                break;
            }
            case 0x00A2: // WM_NCLBUTTONUP
            {
                var hit = (int)wParam;
                if (hit is HTMINBUTTON or HTMAXBUTTON or HTCLOSE)
                {
                    handled = true;
                    var was = _down; _down = 0; Paint();
                    if (was == hit)
                    {
                        if (hit == HTMINBUTTON) WindowState = WindowState.Minimized;
                        else if (hit == HTMAXBUTTON) WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
                        else Close();
                    }
                    return IntPtr.Zero;
                }
                break;
            }
        }
        return IntPtr.Zero;
    }

    void Paint()
    {
        void Set(Border b, int code)
        {
            var hot = _hot == code; var down = _down == code;
            if (code == HTCLOSE)
            {
                b.Background = hot || down ? _closeHover : Brushes.Transparent;
                ((TextBlock)b.Child).Foreground = hot || down ? Brushes.White : _fg;
            }
            else b.Background = down ? _pressed : hot ? _hover : Brushes.Transparent;
        }
        Set(_min, HTMINBUTTON); Set(_max, HTMAXBUTTON); Set(_close, HTCLOSE);
    }

    void ShowSystemMenu()
    {
        GetCursorPos(out var pt);
        var menu = GetSystemMenu(_hwnd, false);
        var cmd = TrackPopupMenu(menu, 0x0100 /* TPM_RETURNCMD */, pt.X, pt.Y, 0, _hwnd, IntPtr.Zero);
        if (cmd != 0) PostMessage(_hwnd, 0x0112 /* WM_SYSCOMMAND */, (IntPtr)cmd, IntPtr.Zero);
    }

    // ------------------------------------------------------------------ Win32
    [StructLayout(LayoutKind.Sequential)] struct TRACKMOUSEEVENT { public uint cbSize; public uint dwFlags; public IntPtr hwndTrack; public uint dwHoverTime; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [DllImport("user32.dll")] static extern bool TrackMouseEvent(ref TRACKMOUSEEVENT e);
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, int msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetSystemMenu(IntPtr hwnd, bool revert);
    [DllImport("user32.dll")] static extern int TrackPopupMenu(IntPtr menu, uint flags, int x, int y, int reserved, IntPtr hwnd, IntPtr rect);
    [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr hwnd, IntPtr rgn, bool redraw);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int l, int t, int r, int b);
    [DllImport("gdi32.dll")] static extern int CombineRgn(IntPtr dst, IntPtr a, IntPtr b, int mode);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}
