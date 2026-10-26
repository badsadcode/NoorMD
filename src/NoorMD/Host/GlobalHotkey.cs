using System.Runtime.InteropServices;
using System.Windows.Input;
using System.Windows.Interop;

namespace NoorMD.Host;

/// <summary>
/// One system-wide hotkey (RegisterHotKey), so Mic Guard works while a game or OBS has focus. Windows refuses a key
/// another program already registered; that is reported instead of silently not working.
/// </summary>
public sealed class GlobalHotkey : IDisposable
{
    private const int WmHotkey = 0x0312;
    private const int Id = 0x4E4D; // "NM"
    private readonly HwndSource _source;
    private readonly Action _pressed;
    private bool _registered;

    public string? Gesture { get; private set; }

    public GlobalHotkey(IntPtr hwnd, Action pressed)
    {
        _source = HwndSource.FromHwnd(hwnd) ?? throw new InvalidOperationException("No window handle.");
        _pressed = pressed;
        _source.AddHook(Hook);
    }

    /// <summary>Registers e.g. "Ctrl+Alt+M" or "Ctrl+Shift+F9" (null/empty clears). Returns an error to show, or null.</summary>
    public string? Set(string? gesture)
    {
        Clear();
        if (string.IsNullOrWhiteSpace(gesture)) return null;
        if (!TryParse(gesture, out var mods, out var vk, out var error)) return error;
        if (!RegisterHotKey(_source.Handle, Id, mods | 0x4000 /* MOD_NOREPEAT */, vk))
            return $"{gesture} is already used by another program. Choose another key.";
        _registered = true;
        Gesture = gesture;
        return null;
    }

    public void Clear()
    {
        if (_registered) UnregisterHotKey(_source.Handle, Id);
        _registered = false;
        Gesture = null;
    }

    /// <summary>Parses "Ctrl+Alt+Shift+Win+Key" using WPF key names (M, F9, D1, NumPad1, Pause, Scroll…).</summary>
    public static bool TryParse(string gesture, out uint modifiers, out uint vk, out string? error)
    {
        modifiers = 0; vk = 0; error = null;
        Key? key = null;
        foreach (var part in gesture.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            switch (part.ToLowerInvariant())
            {
                case "ctrl": case "control": modifiers |= 0x2; break;
                case "alt": modifiers |= 0x1; break;
                case "shift": modifiers |= 0x4; break;
                case "win": modifiers |= 0x8; break;
                default:
                    if (Enum.TryParse<Key>(part, true, out var k) && k != Key.None) key = k;
                    else { error = $"“{part}” is not a key NoorMD knows."; return false; }
                    break;
            }
        }
        if (key == null) { error = "Add a key to the modifiers (for example Ctrl+Alt+M)."; return false; }
        var isF = key is >= Key.F1 and <= Key.F24 || key is Key.Pause or Key.Scroll;
        if (modifiers == 0 && !isF) { error = "Use Ctrl, Alt or Shift with that key, or a function key (F1–F24), so typing doesn't trigger it."; return false; }
        vk = (uint)KeyInterop.VirtualKeyFromKey(key.Value);
        return true;
    }

    private IntPtr Hook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WmHotkey && wParam.ToInt32() == Id) { handled = true; _pressed(); }
        return IntPtr.Zero;
    }

    public void Dispose()
    {
        Clear();
        _source.RemoveHook(Hook);
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hwnd, int id);
}
