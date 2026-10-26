namespace NoorMD.Core.Stream;

/// <summary>What one place (the Windows microphone, OBS) says about the mic.</summary>
public enum MicSide { Off, Unknown, Live, Muted }

/// <summary>The single answer the indicator shows.</summary>
public enum MicVerdict { NotSetUp, Live, Muted, Mismatch, Unknown }

/// <summary>
/// Mic Guard's rules, kept apart from Windows and OBS so they can be tested. Sides that are switched off don't count.
/// The hotkey never toggles each side on its own (that is how they drift apart): it picks one target and sets every
/// side to it. If anything might be live, the target is "muted", because an unexpected open mic is the worse mistake.
/// </summary>
public static class MicGuard
{
    public static MicVerdict Verdict(MicSide windows, MicSide obs)
    {
        var sides = new[] { windows, obs }.Where(s => s != MicSide.Off).ToList();
        if (sides.Count == 0) return MicVerdict.NotSetUp;
        if (sides.Contains(MicSide.Unknown)) return sides.Contains(MicSide.Live) ? MicVerdict.Live : MicVerdict.Unknown;
        if (sides.All(s => s == MicSide.Live)) return MicVerdict.Live;
        if (sides.All(s => s == MicSide.Muted)) return MicVerdict.Muted;
        return MicVerdict.Mismatch;
    }

    /// <summary>The state the hotkey sets everywhere: true = mute. Only when everything is known to be muted does it unmute.</summary>
    public static bool ToggleTarget(MicSide windows, MicSide obs) => Verdict(windows, obs) != MicVerdict.Muted;

    public static string Label(MicVerdict v) => v switch
    {
        MicVerdict.Live => "LIVE",
        MicVerdict.Muted => "MUTED",
        MicVerdict.Mismatch => "CHECK",
        MicVerdict.Unknown => "?",
        _ => "OFF",
    };

    /// <summary>A sentence for the indicator's tooltip and the Stream Desk.</summary>
    public static string Explain(MicVerdict v, MicSide windows, MicSide obs) => v switch
    {
        MicVerdict.Mismatch => $"Out of step: Windows mic {Word(windows)}, OBS {Word(obs)}. Press the hotkey to mute both.",
        MicVerdict.Live => "Your microphone is live.",
        MicVerdict.Muted => "Your microphone is muted.",
        MicVerdict.Unknown => "The microphone state can't be read right now.",
        _ => "Mic Guard is not set up.",
    };

    private static string Word(MicSide s) => s switch { MicSide.Live => "live", MicSide.Muted => "muted", MicSide.Unknown => "unknown", _ => "not used" };
}
