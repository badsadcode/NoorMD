namespace NoorMD.Core.Calendar;

/// <summary>
/// Days off: entries of the "holiday" kind (vacation, a day off). Counts the work days they take — Monday to Friday,
/// leaving out public holidays, which are off anyway — so a vacation planner can say how many days of leave are used.
/// </summary>
public static class DaysOff
{
    public static bool IsOff(CalendarEntry e) => e.Category == "holiday";

    /// <summary>The days in [<paramref name="from"/>, <paramref name="to"/>) that an off entry covers.</summary>
    public static SortedSet<DateTime> Days(IEnumerable<CalendarEntry> entries, DateTime from, DateTime to)
    {
        var days = new SortedSet<DateTime>();
        foreach (var o in CalendarEngine.Occurrences(entries.Where(IsOff), from.Date, to.Date))
        {
            // All-day ends are the day after the last; a timed day off still takes the days it touches.
            var last = o.AllDay ? o.End.Date.AddDays(-1) : (o.End.TimeOfDay == TimeSpan.Zero ? o.End.Date.AddDays(-1) : o.End.Date);
            for (var d = o.Start.Date; d <= last; d = d.AddDays(1))
                if (d >= from.Date && d < to.Date) days.Add(d);
        }
        return days;
    }

    public static bool IsWorkDay(DateTime d, ISet<DateTime> publicHolidays) =>
        d.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday) && !publicHolidays.Contains(d.Date);

    /// <summary>How many work days the off entries take in [<paramref name="from"/>, <paramref name="to"/>).</summary>
    public static int WorkDays(IEnumerable<CalendarEntry> entries, DateTime from, DateTime to, IEnumerable<Holidays.Holiday>? holidays = null)
    {
        var pub = (holidays ?? []).Select(h => h.Date.Date).ToHashSet();
        return Days(entries, from, to).Count(d => IsWorkDay(d, pub));
    }
}
