using System.Globalization;
using System.Text;

namespace NoorMD.Core.Calendar;

/// <summary>One planned stream: an occurrence of a "stream" entry.</summary>
public sealed record StreamSlot(string EntryId, string Title, string? Game, string? Platform, string Notes, DateTime Start, DateTime End, bool AllDay)
{
    public bool LiveAt(DateTime now) => Start <= now && now < End;
}

/// <summary>
/// The stream schedule from the calendar: the next stream (or the one that is on), a week's streams, and the schedule
/// as text to post — plain, for Discord (with Discord's own time stamps, which every reader sees in their own time
/// zone), or short enough for X.
/// </summary>
public static class StreamSchedule
{
    public static readonly string[] Formats = ["plain", "discord", "x"];

    /// <summary>The streams that end after <paramref name="from"/> and start before <paramref name="to"/>, in order.</summary>
    public static List<StreamSlot> Between(IEnumerable<CalendarEntry> entries, DateTime from, DateTime to)
    {
        var streams = entries.Where(e => e.Category == "stream").ToDictionary(e => e.Id);
        return CalendarEngine.Occurrences(streams.Values, from, to)
            .Select(o => { var e = streams[o.EntryId]; return new StreamSlot(e.Id, e.Title, e.Game, e.Platform, e.Notes, o.Start, o.End, o.AllDay); })
            .ToList();
    }

    /// <summary>The stream that is on now, or else the next one (within a year), or null.</summary>
    public static StreamSlot? Next(IEnumerable<CalendarEntry> entries, DateTime now) =>
        Between(entries, now, now.AddDays(366)).FirstOrDefault(s => s.End > now);

    /// <summary>The first day of the week that holds <paramref name="day"/> (Monday or Sunday first).</summary>
    public static DateTime WeekStart(DateTime day, bool mondayFirst) =>
        day.Date.AddDays(-(((int)day.DayOfWeek - (mondayFirst ? 1 : 0) + 7) % 7));

    /// <summary>The streams of the week that holds <paramref name="day"/>.</summary>
    public static List<StreamSlot> Week(IEnumerable<CalendarEntry> entries, DateTime day, bool mondayFirst)
    {
        var start = WeekStart(day, mondayFirst);
        return Between(entries, start, start.AddDays(7));
    }

    private static long Unix(DateTime local, TimeZoneInfo zone) => new DateTimeOffset(local, zone.GetUtcOffset(local)).ToUnixTimeSeconds();

    /// <summary>"UTC+01:00", for saying which times a plain schedule is in.</summary>
    public static string Offset(DateTime at, TimeZoneInfo zone)
    {
        var o = zone.GetUtcOffset(at);
        return o == TimeSpan.Zero ? "UTC" : $"UTC{(o < TimeSpan.Zero ? "−" : "+")}{o.Duration():hh\\:mm}";
    }

    /// <summary>
    /// The schedule as text: <paramref name="format"/> "plain", "discord" or "x". <paramref name="title"/> heads it
    /// (e.g. "Stream schedule"); the week's days come after it.
    /// </summary>
    public static string Text(IReadOnlyList<StreamSlot> slots, string format, DateTime weekStart, string title, CultureInfo culture, TimeZoneInfo zone)
    {
        var weekEnd = weekStart.AddDays(6);
        var span = weekStart.Month == weekEnd.Month
            ? $"{weekStart.Day}–{weekEnd.ToString("d MMM", culture)}"
            : $"{weekStart.ToString("d MMM", culture)} – {weekEnd.ToString("d MMM", culture)}";
        string Time(DateTime t) => t.ToString("t", culture);
        string What(StreamSlot s) => string.Join(" · ", new[] { s.Title, s.Game, s.Platform }.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct());
        var sb = new StringBuilder();
        switch (format)
        {
            case "discord":
                sb.Append("**📅 ").Append(title).Append(" · ").Append(span).Append("**\n");
                if (slots.Count == 0) sb.Append("No streams planned this week.\n");
                foreach (var s in slots)
                {
                    long a = Unix(s.Start, zone), b = Unix(s.End, zone);
                    sb.Append(s.AllDay ? $"• <t:{a}:D>" : $"• <t:{a}:F> – <t:{b}:t> (<t:{a}:R>)").Append(" — **").Append(s.Title).Append("**");
                    var more = string.Join(" · ", new[] { s.Game, s.Platform }.Where(x => !string.IsNullOrWhiteSpace(x)));
                    if (more.Length > 0) sb.Append(" · ").Append(more);
                    sb.Append('\n');
                }
                break;
            case "x":
            {
                sb.Append("🔴 ").Append(title).Append(" (").Append(span).Append(")\n");
                if (slots.Count == 0) sb.Append("No streams planned this week.\n");
                foreach (var s in slots)
                    sb.Append(s.Start.ToString("ddd", culture)).Append(s.AllDay ? "" : " " + Time(s.Start)).Append(' ').Append(s.Game is { Length: > 0 } g ? g : s.Title).Append('\n');
                sb.Append(Offset(weekStart.AddHours(12), zone)).Append('\n');
                var text = sb.ToString();
                // X counts characters; keep it within 280, ending on a whole line.
                if (text.Length > 280)
                {
                    var cut = text[..279];
                    text = cut[..Math.Max(cut.LastIndexOf('\n'), 0)] + "\n…";
                }
                return text;
            }
            default:
                sb.Append(title).Append(" · ").Append(span).Append('\n');
                if (slots.Count == 0) sb.Append("No streams planned this week.\n");
                foreach (var s in slots)
                    sb.Append(s.Start.ToString("ddd d MMM", culture)).Append(s.AllDay ? "" : $"  {Time(s.Start)}–{Time(s.End)}").Append("  ").Append(What(s)).Append('\n');
                if (slots.Any(s => !s.AllDay)) sb.Append("(Times are ").Append(zone.StandardName).Append(", ").Append(Offset(weekStart.AddHours(12), zone)).Append(")\n");
                break;
        }
        return sb.ToString();
    }

    /// <summary>
    /// An agenda block for a note (Markdown): the coming days' entries, a heading per day. All entries, not only
    /// streams, with the holidays given.
    /// </summary>
    public static string Agenda(IEnumerable<CalendarEntry> entries, DateTime from, int days, CultureInfo culture, IEnumerable<Holidays.Holiday>? holidays = null)
    {
        var list = entries.ToList();
        var byId = list.ToDictionary(e => e.Id);
        var occ = CalendarEngine.Occurrences(list, from.Date, from.Date.AddDays(days));
        var hol = (holidays ?? []).ToLookup(h => h.Date.Date);
        var sb = new StringBuilder();
        sb.Append("## Agenda · ").Append(from.ToString("d MMM", culture)).Append(" – ").Append(from.AddDays(days - 1).ToString("d MMM yyyy", culture)).Append("\n\n");
        var any = false;
        for (var d = from.Date; d < from.Date.AddDays(days); d = d.AddDays(1))
        {
            var today = occ.Where(o => o.Start.Date <= d && (o.AllDay ? o.End.Date > d : o.Start.Date == d)).ToList();
            if (today.Count == 0 && !hol[d].Any()) continue;
            any = true;
            sb.Append("**").Append(d.ToString("dddd d MMMM", culture)).Append("**\n");
            foreach (var h in hol[d]) sb.Append("- 🎌 ").Append(h.Name).Append('\n');
            foreach (var o in today)
            {
                var e = byId[o.EntryId];
                sb.Append("- ").Append(o.AllDay ? "" : o.Start.ToString("t", culture) + " ").Append(e.Title);
                if (o.Age is int age && e.Category == "birthday") sb.Append(" (").Append(age).Append(')');
                if (!string.IsNullOrWhiteSpace(e.Game)) sb.Append(" · ").Append(e.Game);
                sb.Append('\n');
            }
            sb.Append('\n');
        }
        if (!any) sb.Append("Nothing planned.\n");
        return sb.ToString();
    }
}
