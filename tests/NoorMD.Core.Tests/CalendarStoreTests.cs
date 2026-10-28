using NoorMD.Core.Calendar;
using Xunit;

namespace NoorMD.Core.Tests;

public class CalendarStoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "noormd-cal-" + Guid.NewGuid().ToString("N"));
    public void Dispose() { try { Directory.Delete(_dir, true); } catch (IOException) { } }

    private static DateTime D(string s) { CalendarTime.TryTime(s, out var t); return t; }

    [Fact]
    public void Entries_Are_Saved_And_Read_Back_And_A_Delete_Returns_The_Entry()
    {
        var s = new CalendarStore(_dir);
        var a = s.Upsert(new CalendarEntry { Title = "Dentist", Start = "2026-11-12T10:00", End = "2026-11-12T10:30", Reminders = [60] });
        s.Upsert(new CalendarEntry { Title = "Ola", Category = "birthday", AllDay = true, Start = "1996-05-03", End = "1996-05-03", SinceYear = 1996, Repeat = new CalendarRepeat { Freq = "yearly" } });
        a.Title = "Dentist (moved)"; s.Upsert(a);
        var again = new CalendarStore(_dir);
        Assert.Equal(["Dentist (moved)", "Ola"], again.Entries.Select(e => e.Title));
        var removed = again.Delete(again.Entries[0].Id);
        Assert.Equal("Dentist (moved)", removed!.Title);
        Assert.Single(new CalendarStore(_dir).Entries);
        Assert.True(File.Exists(Path.Combine(_dir, "calendar.json.bak")));
    }

    [Fact]
    public void A_Damaged_File_Falls_Back_To_The_Backup_And_Is_Kept()
    {
        var s = new CalendarStore(_dir);
        s.Upsert(new CalendarEntry { Title = "One", AllDay = true, Start = "2026-11-01", End = "2026-11-01" });
        s.Upsert(new CalendarEntry { Title = "Two", AllDay = true, Start = "2026-11-02", End = "2026-11-02" });
        File.WriteAllText(Path.Combine(_dir, "calendar.json"), "{ this is not json");
        var back = new CalendarStore(_dir);
        Assert.Equal(["One"], back.Entries.Select(e => e.Title)); // the version before the last save
        Assert.NotNull(back.LoadProblem);
        Assert.Single(Directory.GetFiles(_dir, "calendar.json.damaged-*"));
    }

    [Fact]
    public void Reminders_Come_Once_Snoozed_Ones_Come_Back_And_A_Long_Absence_Looks_Back_A_Week()
    {
        var s = new CalendarStore(_dir);
        s.Upsert(new CalendarEntry { Id = "w", Title = "Weekly", Start = "2026-11-06T19:00", End = "2026-11-06T20:00", Repeat = new CalendarRepeat { Freq = "weekly" }, Reminders = [15] });
        Assert.Empty(s.TakeDue(D("2026-11-06T18:00"))); // first look: nothing before now is old news
        var due = s.TakeDue(D("2026-11-06T18:50"));
        Assert.Equal("w|2026-11-06|15", due.Single().Key);
        Assert.Empty(s.TakeDue(D("2026-11-06T18:55"))); // not twice
        s.Snooze(due[0].Key, D("2026-11-06T19:05"));
        Assert.Empty(s.TakeDue(D("2026-11-06T19:00")));
        Assert.Equal("w|2026-11-06|15", s.TakeDue(D("2026-11-06T19:06")).Single().Key);
        Assert.Equal(D("2026-11-13T18:45"), s.Next(D("2026-11-06T19:10")));
        // Away for a month: only the last week's reminders.
        Assert.Single(new CalendarStore(_dir).TakeDue(D("2026-12-07T12:00")));
    }
}
