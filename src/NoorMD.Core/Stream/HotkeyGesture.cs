namespace NoorMD.Core.Stream;

public enum HotkeyMouse { None, Middle, Back, Forward }

/// <summary>
/// A Mic Guard hotkey as written in settings: modifiers plus one key or mouse button, e.g. "Ctrl+Alt+M", "Ctrl+/",
/// "Shift+F13", "Mouse4" (the back side button), "Ctrl+MiddleMouse". Keys are named the way WPF names them
/// (M, D1, F9, NumPad1, Oem2…); typed characters such as / \ , . ; ' [ ] ` - = are accepted and shown as typed.
/// </summary>
public sealed record HotkeyGesture(bool Ctrl, bool Alt, bool Shift, bool Win, string? Key, HotkeyMouse Mouse)
{
    // Typed character → WPF key name (US / Polish programmer layout positions).
    private static readonly Dictionary<string, string> Characters = new()
    {
        ["/"] = "Oem2", ["\\"] = "Oem5", [","] = "OemComma", ["."] = "OemPeriod", [";"] = "Oem1", ["'"] = "Oem7",
        ["["] = "Oem4", ["]"] = "Oem6", ["`"] = "Oem3", ["-"] = "OemMinus", ["="] = "OemPlus", ["IntlBackslash"] = "Oem102",
    };

    private static readonly Dictionary<string, HotkeyMouse> MouseNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Mouse4"] = HotkeyMouse.Back, ["MouseBack"] = HotkeyMouse.Back, ["XButton1"] = HotkeyMouse.Back,
        ["Mouse5"] = HotkeyMouse.Forward, ["MouseForward"] = HotkeyMouse.Forward, ["XButton2"] = HotkeyMouse.Forward,
        ["MiddleMouse"] = HotkeyMouse.Middle, ["Mouse3"] = HotkeyMouse.Middle,
    };

    // Keys that are fine on their own: nobody types them by accident.
    private static readonly HashSet<string> Standalone = new(StringComparer.OrdinalIgnoreCase)
    {
        "Pause", "Scroll", "MediaPlayPause", "MediaNextTrack", "MediaPreviousTrack", "MediaStop", "Insert", "PrintScreen",
    };

    public bool HasModifier => Ctrl || Alt || Shift || Win;

    public static bool TryParse(string? text, out HotkeyGesture? gesture, out string? error)
    {
        gesture = null; error = null;
        if (string.IsNullOrWhiteSpace(text)) { error = "Press a key or a mouse button."; return false; }
        bool ctrl = false, alt = false, shift = false, win = false;
        string? key = null; var mouse = HotkeyMouse.None;
        foreach (var raw in text.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            switch (raw.ToLowerInvariant())
            {
                case "ctrl": case "control": ctrl = true; continue;
                case "alt": alt = true; continue;
                case "shift": shift = true; continue;
                case "win": case "windows": win = true; continue;
            }
            if (key != null || mouse != HotkeyMouse.None) { error = "Use one key or mouse button (with Ctrl, Alt, Shift or Win if you like)."; return false; }
            if (MouseNames.TryGetValue(raw, out var m)) mouse = m;
            else if (Characters.TryGetValue(raw, out var k)) key = k;
            else if (raw.Length >= 1 && raw.All(c => char.IsAsciiLetterOrDigit(c))) key = raw.Length == 1 && char.IsAsciiDigit(raw[0]) ? "D" + raw : raw.Length == 1 ? raw.ToUpperInvariant() : raw;
            else { error = $"“{raw}” is not a key NoorMD knows."; return false; }
        }
        if (key == null && mouse == HotkeyMouse.None) { error = "Add a key or mouse button to the modifiers (for example Ctrl+Alt+M)."; return false; }
        var g = new HotkeyGesture(ctrl, alt, shift, win, key, mouse);
        if (!g.HasModifier)
        {
            var fKey = key != null && key.Length is 2 or 3 && key[0] is 'F' or 'f' && int.TryParse(key[1..], out var n) && n is >= 1 and <= 24;
            var ok = mouse is HotkeyMouse.Back or HotkeyMouse.Forward || fKey || (key != null && Standalone.Contains(key));
            if (!ok)
            {
                error = mouse == HotkeyMouse.Middle
                    ? "The middle button is used for scrolling and links: add Ctrl, Alt or Shift."
                    : "Add Ctrl, Alt or Shift to that key, or use a function key (F1–F24) or a side mouse button, so typing doesn't trigger it.";
                return false;
            }
        }
        gesture = g;
        return true;
    }

    /// <summary>The gesture as shown and saved: modifiers first, characters as typed ("Ctrl+Alt+/").</summary>
    public override string ToString()
    {
        var parts = new List<string>();
        if (Ctrl) parts.Add("Ctrl");
        if (Alt) parts.Add("Alt");
        if (Shift) parts.Add("Shift");
        if (Win) parts.Add("Win");
        if (Mouse != HotkeyMouse.None) parts.Add(Mouse switch { HotkeyMouse.Back => "Mouse4", HotkeyMouse.Forward => "Mouse5", _ => "MiddleMouse" });
        else if (Key != null) parts.Add(Characters.FirstOrDefault(kv => kv.Value == Key && kv.Key.Length == 1).Key ?? Key);
        return string.Join("+", parts);
    }
}
