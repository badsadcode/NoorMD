using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using NoorMD.Core.Stream;

namespace NoorMD;

/// <summary>
/// Mic Guard's floating indicator: a small always-on-top badge (LIVE / MUTED / CHECK) that never takes focus from a
/// game, can be dragged anywhere, and is left out of screen capture so OBS doesn't record it. Click to mute/unmute;
/// right-click for the menu. Plain WPF (no browser) so it stays light while gaming.
/// </summary>
public sealed class MicIndicatorWindow : Window
{
    private readonly MainWindow _main;
    private readonly Border _badge = new() { CornerRadius = new CornerRadius(14), Padding = new Thickness(12, 7, 14, 7), BorderThickness = new Thickness(2) };
    private readonly System.Windows.Shapes.Ellipse _dot = new() { Width = 12, Height = 12, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _label = new() { FontWeight = FontWeights.Bold, FontSize = 15, Foreground = Brushes.White, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _detail = new() { FontSize = 10.5, Foreground = new SolidColorBrush(Color.FromArgb(0xD0, 0xFF, 0xFF, 0xFF)), Margin = new Thickness(10, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
    private readonly ScaleTransform _scale = new(1, 1);
    private bool _hideFromCapture = true;

    /// <summary>True when Windows accepted "exclude from capture" (Windows 10 2004 or newer).</summary>
    public bool ExcludedFromCapture { get; private set; }

    public MicIndicatorWindow(MainWindow main)
    {
        _main = main;
        Title = Tr.T("Mic Guard — NoorMD");
        WindowStyle = WindowStyle.None;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ResizeMode = ResizeMode.NoResize;
        SizeToContent = SizeToContent.WidthAndHeight;
        Topmost = true;
        ShowInTaskbar = false;
        ShowActivated = false;
        FontFamily = new FontFamily("Segoe UI");
        _badge.Child = new StackPanel { Orientation = Orientation.Horizontal, Children = { _dot, _label, _detail } };
        _badge.LayoutTransform = _scale;
        _badge.Effect = new System.Windows.Media.Effects.DropShadowEffect { BlurRadius = 10, ShadowDepth = 1, Opacity = 0.5 };
        Content = new Border { Padding = new Thickness(6), Child = _badge };
        Cursor = Cursors.Hand;
        MouseLeftButtonDown += OnLeftDown;
        MouseRightButtonUp += (_, e) => { e.Handled = true; ShowMenu(); };
        SourceInitialized += (_, _) => ApplyStyles();
        LocationChanged += (_, _) => _main.MicIndicatorMoved(Left, Top);
        SetState(MicVerdict.NotSetUp, "", "");
    }

    public void SetState(MicVerdict verdict, string detail, string tooltip)
    {
        var (bg, edge) = verdict switch
        {
            MicVerdict.Live => (Color.FromRgb(0xD9, 0x2D, 0x3F), Color.FromRgb(0xFF, 0x7A, 0x88)),
            MicVerdict.Muted => (Color.FromRgb(0x3A, 0x3F, 0x4B), Color.FromRgb(0x6B, 0x72, 0x80)),
            MicVerdict.Mismatch => (Color.FromRgb(0xC2, 0x6A, 0x00), Color.FromRgb(0xFF, 0xC1, 0x4D)),
            _ => (Color.FromRgb(0x2B, 0x2E, 0x36), Color.FromRgb(0x55, 0x5B, 0x66)),
        };
        _badge.Background = new SolidColorBrush(Color.FromArgb(0xEE, bg.R, bg.G, bg.B));
        _badge.BorderBrush = new SolidColorBrush(edge);
        _dot.Fill = verdict == MicVerdict.Live ? Brushes.White : new SolidColorBrush(edge);
        _label.Text = verdict == MicVerdict.Muted ? "🎙 MUTED" : "🎙 " + MicGuard.Label(verdict);
        _detail.Text = detail;
        _detail.Visibility = string.IsNullOrEmpty(detail) ? Visibility.Collapsed : Visibility.Visible;
        ToolTip = tooltip + "\nClick: mute / unmute · Right-click: menu · Drag to move";
    }

    public void Configure(double opacity, double scale, bool hideFromCapture)
    {
        Opacity = Math.Clamp(opacity, 0.2, 1);
        _scale.ScaleX = _scale.ScaleY = Math.Clamp(scale, 0.6, 2.5);
        _hideFromCapture = hideFromCapture;
        if (IsLoaded || new WindowInteropHelper(this).Handle != IntPtr.Zero) ApplyStyles();
    }

    private void ApplyStyles()
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;
        // Never steal focus from a game; stay out of Alt+Tab.
        var ex = GetWindowLong(hwnd, -20);
        SetWindowLong(hwnd, -20, ex | 0x08000000 /* WS_EX_NOACTIVATE */ | 0x80 /* WS_EX_TOOLWINDOW */);
        ExcludedFromCapture = _hideFromCapture && SetWindowDisplayAffinity(hwnd, 0x11 /* WDA_EXCLUDEFROMCAPTURE */);
        if (!_hideFromCapture) SetWindowDisplayAffinity(hwnd, 0 /* WDA_NONE */);
    }

    private void OnLeftDown(object sender, MouseButtonEventArgs e)
    {
        var (x, y) = (Left, Top);
        try { DragMove(); } catch (InvalidOperationException) { return; }
        if (Math.Abs(Left - x) < 3 && Math.Abs(Top - y) < 3) _main.MicToggleFromIndicator();
    }

    private void ShowMenu()
    {
        var menu = new ContextMenu();
        void Add(string header, Action run) { var i = new MenuItem { Header = header }; i.Click += (_, _) => run(); menu.Items.Add(i); }
        Add("Mute everywhere", () => _main.MicSetFromIndicator(true));
        Add("Unmute everywhere", () => _main.MicSetFromIndicator(false));
        menu.Items.Add(new Separator());
        Add("Mic Guard settings…", () => _main.ShowMicSettings());
        Add("Hide indicator", () => _main.HideMicIndicator());
        menu.PlacementTarget = this;
        menu.IsOpen = true;
    }

    [DllImport("user32.dll")] private static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] private static extern int SetWindowLong(IntPtr hwnd, int index, int value);
}
