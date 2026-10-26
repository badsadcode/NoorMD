using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using NoorMD.Core.Settings;

namespace NoorMD.Ui;

/// <summary>Keeps the native window chrome, WPF dialogs and the WebView background on the same theme.</summary>
internal static class ThemeManager
{
    public static ThemeInfo Current { get; private set; } = ThemeCatalog.All[0];

    public static Color Background(string theme) => Hex(ThemeCatalog.Get(theme).Bg);
    public static Color Panel(string theme) => Hex(ThemeCatalog.Get(theme).Panel);

    public static void Apply(string theme)
    {
        var t = Current = ThemeCatalog.Get(theme);
        var res = Application.Current.Resources;
        res["BgBrush"] = Freeze(Hex(t.Bg));
        res["PanelBrush"] = Freeze(Hex(t.Panel));
        res["SurfaceBrush"] = Freeze(Hex(t.Surface));
        res["Surface2Brush"] = Freeze(Hex(t.Surface2));
        res["LineBrush"] = Freeze(Hex(t.Border));
        res["TextBrush"] = Freeze(Hex(t.Text));
        res["MutedBrush"] = Freeze(Hex(t.Muted));
        res["AccentBrush"] = Freeze(Hex(t.Accent));
        res["OnAccentBrush"] = Freeze(Hex(t.OnAccent));
        foreach (Window w in Application.Current.Windows) ApplyChrome(w);
    }

    /// <summary>Dark/light title bar (Windows 10 2004+) and matching caption/border colours (Windows 11).</summary>
    public static void ApplyChrome(Window window)
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        if (hwnd == IntPtr.Zero) return;
        var dark = Current.IsDark ? 1 : 0;
        if (DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int)) != 0)
            DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE_OLD, ref dark, sizeof(int));
        var panel = Hex(Current.Panel);
        int caption = panel.R | (panel.G << 8) | (panel.B << 16);
        DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, ref caption, sizeof(int));
        var line = Hex(Current.Border);
        int border = line.R | (line.G << 8) | (line.B << 16);
        DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ref border, sizeof(int));
        window.Background = new SolidColorBrush(Hex(Current.Bg));
    }

    private static Color Hex(string hex) => (Color)ColorConverter.ConvertFromString(hex);
    private static SolidColorBrush Freeze(Color c) { var b = new SolidColorBrush(c); b.Freeze(); return b; }

    private const int DWMWA_USE_IMMERSIVE_DARK_MODE_OLD = 19;
    private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    private const int DWMWA_BORDER_COLOR = 34;
    private const int DWMWA_CAPTION_COLOR = 35;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}
