using NoorMD.Core.Calendar;
using Xunit;

namespace NoorMD.Core.Tests;

public class DaysOffTests
{
    private static CalendarEntry Off(string start, string end, string category = "holiday") =>
        new() { Id = Guid.NewGuid().ToString("N")[..8], Title = "Vacation", Category = category, AllDay = true, Start = start, End = end };

    [Fact]
    public void A_week_of_vacation_takes_five_work_days()
    {
        // Monday 3 Aug – Sunday 9 Aug 2026.
        var e = Off("2026-08-03", "2026-08-09");
        Assert.Equal(7, DaysOff.Days([e], new DateTime(2026, 1, 1), new DateTime(2027, 1, 1)).Count);
        Assert.Equal(5, DaysOff.WorkDays([e], new DateTime(2026, 1, 1), new DateTime(2027, 1, 1)));
    }

    [Fact]
    public void Public_holidays_and_other_kinds_do_not_count()
    {
        // 21–30 Dec 2026 in Sweden: Christmas Eve, Christmas Day and Boxing Day fall on Thu, Fri, Sat.
        var e = Off("2026-12-21", "2026-12-30");
        var se = Holidays.For("SE", 2026);
        var none = DaysOff.WorkDays([e], new DateTime(2026, 1, 1), new DateTime(2027, 1, 1));
        var withSe = DaysOff.WorkDays([e], new DateTime(2026, 1, 1), new DateTime(2027, 1, 1), se);
        Assert.Equal(8, none);
        Assert.True(withSe < none);
        Assert.Equal(0, DaysOff.WorkDays([Off("2026-08-03", "2026-08-09", "appointment")], new DateTime(2026, 1, 1), new DateTime(2027, 1, 1)));
    }

    [Fact]
    public void Overlapping_entries_count_a_day_once_and_the_range_clips()
    {
        var a = Off("2026-12-28", "2027-01-08");
        var b = Off("2027-01-04", "2027-01-05");
        // 28–31 Dec 2026 are Mon–Thu.
        Assert.Equal(4, DaysOff.WorkDays([a, b], new DateTime(2026, 1, 1), new DateTime(2027, 1, 1)));
        // 1–8 Jan 2027: Fri 1, Mon 4 – Fri 8.
        Assert.Equal(6, DaysOff.WorkDays([a, b], new DateTime(2027, 1, 1), new DateTime(2028, 1, 1)));
    }
}
