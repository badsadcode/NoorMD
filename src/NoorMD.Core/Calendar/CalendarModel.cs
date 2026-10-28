using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NoorMD.Core.Calendar;

// NoorCalendar: important days, birthdays, reminders, appointments and stream schedules. Times are wall-clock local
// times ("19:00 every Friday" stays 19:00 across daylight saving), kept as text: "yyyy-MM-dd" for a day,
// "yyyy-MM-ddTHH:mm" for a time.

/// <summary>How an entry repeats.</summary>
public sealed class CalendarRepeat
{
    public static readonly string[] Frequencies = ["daily", "weekly", "monthly", "yearly"];
    public static readonly string[] MonthModes = ["day", "weekday", "last"];

    /// <summary>"daily", "weekly", "monthly" or "yearly".</summary>
    public string Freq { get; set; } = "weekly";
    /// <summary>Every N days, weeks, months or years.</summary>
    public int Interval { get; set; } = 1;
    /// <summary>Weekly: the days of the week (0 = Sunday … 6 = Saturday); empty = the start's day.</summary>
    public List<int> Days { get; set; } = [];
    /// <summary>Monthly: "day" (the same day of the month), "weekday" (e.g. the 2nd Tuesday) or "last" (e.g. the last Friday).</summary>
    public string MonthMode { get; set; } = "day";
    /// <summary>The last day it may happen on (included), or null.</summary>
    public string? Until { get; set; }
    /// <summary>How many times in all (counting skipped ones), or null.</summary>
    public int? Count { get; set; }
}

/// <summary>One occurrence of a repeating entry moved to another time (or given another length).</summary>
public sealed class CalendarMoved
{
    /// <summary>The day it would have been on (yyyy-MM-dd).</summary>
    public string Date { get; set; } = "";
    public string Start { get; set; } = "";
    public string End { get; set; } = "";
}

public sealed class CalendarEntry
{
    public static readonly string[] Categories = ["important", "birthday", "appointment", "reminder", "stream", "holiday", "other"];

    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string Notes { get; set; } = "";
    public string Category { get; set; } = "other";
    /// <summary>"#rrggbb", or empty for the category's colour.</summary>
    public string Color { get; set; } = "";
    public bool AllDay { get; set; }
    /// <summary>"yyyy-MM-dd" (all-day) or "yyyy-MM-ddTHH:mm".</summary>
    public string Start { get; set; } = "";
    /// <summary>All-day: the last day (included). Timed: when it ends (after Start).</summary>
    public string End { get; set; } = "";
    public CalendarRepeat? Repeat { get; set; }
    /// <summary>Occurrences left out (the days they would have been on).</summary>
    public List<string> Skip { get; set; } = [];
    public List<CalendarMoved> Moved { get; set; } = [];
    /// <summary>Reminders, in minutes before the start (all-day: before midnight, so −540 is "on the day at 9:00").</summary>
    public List<int> Reminders { get; set; } = [];
    /// <summary>Birthdays and anniversaries: the year it began, for the age ("turns 30").</summary>
    public int? SinceYear { get; set; }
    /// <summary>A note this entry belongs to (a Vault-relative path), or null.</summary>
    public string? Note { get; set; }
    /// <summary>Streams: the game or category and the platform.</summary>
    public string? Game { get; set; }
    public string? Platform { get; set; }
    public string Updated { get; set; } = "";
}

public sealed class CalendarFile
{
    public int Version { get; set; } = 1;
    public List<CalendarEntry> Entries { get; set; } = [];

    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public string ToJson() => JsonSerializer.Serialize(this, Options);
    public static CalendarFile FromJson(string json) => JsonSerializer.Deserialize<CalendarFile>(json, Options) ?? new CalendarFile();
    public static CalendarEntry EntryFromJson(string json) => JsonSerializer.Deserialize<CalendarEntry>(json, Options) ?? new CalendarEntry();
    public static string EntryToJson(CalendarEntry e) => JsonSerializer.Serialize(e, Options);
}

/// <summary>Reading and checking the text forms of days and times.</summary>
public static class CalendarTime
{
    public static bool TryDay(string? s, out DateTime day)
    {
        day = default;
        if (s == null || s.Length < 10) return false;
        if (!DateTime.TryParseExact(s[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out day)) return false;
        return true;
    }

    public static bool TryTime(string? s, out DateTime time)
    {
        time = default;
        if (s == null) return false;
        if (s.Length == 10) return TryDay(s, out time);
        return DateTime.TryParseExact(s, "yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out time);
    }

    public static string Day(DateTime d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    public static string Time(DateTime t) => t.ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture);
}

/// <summary>Making an entry sensible whatever was sent or read (the page, an old file, an imported .ics).</summary>
public static class CalendarCheck
{
    public const int MaxEntries = 20_000, MaxReminders = 8;

    public static CalendarEntry Clamped(CalendarEntry e)
    {
        e.Id = e.Id is { Length: > 0 and <= 40 } id && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_') ? id : NewId();
        e.Title = Trim(e.Title, 200);
        if (e.Title.Length == 0) e.Title = "(no title)";
        e.Notes = Trim(e.Notes, 10_000);
        e.Category = CalendarEntry.Categories.Contains(e.Category) ? e.Category : "other";
        e.Color = e.Color is { Length: 7 } c && c[0] == '#' && c[1..].All(Uri.IsHexDigit) ? c.ToLowerInvariant() : "";
        // The start decides all-day or timed; a broken one becomes today.
        if (e.AllDay)
        {
            if (!CalendarTime.TryDay(e.Start, out var s)) s = DateTime.Today;
            if (!CalendarTime.TryDay(e.End, out var end) || end < s) end = s;
            if ((end - s).TotalDays > 366) end = s.AddDays(366);
            e.Start = CalendarTime.Day(s); e.End = CalendarTime.Day(end);
        }
        else
        {
            if (!CalendarTime.TryTime(e.Start, out var s) || e.Start.Length == 10) s = CalendarTime.TryDay(e.Start, out var d) ? d.AddHours(9) : DateTime.Today.AddHours(9);
            if (!CalendarTime.TryTime(e.End, out var end) || e.End.Length == 10 || end <= s) end = s.AddHours(1);
            if ((end - s).TotalDays > 366) end = s.AddDays(366);
            e.Start = CalendarTime.Time(s); e.End = CalendarTime.Time(end);
        }
        if (e.Repeat != null)
        {
            var r = e.Repeat;
            if (!CalendarRepeat.Frequencies.Contains(r.Freq)) e.Repeat = null;
            else
            {
                r.Interval = Math.Clamp(r.Interval, 1, 999);
                r.Days = (r.Days ?? []).Where(d => d is >= 0 and <= 6).Distinct().Order().ToList();
                r.MonthMode = CalendarRepeat.MonthModes.Contains(r.MonthMode) ? r.MonthMode : "day";
                r.Until = CalendarTime.TryDay(r.Until, out var u) ? CalendarTime.Day(u) : null;
                r.Count = r.Count is > 0 ? Math.Min(r.Count.Value, 10_000) : null;
            }
        }
        e.Skip = (e.Skip ?? []).Where(d => CalendarTime.TryDay(d, out _)).Select(d => d[..10]).Distinct().Take(2000).ToList();
        e.Moved = (e.Moved ?? []).Where(m => m != null && CalendarTime.TryDay(m.Date, out _) && CalendarTime.TryTime(m.Start, out _) && CalendarTime.TryTime(m.End, out _))
            .GroupBy(m => m.Date[..10]).Select(g => g.Last()).Take(2000).ToList();
        e.Reminders = (e.Reminders ?? []).Select(m => Math.Clamp(m, -1439, 60 * 24 * 60)).Distinct().Order().Take(MaxReminders).ToList();
        e.SinceYear = e.SinceYear is >= 1 and <= 9999 ? e.SinceYear : null;
        e.Note = e.Note is { Length: > 0 and <= 1000 } n && !n.Any(char.IsControl) ? n : null;
        e.Game = e.Game == null ? null : Trim(e.Game, 120);
        e.Platform = e.Platform == null ? null : Trim(e.Platform, 60);
        return e;
    }

    private static string Trim(string? s, int max)
    {
        s = (s ?? "").Trim();
        return s.Length > max ? s[..max] : s;
    }

    public static string NewId() => Guid.NewGuid().ToString("N")[..12];
}
