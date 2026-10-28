namespace NoorMD.Core.Calendar;

/// <summary>One time an entry happens.</summary>
/// <param name="Date">The day it happens on by its rule (yyyy-MM-dd): the key for skipping or moving this occurrence.</param>
/// <param name="Age">Birthdays and anniversaries: the years since it began (on this occurrence), or null.</param>
public sealed record CalendarOccurrence(string EntryId, string Date, DateTime Start, DateTime End, bool AllDay, int? Age, bool Moved);

/// <summary>A reminder that is due: which entry, which occurrence, and when it was meant to go off.</summary>
/// <param name="Key">Stable for this reminder of this occurrence: entry|date|minutes (to dismiss or snooze it).</param>
public sealed record CalendarReminder(string Key, string EntryId, CalendarOccurrence Occurrence, int Minutes, DateTime At);

public static class CalendarEngine
{
    private const int MaxSteps = 200_000;

    /// <summary>Every occurrence of the entries that overlaps [from, to), in time order.</summary>
    public static List<CalendarOccurrence> Occurrences(IEnumerable<CalendarEntry> entries, DateTime from, DateTime to)
    {
        var list = new List<CalendarOccurrence>();
        foreach (var e in entries) list.AddRange(Occurrences(e, from, to));
        return list.OrderBy(o => o.Start).ThenBy(o => o.AllDay ? 0 : 1).ThenBy(o => o.EntryId, StringComparer.Ordinal).ToList();
    }

    public static IEnumerable<CalendarOccurrence> Occurrences(CalendarEntry e, DateTime from, DateTime to)
    {
        if (!CalendarTime.TryTime(e.Start, out var start) || !CalendarTime.TryTime(e.End, out var end)) yield break;
        // An all-day entry ends at midnight after its last day.
        var length = e.AllDay ? end.Date.AddDays(1) - start.Date : end - start;
        if (e.AllDay) start = start.Date;
        var skip = new HashSet<string>(e.Skip ?? [], StringComparer.Ordinal);
        var moved = (e.Moved ?? []).ToDictionary(m => m.Date[..10], StringComparer.Ordinal);
        var movedHits = new HashSet<string>(StringComparer.Ordinal);
        foreach (var at in Starts(e, start, to.AddDays(366)))
        {
            // A moved occurrence may now lie outside the range of its rule's day: checked below with every move.
            var key = CalendarTime.Day(at);
            if (skip.Contains(key)) continue;
            if (moved.ContainsKey(key)) { movedHits.Add(key); continue; }
            var occEnd = at + length;
            if (at >= to) break;
            if (occEnd > from || (length == TimeSpan.Zero && at >= from))
                yield return new CalendarOccurrence(e.Id, key, at, occEnd, e.AllDay, Age(e, at), false);
        }
        // Moved occurrences (only those their rule really has).
        foreach (var (key, m) in moved)
        {
            if (!movedHits.Contains(key) && !RuleHas(e, start, key)) continue;
            if (!CalendarTime.TryTime(m.Start, out var ms) || !CalendarTime.TryTime(m.End, out var me)) continue;
            if (e.AllDay) { ms = ms.Date; me = me.Date.AddDays(1); }
            if (me <= ms) me = ms + length;
            if (ms < to && me > from) yield return new CalendarOccurrence(e.Id, key, ms, me, e.AllDay, Age(e, ms), true);
        }
    }

    private static bool RuleHas(CalendarEntry e, DateTime start, string day)
    {
        if (!CalendarTime.TryDay(day, out var d)) return false;
        foreach (var at in Starts(e, start, d.AddDays(1)))
        {
            if (at.Date == d) return true;
            if (at.Date > d) return false;
        }
        return false;
    }

    private static int? Age(CalendarEntry e, DateTime at) => e.SinceYear is int y && at.Year >= y ? at.Year - y : null;

    /// <summary>The rule's start times from the entry's start (in order), up to `until`.</summary>
    internal static IEnumerable<DateTime> Starts(CalendarEntry e, DateTime start, DateTime until)
    {
        var r = e.Repeat;
        if (r == null) { yield return start; yield break; }
        DateTime? last = CalendarTime.TryDay(r.Until, out var u) ? u.Date.AddDays(1) : null;
        var count = 0;
        var steps = 0;
        bool Done(DateTime at) => at >= until || (last != null && at >= last) || (r.Count != null && count >= r.Count) || ++steps > MaxSteps;
        var time = start.TimeOfDay;
        switch (r.Freq)
        {
            case "daily":
                for (var at = start; !Done(at); at = at.AddDays(r.Interval)) { count++; yield return at; }
                break;
            case "weekly":
            {
                var days = r.Days.Count > 0 ? r.Days : [(int)start.DayOfWeek];
                var weekStart = start.Date.AddDays(-(int)start.DayOfWeek); // weeks from Sunday
                for (var w = weekStart; ; w = w.AddDays(7 * r.Interval))
                {
                    foreach (var d in days)
                    {
                        var at = w.AddDays(d) + time;
                        if (at < start) continue;
                        if (Done(at)) yield break;
                        count++;
                        yield return at;
                    }
                    if (w > until || ++steps > MaxSteps) yield break;
                }
            }
            case "monthly":
            {
                var nth = (start.Day - 1) / 7 + 1;
                var weekday = start.DayOfWeek;
                for (var m = new DateTime(start.Year, start.Month, 1); ; m = m.AddMonths(r.Interval))
                {
                    DateTime? day = r.MonthMode switch
                    {
                        "weekday" => NthWeekday(m, weekday, nth),
                        "last" => LastWeekday(m, weekday),
                        // The same day of the month; a month without it (31st, 30th, 29 February) is left out.
                        _ => start.Day <= DateTime.DaysInMonth(m.Year, m.Month) ? new DateTime(m.Year, m.Month, start.Day) : null,
                    };
                    if (m > until || ++steps > MaxSteps) yield break;
                    if (day == null) continue;
                    var at = day.Value + time;
                    if (at < start) continue;
                    if (Done(at)) yield break;
                    count++;
                    yield return at;
                }
            }
            case "yearly":
                for (var y = start.Year; ; y += r.Interval)
                {
                    if (y > 9998) yield break;
                    // 29 February falls on 28 February in other years (birthdays are still celebrated).
                    var day = start.Month == 2 && start.Day == 29 && !DateTime.IsLeapYear(y) ? 28 : start.Day;
                    var at = new DateTime(y, start.Month, day) + time;
                    if (Done(at)) yield break;
                    count++;
                    yield return at;
                }
        }
    }

    private static DateTime? NthWeekday(DateTime month, DayOfWeek weekday, int nth)
    {
        var first = month.AddDays(((int)weekday - (int)month.DayOfWeek + 7) % 7);
        var day = first.AddDays(7 * (nth - 1));
        return day.Month == month.Month ? day : null;
    }

    private static DateTime LastWeekday(DateTime month, DayOfWeek weekday)
    {
        var lastDay = month.AddMonths(1).AddDays(-1);
        return lastDay.AddDays(-(((int)lastDay.DayOfWeek - (int)weekday + 7) % 7));
    }

    /// <summary>
    /// The reminders that went off after `after` and up to `now` (e.g. since the last check, or since NoorMD was last
    /// running), in time order. All-day entries count from midnight of their first day.
    /// </summary>
    public static List<CalendarReminder> Due(IEnumerable<CalendarEntry> entries, DateTime after, DateTime now)
    {
        var due = new List<CalendarReminder>();
        foreach (var e in entries)
        {
            if (e.Reminders.Count == 0) continue;
            var before = TimeSpan.FromMinutes(Math.Max(0, e.Reminders.Max()));
            var behind = TimeSpan.FromMinutes(Math.Max(0, -e.Reminders.Min()));
            foreach (var o in Occurrences(e, after - behind, now + before + TimeSpan.FromMinutes(1)))
                foreach (var m in e.Reminders)
                {
                    var at = o.Start.AddMinutes(-m);
                    if (at > after && at <= now) due.Add(new CalendarReminder($"{e.Id}|{o.Date}|{m}", e.Id, o, m, at));
                }
        }
        return due.OrderBy(d => d.At).ToList();
    }

    /// <summary>The next reminder after `now`, to know when to look again.</summary>
    public static DateTime? NextReminder(IEnumerable<CalendarEntry> entries, DateTime now, TimeSpan horizon)
    {
        DateTime? next = null;
        foreach (var e in entries)
        {
            if (e.Reminders.Count == 0) continue;
            var before = TimeSpan.FromMinutes(Math.Max(0, e.Reminders.Max()));
            var behind = TimeSpan.FromMinutes(Math.Max(0, -e.Reminders.Min()));
            foreach (var o in Occurrences(e, now - behind, now + horizon + before))
                foreach (var m in e.Reminders)
                {
                    var at = o.Start.AddMinutes(-m);
                    if (at > now && (next == null || at < next)) next = at;
                }
        }
        return next;
    }
}
