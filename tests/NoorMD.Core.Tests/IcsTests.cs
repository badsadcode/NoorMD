using NoorMD.Core.Calendar;
using Xunit;

namespace NoorMD.Core.Tests;

public class IcsTests
{
    private static CalendarEntry E(Action<CalendarEntry> set)
    {
        var e = new CalendarEntry { Id = "x" + Guid.NewGuid().ToString("N")[..6], Title = "t" };
        set(e);
        return CalendarCheck.Clamped(e);
    }

    [Fact]
    public void Export_Then_Import_Keeps_What_NoorMD_Keeps()
    {
        var entries = new List<CalendarEntry>
        {
            E(e => { e.Title = "Stream: Żółta łódź, part 2; with friends"; e.Notes = "Line one\nLine two, with a comma"; e.Category = "stream"; e.Game = "Thornwake"; e.Platform = "Twitch";
                e.Start = "2026-11-06T19:00"; e.End = "2026-11-06T22:00"; e.Repeat = new CalendarRepeat { Freq = "weekly", Days = [5], Until = "2026-12-31" };
                e.Skip = ["2026-11-13"]; e.Moved = [new CalendarMoved { Date = "2026-11-20", Start = "2026-11-21T15:00", End = "2026-11-21T18:00" }]; e.Reminders = [15, 1440]; e.Color = "#7c5cff"; }),
            E(e => { e.Title = "Ola"; e.Category = "birthday"; e.AllDay = true; e.Start = "1996-02-29"; e.End = "1996-02-29"; e.SinceYear = 1996; e.Repeat = new CalendarRepeat { Freq = "yearly" }; e.Reminders = [-540]; }),
            E(e => { e.Title = "Holiday"; e.AllDay = true; e.Start = "2026-12-24"; e.End = "2026-12-27"; }),
            E(e => { e.Title = "Book club"; e.Start = "2026-11-10T18:00"; e.End = "2026-11-10T19:30"; e.Repeat = new CalendarRepeat { Freq = "monthly", MonthMode = "weekday", Count = 6 }; }),
        };
        var ics = Ics.Export(entries);
        Assert.All(ics.Split("\r\n"), l => Assert.True(System.Text.Encoding.UTF8.GetByteCount(l) <= 75, l));
        Assert.Contains("RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20261231T235959", ics);
        Assert.Contains("RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=6", ics);
        Assert.Contains("DTEND;VALUE=DATE:20261228", ics); // the day after the last
        var back = Ics.Import(ics, TimeZoneInfo.Utc);
        Assert.Empty(back.Notes);
        Assert.Equal(4, back.Entries.Count);
        var s = back.Entries[0];
        Assert.Equal(("Stream: Żółta łódź, part 2; with friends", "Line one\nLine two, with a comma", "stream", "Thornwake", "Twitch"), (s.Title, s.Notes, s.Category, s.Game, s.Platform));
        Assert.Equal(("2026-11-06T19:00", "2026-11-06T22:00", "#7c5cff"), (s.Start, s.End, s.Color));
        Assert.Equal(("weekly", 5, "2026-12-31"), (s.Repeat!.Freq, s.Repeat.Days.Single(), s.Repeat.Until));
        Assert.Equal(["2026-11-13"], s.Skip);
        Assert.Equal(("2026-11-20", "2026-11-21T15:00", "2026-11-21T18:00"), (s.Moved.Single().Date, s.Moved.Single().Start, s.Moved.Single().End));
        Assert.Equal([15, 1440], s.Reminders);
        var b = back.Entries[1];
        Assert.Equal((true, "1996-02-29", 1996, "yearly", "birthday"), (b.AllDay, b.Start, b.SinceYear!.Value, b.Repeat!.Freq, b.Category));
        Assert.Equal([-540], b.Reminders);
        Assert.Equal(("2026-12-24", "2026-12-27"), (back.Entries[2].Start, back.Entries[2].End));
        Assert.Equal(("monthly", "weekday", 6), (back.Entries[3].Repeat!.Freq, back.Entries[3].Repeat!.MonthMode, back.Entries[3].Repeat!.Count!.Value));
        // The same occurrences either way.
        DateTime D(string x) { CalendarTime.TryTime(x, out var t); return t; }
        Assert.Equal(CalendarEngine.Occurrences(entries, D("2026-01-01"), D("2028-01-01")).Select(o => (o.Start, o.End)),
            CalendarEngine.Occurrences(back.Entries, D("2026-01-01"), D("2028-01-01")).Select(o => (o.Start, o.End)));
    }

    [Fact]
    public void Imports_Files_From_Other_Calendars_With_Time_Zones_And_Says_What_It_Simplified()
    {
        var ics = string.Join("\r\n",
            "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Google Inc//Google NoorCalendar 70.9054//EN",
            "BEGIN:VEVENT", "DTSTART:20261106T180000Z", "DTEND:20261106T190000Z", "UID:a@google.com", "SUMMARY:UTC meeting", "END:VEVENT",
            "BEGIN:VEVENT", "DTSTART;TZID=America/New_York:20261106T090000", "DTEND;TZID=America/New_York:20261106T100000", "UID:b@google.com",
            "SUMMARY:New York call", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT30M", "END:VALARM", "END:VEVENT",
            "BEGIN:VEVENT", "DTSTART:20261106T080000", "DURATION:PT45M", "RRULE:FREQ=HOURLY;COUNT=3", "UID:c", "SUMMARY:Hourly thing", "END:VEVENT",
            "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261225", "UID:d", "SUMMARY:Christmas", "DESCRIPTION:A long description that goes on and on so that the",
            " line is folded by the calendar that wrote it", "END:VEVENT",
            "BEGIN:VEVENT", "UID:e", "SUMMARY:No start", "END:VEVENT",
            "END:VCALENDAR");
        var warsaw = TimeZoneInfo.FindSystemTimeZoneById(OperatingSystem.IsWindows() ? "Central European Standard Time" : "Europe/Warsaw");
        var r = Ics.Import(ics, warsaw);
        Assert.Equal(4, r.Entries.Count);
        Assert.Equal("2026-11-06T19:00", r.Entries[0].Start); // 18:00 UTC is 19:00 in Warsaw in November
        Assert.Equal(("2026-11-06T15:00", "2026-11-06T16:00"), (r.Entries[1].Start, r.Entries[1].End)); // 9:00 in New York
        Assert.Equal([30], r.Entries[1].Reminders);
        Assert.Equal(("2026-11-06T08:45", (CalendarRepeat?)null), (r.Entries[2].End, r.Entries[2].Repeat));
        Assert.Equal((true, "2026-12-25", "2026-12-25"), (r.Entries[3].AllDay, r.Entries[3].Start, r.Entries[3].End));
        Assert.EndsWith("folded by the calendar that wrote it", r.Entries[3].Notes);
        Assert.Contains(r.Notes, n => n.Contains("Hourly thing") && n.Contains("hourly"));
        Assert.Contains(r.Notes, n => n.Contains("No start"));
    }
}
