using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Threading;
using NoorMD.Core.Stream;

namespace NoorMD.Host;

/// <summary>
/// One system-wide hotkey, so Mic Guard works while a game or OBS has focus. Keyboard keys use RegisterHotKey (Windows
/// refuses a key another program already registered; that is reported). Mouse buttons (the side buttons, or the
/// middle button with a modifier) use a low-level mouse hook on its own thread; the click that triggers Mic Guard is
/// swallowed so the browser or game doesn't also go "back".
/// </summary>
public sealed class GlobalHotkey : IDisposable
{
    private const int WmHotkey = 0x0312;
    private const int Id = 0x4E4D; // "NM"
    private readonly HwndSource _source;
    private readonly Action _pressed;
    private readonly Dispatcher _dispatcher;
    private bool _registered;
    private MouseHook? _mouse;

    public string? Gesture { get; private set; }

    public GlobalHotkey(IntPtr hwnd, Action pressed)
    {
        _source = HwndSource.FromHwnd(hwnd) ?? throw new InvalidOperationException("No window handle.");
        _pressed = pressed;
        _dispatcher = Dispatcher.CurrentDispatcher;
        _source.AddHook(Hook);
    }

    /// <summary>Registers e.g. "Ctrl+Alt+M", "Ctrl+/", "Mouse4" (null/empty clears). Returns an error to show, or null.</summary>
    public string? Set(string? text)
    {
        Clear();
        if (string.IsNullOrWhiteSpace(text)) return null;
        if (!TryParse(text, out var g, out var vk, out var error)) return error;
        if (g!.Mouse != HotkeyMouse.None)
        {
            try { _mouse = new MouseHook(g, () => _dispatcher.BeginInvoke(_pressed)); }
            catch (Exception ex) when (ex is InvalidOperationException or Win32Exception) { return "Windows did not allow NoorMD to watch the mouse buttons: " + ex.Message; }
        }
        else
        {
            uint mods = (g.Alt ? 0x1u : 0) | (g.Ctrl ? 0x2u : 0) | (g.Shift ? 0x4u : 0) | (g.Win ? 0x8u : 0);
            if (!RegisterHotKey(_source.Handle, Id, mods | 0x4000 /* MOD_NOREPEAT */, vk))
                return $"{g} is already used by another program. Choose another key.";
            _registered = true;
        }
        Gesture = g.ToString();
        return null;
    }

    public void Clear()
    {
        if (_registered) UnregisterHotKey(_source.Handle, Id);
        _registered = false;
        _mouse?.Dispose();
        _mouse = null;
        Gesture = null;
    }

    /// <summary>Checks a gesture and finds its virtual key (0 for mouse buttons).</summary>
    public static bool TryParse(string text, out HotkeyGesture? gesture, out uint vk, out string? error)
    {
        vk = 0;
        if (!HotkeyGesture.TryParse(text, out gesture, out error)) return false;
        if (gesture!.Key is { } name)
        {
            if (!Enum.TryParse<Key>(name, true, out var key) || key == Key.None) { error = $"“{name}” is not a key NoorMD knows."; gesture = null; return false; }
            vk = (uint)KeyInterop.VirtualKeyFromKey(key);
            if (vk == 0) { error = $"“{name}” can't be used as a hotkey."; gesture = null; return false; }
        }
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

    /// <summary>WH_MOUSE_LL on a background thread with its own message loop (so a busy UI never delays mouse input).</summary>
    private sealed class MouseHook : IDisposable
    {
        private const int WmQuit = 0x0012, WmMButtonDown = 0x0207, WmMButtonUp = 0x0208, WmXButtonDown = 0x020B, WmXButtonUp = 0x020C;
        private readonly HotkeyGesture _gesture;
        private readonly Action _fire;
        private readonly Thread _thread;
        private readonly LowLevelProc _proc; // kept alive for the hook's lifetime
        private uint _threadId;
        private IntPtr _hook;
        private bool _swallowUp;

        public MouseHook(HotkeyGesture gesture, Action fire)
        {
            _gesture = gesture;
            _fire = fire;
            _proc = Callback;
            var started = new ManualResetEventSlim();
            Exception? failure = null;
            _thread = new Thread(() =>
            {
                _threadId = GetCurrentThreadId();
                _hook = SetWindowsHookEx(14 /* WH_MOUSE_LL */, _proc, GetModuleHandle(Process.GetCurrentProcess().MainModule?.ModuleName), 0);
                if (_hook == IntPtr.Zero) failure = new Win32Exception(Marshal.GetLastWin32Error());
                started.Set();
                if (_hook == IntPtr.Zero) return;
                while (GetMessage(out var m, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref m); DispatchMessage(ref m); }
                UnhookWindowsHookEx(_hook);
            }) { IsBackground = true, Name = "Mic Guard mouse hotkey" };
            _thread.Start();
            started.Wait(TimeSpan.FromSeconds(3));
            if (failure != null) throw failure;
        }

        private IntPtr Callback(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0)
            {
                var msg = wParam.ToInt32();
                var button = HotkeyMouse.None;
                if (msg is WmMButtonDown or WmMButtonUp) button = HotkeyMouse.Middle;
                else if (msg is WmXButtonDown or WmXButtonUp)
                {
                    var data = Marshal.ReadInt32(lParam, 8); // MSLLHOOKSTRUCT.mouseData: HIWORD = XBUTTON1 (1) / XBUTTON2 (2)
                    button = ((data >> 16) & 0xFFFF) == 1 ? HotkeyMouse.Back : HotkeyMouse.Forward;
                }
                if (button == _gesture.Mouse)
                {
                    var down = msg is WmMButtonDown or WmXButtonDown;
                    if (down && ModifiersMatch()) { _swallowUp = true; _fire(); return 1; }
                    if (!down && _swallowUp) { _swallowUp = false; return 1; }
                }
            }
            return CallNextHookEx(_hook, code, wParam, lParam);
        }

        private bool ModifiersMatch()
        {
            static bool Down(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;
            return Down(0x11) == _gesture.Ctrl && Down(0x12) == _gesture.Alt && Down(0x10) == _gesture.Shift && (Down(0x5B) || Down(0x5C)) == _gesture.Win;
        }

        public void Dispose()
        {
            if (_threadId != 0) PostThreadMessage(_threadId, WmQuit, IntPtr.Zero, IntPtr.Zero);
            _thread.Join(TimeSpan.FromSeconds(1));
        }

        private delegate IntPtr LowLevelProc(int code, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct Msg { public IntPtr Hwnd; public uint Message; public IntPtr WParam; public IntPtr LParam; public uint Time; public int X; public int Y; }

        [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int id, LowLevelProc proc, IntPtr module, uint threadId);
        [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
        [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] private static extern int GetMessage(out Msg msg, IntPtr hwnd, uint min, uint max);
        [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Msg msg);
        [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Msg msg);
        [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint threadId, int msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int vk);
        [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);
    }

    private sealed class Win32Exception(int code) : Exception(new System.ComponentModel.Win32Exception(code).Message);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hwnd, int id);
}
