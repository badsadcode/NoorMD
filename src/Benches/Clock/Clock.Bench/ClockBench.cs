using System.Text.Json.Nodes;
using Noor.Contracts;

namespace Clock.Bench;

/// <summary>World clocks, a small clock and a stopwatch: a demo bench whose panels are handy to dock in other benches
/// (to try "any panel in any bench"). Its C# side lists the computer's time zones.</summary>
public sealed class ClockBench : BenchBase
{
    public override BenchManifest Manifest { get; } = new()
    {
        Id = "noor.clock",
        Name = "Clock",
        Icon = "◷",
        Description = "World clocks, and a clock and a stopwatch to dock beside your work in any bench.",
        Version = "3.0.2",
        Density = "roomy",
        Menus = [new MenuSpec("Clock", [
            new MenuItemSpec("Add a time zone…", "clock.add"),
            MenuItemSpec.Separator,
            new MenuItemSpec("Start / stop the stopwatch", "clock.toggle", "Ctrl+Alt+S"),
            new MenuItemSpec("Reset the stopwatch", "clock.reset"),
        ])],
        Panels = [new PanelSpec("now", "Clock", "◷", "right"), new PanelSpec("stopwatch", "Stopwatch", "⏱", "bottom")],
    };

    public ClockBench()
    {
        Command("clock.zones", _ => Zones());
    }

    /// <summary>The time zones, by their IANA names (what the page's clocks understand), with today's offset.</summary>
    public static JsonNode Zones()
    {
        var list = new JsonArray();
        foreach (var tz in TimeZoneInfo.GetSystemTimeZones())
        {
            var iana = tz.HasIanaId ? tz.Id : TimeZoneInfo.TryConvertWindowsIdToIanaId(tz.Id, out var id) ? id : null;
            if (iana == null) continue;
            list.Add(new JsonObject { ["id"] = iana, ["name"] = tz.DisplayName, ["offset"] = (int)tz.GetUtcOffset(DateTime.UtcNow).TotalMinutes });
        }
        return list;
    }
}
