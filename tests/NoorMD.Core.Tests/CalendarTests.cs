using NoorMD.Core.Calendar;
using Xunit;

namespace NoorMD.Core.Tests;

public class CalendarTests
{
    private static DateTime D(string s) => CalendarTime.TryTime(s, out var t) ? t : throw new FormatException(s);

    private static CalendarEntry Entry(string start, string end, CalendarRepeat? repeat = null, bool allDay = false) =>
        CalendarCheck.Clamped(new CalendarEntry { Id = "e1", Title = "x", Start = start, End = end, AllDay = allDay, Repeat = repeat });

    private static List<string> Days(CalendarEntry e, string from, string to) =>
        CalendarEngine.Occurrences([e], D(from), D(to)).Select(o => o.Date).ToList();

    [Fact]
    public void A_Single_Entry_Shows_Where_It_Overlaps()
    {
        var e = Entry("2026-11-03T18:00", "2026-11-03T20:00");
        Assert.Single(CalendarEngine.Occurrences([e], D("2026-11-03"), D("2026-11-04")));
        Assert.Empty(CalendarEngine.Occurrences([e], D("2026-11-04"), D("2026-11-05")));
        // A three-day all-day entry is in every day of it.
        var trip = Entry("2026-11-03", "2026-11-05", allDay: true);
        var o = CalendarEngine.Occurrences([trip], D("2026-11-05"), D("2026-11-06")).Single();
        Assert.Equal((D("2026-11-03"), D("2026-11-06")), (o.Start, o.End));
    }

    [Fact]
    public void Weekly_On_Chosen_Days_Every_Second_Week_Until_A_Date()
    {
        // Mondays and Wednesdays every other week, from Monday 2 November 2026, until 30 November.
        var e = Entry("2026-11-02T19:00", "2026-11-02T21:00", new CalendarRepeat { Freq = "weekly", Interval = 2, Days = [1, 3], Until = "2026-11-30" });
        Assert.Equal(["2026-11-02", "2026-11-04", "2026-11-16", "2026-11-18", "2026-11-30"], Days(e, "2026-10-01", "2027-01-01"));
        Assert.All(CalendarEngine.Occurrences([e], D("2026-10-01"), D("2027-01-01")), o => Assert.Equal(19, o.Start.Hour));
    }

    [Fact]
    public void Monthly_By_Day_Skips_Short_Months_And_By_Weekday_Finds_The_Nth_Or_Last()
    {
        var on31 = Entry("2026-01-31T10:00", "2026-01-31T11:00", new CalendarRepeat { Freq = "monthly", Count = 4 });
        Assert.Equal(["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31"], Days(on31, "2026-01-01", "2027-01-01"));
        // The 2nd Tuesday (10 November 2026 is one).
        var second = Entry("2026-11-10T18:00", "2026-11-10T19:00", new CalendarRepeat { Freq = "monthly", MonthMode = "weekday", Count = 3 });
        Assert.Equal(["2026-11-10", "2026-12-08", "2027-01-12"], Days(second, "2026-01-01", "2028-01-01"));
        // The last Friday (27 November 2026).
        var last = Entry("2026-11-27T20:00", "2026-11-27T22:00", new CalendarRepeat { Freq = "monthly", MonthMode = "last", Count = 3 });
        Assert.Equal(["2026-11-27", "2026-12-25", "2027-01-29"], Days(last, "2026-01-01", "2028-01-01"));
    }

    [Fact]
    public void Birthdays_Repeat_Yearly_With_The_Age_And_29_February_Falls_On_The_28th()
    {
        var b = CalendarCheck.Clamped(new CalendarEntry { Id = "b", Title = "Ola", Category = "birthday", AllDay = true, Start = "1996-02-29", End = "1996-02-29", SinceYear = 1996, Repeat = new CalendarRepeat { Freq = "yearly" } });
        var o = CalendarEngine.Occurrences([b], D("2027-01-01"), D("2028-12-31"));
        Assert.Equal(["2027-02-28", "2028-02-29"], o.Select(x => x.Date));
        Assert.Equal([31, 32], o.Select(x => x.Age!.Value));
        Assert.All(o, x => Assert.True(x.AllDay));
    }

    [Fact]
    public void Skipped_And_Moved_Occurrences()
    {
        var e = Entry("2026-11-06T19:00", "2026-11-06T22:00", new CalendarRepeat { Freq = "weekly" });
        e.Skip = ["2026-11-13"];
        e.Moved = [new CalendarMoved { Date = "2026-11-20", Start = "2026-11-21T15:00", End = "2026-11-21T17:00" }];
        var o = CalendarEngine.Occurrences([e], D("2026-11-01"), D("2026-11-30"));
        Assert.Equal(["2026-11-06", "2026-11-20", "2026-11-27"], o.Select(x => x.Date));
        var moved = o.Single(x => x.Moved);
        Assert.Equal((D("2026-11-21T15:00"), D("2026-11-21T17:00")), (moved.Start, moved.End));
        // A move for a day the rule never had is ignored.
        e.Moved.Add(new CalendarMoved { Date = "2026-11-24", Start = "2026-11-24T10:00", End = "2026-11-24T11:00" });
        Assert.Equal(3, CalendarEngine.Occurrences([e], D("2026-11-01"), D("2026-11-30")).Count);
    }

    [Fact]
    public void Reminders_Go_Off_Once_In_Their_Window_Including_On_The_Day_At_Nine()
    {
        var e = Entry("2026-11-06T19:00", "2026-11-06T22:00", new CalendarRepeat { Freq = "weekly" });
        e.Reminders = [15, 60 * 24];
        var due = CalendarEngine.Due([e], D("2026-11-06T18:00"), D("2026-11-06T18:50"));
        Assert.Equal("e1|2026-11-06|15", due.Single().Key);
        Assert.Equal(D("2026-11-06T18:45"), due.Single().At);
        // "A day before": at 19:00 on the 5th.
        Assert.Equal("e1|2026-11-06|1440", CalendarEngine.Due([e], D("2026-11-05T18:00"), D("2026-11-05T19:30")).Single().Key);
        // Missed while closed: everything between the last check and now.
        Assert.Equal(4, CalendarEngine.Due([e], D("2026-11-05T00:00"), D("2026-11-13T19:00")).Count);
        // All-day "on the day at 9:00" (−540).
        var b = CalendarCheck.Clamped(new CalendarEntry { Id = "b", AllDay = true, Start = "2026-11-10", End = "2026-11-10", Reminders = [-540, 1440] });
        var d = CalendarEngine.Due([b], D("2026-11-08T23:00"), D("2026-11-10T12:00"));
        Assert.Equal([D("2026-11-09T00:00"), D("2026-11-10T09:00")], d.Select(x => x.At));
        // The window is after `after` and up to `now`: a reminder exactly at the last check is not given twice.
        Assert.Single(CalendarEngine.Due([b], D("2026-11-09T00:00"), D("2026-11-10T12:00")));
        Assert.Equal(D("2026-11-13T18:45"), CalendarEngine.NextReminder([e], D("2026-11-12T20:00"), TimeSpan.FromDays(30)));
    }

    [Fact]
    public void Clamped_Repairs_Anything()
    {
        var e = CalendarCheck.Clamped(CalendarFile.EntryFromJson("""{"id":"../x","title":"","category":"weird","color":"red","start":"nope","end":"2020-01-01T10:00","repeat":{"freq":"hourly"},"reminders":[99999999,-99999,5,5],"sinceYear":0,"skip":["bad","2026-01-01"]}"""));
        Assert.Equal(12, e.Id.Length);
        Assert.Equal(("(no title)", "other", ""), (e.Title, e.Category, e.Color));
        Assert.True(CalendarTime.TryTime(e.Start, out var s) && CalendarTime.TryTime(e.End, out var en) && en > s);
        Assert.Null(e.Repeat);
        Assert.Equal([-1439, 5, 86400], e.Reminders);
        Assert.Null(e.SinceYear);
        Assert.Equal(["2026-01-01"], e.Skip);
    }
}
