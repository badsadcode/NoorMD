using System.Globalization;
using System.Text;

namespace NoorMD.Core.Calendar;

/// <summary>
/// iCalendar (.ics, RFC 5545) files, the format every calendar app reads and writes. Export writes each entry as an
/// event with its repeat rule, skipped days, moved occurrences and reminders, in floating local time (the times are
/// read as times where the calendar is). Import reads the parts NoorMD keeps; what it can't keep exactly is imported
/// as near as possible and named in the result.
/// </summary>
public static class Ics
{
    private static readonly string[] DayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

    // ------------------------------------------------------------------ export

    public static string Export(IEnumerable<CalendarEntry> entries, string name = "NoorMD")
    {
        var sb = new StringBuilder();
        void Line(string s) => Fold(sb, s);
        Line("BEGIN:VCALENDAR");
        Line("VERSION:2.0");
        Line("PRODID:-//NoorMD//NoorCalendar//EN");
        Line("CALSCALE:GREGORIAN");
        Line("X-WR-CALNAME:" + Escape(name));
        var stamp = DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
        foreach (var e in entries)
        {
            Line("BEGIN:VEVENT");
            Line($"UID:{e.Id}@noormd");
            Line("DTSTAMP:" + stamp);
            Line("SUMMARY:" + Escape(e.Title));
            if (e.Notes.Length > 0) Line("DESCRIPTION:" + Escape(e.Notes));
            Line("CATEGORIES:" + Escape(e.Category.ToUpperInvariant()));
            if (e.Color.Length > 0) Line("X-NOORMD-COLOR:" + e.Color);
            if (e.SinceYear != null) Line("X-NOORMD-SINCE:" + e.SinceYear.Value.ToString(CultureInfo.InvariantCulture));
            if (e.Game != null) Line("X-NOORMD-GAME:" + Escape(e.Game));
            if (e.Platform != null) Line("X-NOORMD-PLATFORM:" + Escape(e.Platform));
            if (e.AllDay)
            {
                CalendarTime.TryDay(e.Start, out var s); CalendarTime.TryDay(e.End, out var end);
                Line("DTSTART;VALUE=DATE:" + s.ToString("yyyyMMdd", CultureInfo.InvariantCulture));
                Line("DTEND;VALUE=DATE:" + end.AddDays(1).ToString("yyyyMMdd", CultureInfo.InvariantCulture)); // DTEND is the day after
            }
            else
            {
                CalendarTime.TryTime(e.Start, out var s); CalendarTime.TryTime(e.End, out var end);
                Line("DTSTART:" + Local(s));
                Line("DTEND:" + Local(end));
            }
            if (e.Repeat != null) Line("RRULE:" + Rule(e));
            foreach (var skip in e.Skip)
                if (CalendarTime.TryDay(skip, out var d)) Line(e.AllDay ? "EXDATE;VALUE=DATE:" + d.ToString("yyyyMMdd", CultureInfo.InvariantCulture) : "EXDATE:" + Local(d + StartTime(e)));
            foreach (var m in e.Reminders)
            {
                Line("BEGIN:VALARM");
                Line("ACTION:DISPLAY");
                Line("DESCRIPTION:" + Escape(e.Title));
                Line("TRIGGER:" + Duration(-m));
                Line("END:VALARM");
            }
            Line("END:VEVENT");
            // A moved occurrence is its own event with the same UID and the day it replaces.
            foreach (var mv in e.Moved)
            {
                if (!CalendarTime.TryDay(mv.Date, out var orig) || !CalendarTime.TryTime(mv.Start, out var ms) || !CalendarTime.TryTime(mv.End, out var me)) continue;
                Line("BEGIN:VEVENT");
                Line($"UID:{e.Id}@noormd");
                Line("DTSTAMP:" + stamp);
                Line(e.AllDay ? "RECURRENCE-ID;VALUE=DATE:" + orig.ToString("yyyyMMdd", CultureInfo.InvariantCulture) : "RECURRENCE-ID:" + Local(orig + StartTime(e)));
                Line("SUMMARY:" + Escape(e.Title));
                if (e.AllDay) { Line("DTSTART;VALUE=DATE:" + ms.ToString("yyyyMMdd", CultureInfo.InvariantCulture)); Line("DTEND;VALUE=DATE:" + me.Date.AddDays(1).ToString("yyyyMMdd", CultureInfo.InvariantCulture)); }
                else { Line("DTSTART:" + Local(ms)); Line("DTEND:" + Local(me)); }
                Line("END:VEVENT");
            }
        }
        Line("END:VCALENDAR");
        return sb.ToString();
    }

    private static TimeSpan StartTime(CalendarEntry e) => CalendarTime.TryTime(e.Start, out var s) ? s.TimeOfDay : TimeSpan.Zero;

    private static string Local(DateTime t) => t.ToString("yyyyMMdd'T'HHmmss", CultureInfo.InvariantCulture);

    private static string Rule(CalendarEntry e)
    {
        var r = e.Repeat!;
        var parts = new List<string> { "FREQ=" + r.Freq.ToUpperInvariant() };
        if (r.Interval > 1) parts.Add("INTERVAL=" + r.Interval.ToString(CultureInfo.InvariantCulture));
        CalendarTime.TryTime(e.Start, out var start);
        if (r.Freq == "weekly" && r.Days.Count > 0) parts.Add("BYDAY=" + string.Join(',', r.Days.Select(d => DayCodes[d])));
        if (r.Freq == "monthly")
        {
            if (r.MonthMode == "weekday") parts.Add($"BYDAY={(start.Day - 1) / 7 + 1}{DayCodes[(int)start.DayOfWeek]}");
            else if (r.MonthMode == "last") parts.Add($"BYDAY=-1{DayCodes[(int)start.DayOfWeek]}");
            else parts.Add("BYMONTHDAY=" + start.Day.ToString(CultureInfo.InvariantCulture));
        }
        if (r.Count != null) parts.Add("COUNT=" + r.Count.Value.ToString(CultureInfo.InvariantCulture));
        else if (CalendarTime.TryDay(r.Until, out var u))
            parts.Add("UNTIL=" + (e.AllDay ? u.ToString("yyyyMMdd", CultureInfo.InvariantCulture) : Local(u.Date.AddDays(1).AddSeconds(-1))));
        return string.Join(';', parts);
    }

    /// <summary>A signed duration: −15 minutes is "-PT15M", a day is "-P1D".</summary>
    private static string Duration(int minutes)
    {
        var sign = minutes < 0 ? "-" : "";
        var m = Math.Abs(minutes);
        if (m == 0) return "PT0S";
        if (m % 1440 == 0) return $"{sign}P{m / 1440}D";
        var (d, h, mm) = (m / 1440, m % 1440 / 60, m % 60);
        return $"{sign}P{(d > 0 ? d + "D" : "")}T{(h > 0 ? h + "H" : "")}{(mm > 0 ? mm + "M" : "")}";
    }

    private static string Escape(string s) => s.Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,").Replace("\r\n", "\\n").Replace("\n", "\\n").Replace("\r", "");

    private static string Unescape(string s)
    {
        var sb = new StringBuilder();
        for (var i = 0; i < s.Length; i++)
        {
            if (s[i] == '\\' && i + 1 < s.Length)
            {
                var c = s[++i];
                sb.Append(c is 'n' or 'N' ? '\n' : c);
            }
            else sb.Append(s[i]);
        }
        return sb.ToString();
    }

    /// <summary>Lines are at most 75 octets; longer ones go on with a space at the start of the next (UTF-8 kept whole).</summary>
    private static void Fold(StringBuilder sb, string line)
    {
        var bytes = 0;
        var first = true;
        foreach (var rune in line.EnumerateRunes())
        {
            var n = rune.Utf8SequenceLength;
            if (bytes + n > (first ? 75 : 74)) { sb.Append("\r\n "); bytes = 0; first = false; }
            sb.Append(rune.ToString());
            bytes += n;
        }
        sb.Append("\r\n");
    }

    // ------------------------------------------------------------------ import

    public sealed record ImportResult(List<CalendarEntry> Entries, List<string> Notes);

    /// <summary>Reads the events of an .ics file. Times with a time zone or in UTC are turned into this computer's local time.</summary>
    public static ImportResult Import(string text, TimeZoneInfo? local = null)
    {
        local ??= TimeZoneInfo.Local;
        var notes = new List<string>();
        var lines = Unfold(text);
        var events = new List<List<(string Name, Dictionary<string, string> Params, string Value)>>();
        List<(string, Dictionary<string, string>, string)>? cur = null;
        var depth = 0; // inside a VALARM or another block within the event
        var alarms = new Dictionary<int, List<string>>();
        foreach (var raw in lines)
        {
            var (name, prm, value) = Parse(raw);
            if (name == "BEGIN" && value.Equals("VEVENT", StringComparison.OrdinalIgnoreCase)) { cur = []; depth = 0; continue; }
            if (cur == null) continue;
            if (name == "END" && value.Equals("VEVENT", StringComparison.OrdinalIgnoreCase)) { events.Add(cur); cur = null; continue; }
            if (name == "BEGIN") { depth++; if (value.Equals("VALARM", StringComparison.OrdinalIgnoreCase)) cur.Add(("X-ALARM-BEGIN", prm, "")); continue; }
            if (name == "END") { depth = Math.Max(0, depth - 1); continue; }
            cur.Add((depth > 0 ? "ALARM-" + name : name, prm, value));
        }

        var byUid = new Dictionary<string, CalendarEntry>(StringComparer.Ordinal);
        var result = new List<CalendarEntry>();
        var overrides = new List<(string Uid, List<(string Name, Dictionary<string, string> Params, string Value)> Props)>();
        foreach (var ev in events)
        {
            string Get(string n) => ev.FirstOrDefault(p => p.Name == n).Value ?? "";
            var uid = Get("UID");
            if (ev.Any(p => p.Name == "RECURRENCE-ID")) { overrides.Add((uid, ev)); continue; }
            var startProp = ev.FirstOrDefault(p => p.Name == "DTSTART");
            if (startProp.Name == null) { notes.Add($"“{Unescape(Get("SUMMARY"))}” has no start and was left out."); continue; }
            var (start, allDay) = ReadTime(startProp.Params, startProp.Value, local);
            if (start == null) { notes.Add($"“{Unescape(Get("SUMMARY"))}” has a start that can't be read and was left out."); continue; }
            var endProp = ev.FirstOrDefault(p => p.Name == "DTEND");
            DateTime? end = endProp.Name != null ? ReadTime(endProp.Params, endProp.Value, local).Time : null;
            if (end == null && Get("DURATION") is { Length: > 0 } dur && TryDuration(dur, out var span)) end = start + span;
            var e = new CalendarEntry
            {
                Id = CalendarCheck.NewId(),
                Title = Unescape(Get("SUMMARY")),
                Notes = Unescape(Get("DESCRIPTION")),
                AllDay = allDay,
                Color = Get("X-NOORMD-COLOR"),
                Game = Get("X-NOORMD-GAME") is { Length: > 0 } g ? Unescape(g) : null,
                Platform = Get("X-NOORMD-PLATFORM") is { Length: > 0 } pl ? Unescape(pl) : null,
                SinceYear = int.TryParse(Get("X-NOORMD-SINCE"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var since) ? since : null,
            };
            var cat = Unescape(Get("CATEGORIES")).Split(',').Select(c => c.Trim().ToLowerInvariant()).FirstOrDefault(CalendarEntry.Categories.Contains);
            e.Category = cat ?? (Get("CATEGORIES").Contains("BIRTHDAY", StringComparison.OrdinalIgnoreCase) ? "birthday" : "other");
            if (allDay)
            {
                e.Start = CalendarTime.Day(start.Value);
                // DTEND is the day after the last one.
                e.End = CalendarTime.Day(end != null && end.Value.Date > start.Value.Date ? end.Value.Date.AddDays(-1) : start.Value.Date);
            }
            else
            {
                e.Start = CalendarTime.Time(start.Value);
                e.End = CalendarTime.Time(end != null && end > start ? end.Value : start.Value.AddHours(1));
            }
            if (Get("RRULE") is { Length: > 0 } rrule) e.Repeat = ReadRule(rrule, start.Value, allDay, local, e.Title, notes);
            foreach (var ex in ev.Where(p => p.Name == "EXDATE"))
                foreach (var v in ex.Value.Split(','))
                    if (ReadTime(ex.Params, v, local).Time is DateTime d) e.Skip.Add(CalendarTime.Day(d));
            // Reminders: TRIGGER of each alarm (relative to the start).
            foreach (var trig in ev.Where(p => p.Name == "ALARM-TRIGGER"))
            {
                if (trig.Params.TryGetValue("RELATED", out var rel) && rel.Equals("END", StringComparison.OrdinalIgnoreCase)) { notes.Add($"“{e.Title}”: a reminder after its end became one at its start."); }
                if (trig.Params.TryGetValue("VALUE", out var vt) && vt.Equals("DATE-TIME", StringComparison.OrdinalIgnoreCase))
                {
                    if (ReadTime([], trig.Value, local).Time is DateTime abs) e.Reminders.Add((int)Math.Round((start.Value - abs).TotalMinutes));
                }
                else if (TryDuration(trig.Value, out var off)) e.Reminders.Add((int)Math.Round(-off.TotalMinutes));
            }
            if (e.Reminders.Count > CalendarCheck.MaxReminders) notes.Add($"“{e.Title}”: only the first {CalendarCheck.MaxReminders} reminders were kept.");
            if (e.Category == "birthday" && e.Repeat == null) e.Repeat = new CalendarRepeat { Freq = "yearly" };
            CalendarCheck.Clamped(e);
            result.Add(e);
            if (uid.Length > 0) byUid.TryAdd(uid, e);
        }
        // Moved (or cancelled) single occurrences.
        foreach (var (uid, ev) in overrides)
        {
            if (!byUid.TryGetValue(uid, out var e)) { notes.Add("A changed occurrence of an event that isn't in the file was left out."); continue; }
            var rid = ev.First(p => p.Name == "RECURRENCE-ID");
            var orig = ReadTime(rid.Params, rid.Value, local).Time;
            if (orig == null) continue;
            if (ev.FirstOrDefault(p => p.Name == "STATUS").Value is { } st && st.Equals("CANCELLED", StringComparison.OrdinalIgnoreCase)) { e.Skip.Add(CalendarTime.Day(orig.Value)); continue; }
            var sp = ev.FirstOrDefault(p => p.Name == "DTSTART"); var ep = ev.FirstOrDefault(p => p.Name == "DTEND");
            var ms = sp.Name != null ? ReadTime(sp.Params, sp.Value, local).Time : null;
            var me = ep.Name != null ? ReadTime(ep.Params, ep.Value, local).Time : null;
            if (ms == null) continue;
            if (e.AllDay) me = (me ?? ms.Value.AddDays(1)).Date.AddDays(-1);
            else me ??= ms.Value + (CalendarTime.TryTime(e.End, out var ee) && CalendarTime.TryTime(e.Start, out var ss) ? ee - ss : TimeSpan.FromHours(1));
            e.Moved.Add(new CalendarMoved { Date = CalendarTime.Day(orig.Value), Start = e.AllDay ? CalendarTime.Day(ms.Value) : CalendarTime.Time(ms.Value), End = e.AllDay ? CalendarTime.Day(me.Value) : CalendarTime.Time(me.Value) });
            CalendarCheck.Clamped(e);
        }
        return new ImportResult(result, notes.Distinct().ToList());
    }

    private static List<string> Unfold(string text)
    {
        var lines = new List<string>();
        foreach (var raw in text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
        {
            if (raw.Length > 0 && (raw[0] == ' ' || raw[0] == '\t') && lines.Count > 0) lines[^1] += raw[1..];
            else if (raw.Length > 0) lines.Add(raw);
        }
        return lines;
    }

    /// <summary>NAME;PARAM=value;PARAM="quoted":VALUE</summary>
    private static (string Name, Dictionary<string, string> Params, string Value) Parse(string line)
    {
        var inQuote = false;
        var colon = -1;
        for (var i = 0; i < line.Length; i++)
        {
            if (line[i] == '"') inQuote = !inQuote;
            else if (line[i] == ':' && !inQuote) { colon = i; break; }
        }
        if (colon < 0) return (line.ToUpperInvariant(), [], "");
        var head = line[..colon];
        var parts = head.Split(';');
        var prm = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in parts.Skip(1))
        {
            var eq = p.IndexOf('=');
            if (eq > 0) prm[p[..eq]] = p[(eq + 1)..].Trim('"');
        }
        return (parts[0].ToUpperInvariant(), prm, line[(colon + 1)..]);
    }

    /// <summary>A DATE (all-day), a floating local DATE-TIME, a UTC one (…Z) or one with TZID, as local time.</summary>
    private static (DateTime? Time, bool AllDay) ReadTime(Dictionary<string, string> prm, string value, TimeZoneInfo local)
    {
        value = value.Trim();
        if ((prm.TryGetValue("VALUE", out var v) && v.Equals("DATE", StringComparison.OrdinalIgnoreCase)) || value.Length == 8)
            return DateTime.TryParseExact(value, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? (d, true) : (null, true);
        var utc = value.EndsWith('Z');
        if (!DateTime.TryParseExact(value.TrimEnd('Z'), ["yyyyMMdd'T'HHmmss", "yyyyMMdd'T'HHmm"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var t)) return (null, false);
        if (utc) return (TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(t, DateTimeKind.Utc), local), false);
        if (prm.TryGetValue("TZID", out var tzid) && FindZone(tzid) is { } zone && zone.Id != local.Id)
        {
            try { return (TimeZoneInfo.ConvertTime(DateTime.SpecifyKind(t, DateTimeKind.Unspecified), zone, local), false); }
            catch (ArgumentException) { /* a time that doesn't exist there: kept as written */ }
        }
        return (t, false);
    }

    private static TimeZoneInfo? FindZone(string id)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { }
        // Windows names and IANA names convert both ways in .NET.
        if (TimeZoneInfo.TryConvertIanaIdToWindowsId(id, out var win)) try { return TimeZoneInfo.FindSystemTimeZoneById(win); } catch (TimeZoneNotFoundException) { }
        if (TimeZoneInfo.TryConvertWindowsIdToIanaId(id, out var iana)) try { return TimeZoneInfo.FindSystemTimeZoneById(iana); } catch (TimeZoneNotFoundException) { }
        return null;
    }

    private static bool TryDuration(string s, out TimeSpan span)
    {
        span = TimeSpan.Zero;
        s = s.Trim();
        var neg = s.StartsWith('-');
        s = s.TrimStart('+', '-');
        if (!s.StartsWith('P')) return false;
        double total = 0, num = 0;
        var inTime = false;
        var any = false;
        foreach (var c in s[1..])
        {
            if (char.IsAsciiDigit(c)) { num = num * 10 + (c - '0'); continue; }
            switch (c)
            {
                case 'T': inTime = true; continue;
                case 'W': total += num * 7 * 1440; break;
                case 'D': total += num * 1440; break;
                case 'H' when inTime: total += num * 60; break;
                case 'M' when inTime: total += num; break;
                case 'S' when inTime: total += num / 60; break;
                default: return false;
            }
            num = 0; any = true;
        }
        if (!any) return false;
        span = TimeSpan.FromMinutes(neg ? -total : total);
        return true;
    }

    private static CalendarRepeat? ReadRule(string rrule, DateTime start, bool allDay, TimeZoneInfo local, string title, List<string> notes)
    {
        var parts = rrule.Split(';').Select(p => p.Split('=', 2)).Where(p => p.Length == 2).ToDictionary(p => p[0].ToUpperInvariant(), p => p[1], StringComparer.Ordinal);
        if (!parts.TryGetValue("FREQ", out var freq)) return null;
        var r = new CalendarRepeat { Freq = freq.ToLowerInvariant() };
        if (!CalendarRepeat.Frequencies.Contains(r.Freq)) { notes.Add($"“{title}” repeats {freq.ToLowerInvariant()}, which NoorMD doesn't do: only its first time was kept."); return null; }
        if (parts.TryGetValue("INTERVAL", out var iv) && int.TryParse(iv, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)) r.Interval = n;
        if (parts.TryGetValue("COUNT", out var cnt) && int.TryParse(cnt, NumberStyles.Integer, CultureInfo.InvariantCulture, out var c)) r.Count = c;
        if (parts.TryGetValue("UNTIL", out var until) && ReadTime([], until, local).Time is DateTime u) r.Until = CalendarTime.Day(u);
        if (parts.TryGetValue("BYDAY", out var byday))
        {
            var codes = byday.Split(',');
            if (r.Freq == "weekly") r.Days = codes.Select(x => Array.IndexOf(DayCodes, x[^2..].ToUpperInvariant())).Where(i => i >= 0).ToList();
            else if (r.Freq == "monthly")
            {
                var code = codes[0];
                var num = code[..^2];
                if (num == "-1") r.MonthMode = "last";
                else if (num.Length > 0) r.MonthMode = "weekday";
                if (codes.Length > 1 || (num.Length > 0 && num != "-1" && int.TryParse(num, out var k) && k != (start.Day - 1) / 7 + 1))
                    notes.Add($"“{title}”: its monthly rule ({byday}) was simplified to the start's own weekday of the month.");
            }
            else if (r.Freq != "daily") notes.Add($"“{title}”: its rule ({rrule}) was simplified.");
        }
        foreach (var other in new[] { "BYSETPOS", "BYWEEKNO", "BYYEARDAY", "BYHOUR", "BYMINUTE" })
            if (parts.ContainsKey(other)) { notes.Add($"“{title}”: part of its rule ({other}) isn't kept."); break; }
        return r;
    }
}
