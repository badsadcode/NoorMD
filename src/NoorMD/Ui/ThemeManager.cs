using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace NoorMD.Ui;

/// <summary>Keeps the native window chrome, WPF dialogs and the WebView background on the same theme.</summary>
internal static class ThemeManager
{
    public static string Current { get; private set; } = "dark";

    public static Color Background(string theme) => theme == "light" ? Rgb(0xF3F5F9) : Rgb(0x0B0D12);
    public static Color Panel(string theme) => theme == "light" ? Rgb(0xFFFFFF) : Rgb(0x11151D);

    public static void Apply(string theme)
    {
        Current = theme == "light" ? "light" : "dark";
        var light = Current == "light";
        var res = Application.Current.Resources;
        res["BgBrush"] = Freeze(Background(Current));
        res["PanelBrush"] = Freeze(Panel(Current));
        res["SurfaceBrush"] = Freeze(light ? Rgb(0xF7F8FB) : Rgb(0x181E29));
        res["Surface2Brush"] = Freeze(light ? Rgb(0xE9EDF4) : Rgb(0x212837));
        res["LineBrush"] = Freeze(light ? Rgb(0xDAE0E9) : Rgb(0x2A3240));
        res["TextBrush"] = Freeze(light ? Rgb(0x202838) : Rgb(0xE9EDF5));
        res["MutedBrush"] = Freeze(light ? Rgb(0x5F6B80) : Rgb(0x8996AA));
        res["AccentBrush"] = Freeze(light ? Rgb(0x6A4ED0) : Rgb(0xB19AFF));
        res["OnAccentBrush"] = Freeze(light ? Rgb(0xFFFFFF) : Rgb(0x211835));
        foreach (Window w in Application.Current.Windows) ApplyChrome(w);
    }

    /// <summary>Dark/light title bar (Windows 10 2004+) and matching caption/border colours (Windows 11).</summary>
    public static void ApplyChrome(Window window)
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        if (hwnd == IntPtr.Zero) return;
        var dark = Current == "dark" ? 1 : 0;
        if (DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int)) != 0)
            DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE_OLD, ref dark, sizeof(int));
        var panel = Panel(Current);
        int caption = panel.R | (panel.G << 8) | (panel.B << 16);
        DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, ref caption, sizeof(int));
        var line = Current == "dark" ? Rgb(0x2A3240) : Rgb(0xDAE0E9);
        int border = line.R | (line.G << 8) | (line.B << 16);
        DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ref border, sizeof(int));
        window.Background = new SolidColorBrush(Background(Current));
    }

    private static Color Rgb(int rgb) => Color.FromRgb((byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb);
    private static SolidColorBrush Freeze(Color c) { var b = new SolidColorBrush(c); b.Freeze(); return b; }

    private const int DWMWA_USE_IMMERSIVE_DARK_MODE_OLD = 19;
    private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    private const int DWMWA_BORDER_COLOR = 34;
    private const int DWMWA_CAPTION_COLOR = 35;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}
