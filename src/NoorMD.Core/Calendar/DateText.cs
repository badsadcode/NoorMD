using System.Globalization;
using System.Text.RegularExpressions;

namespace NoorMD.Core.Calendar;

/// <summary>
/// Finds a day (and a time, or a time range) written in a line of a note, for "Add to calendar": "Fri 14 Nov 19:00",
/// "2026-11-14", "14.11.", "November 14 at 7pm", "tomorrow 10:30–12", "next Monday". What is left of the line is the
/// entry's title. Days and months in English and in the culture given; numbers day-first unless the culture writes
/// the month first.
/// </summary>
public static partial class DateText
{
    public sealed record Found(DateTime Start, DateTime? End, bool AllDay, string Title);

    private static readonly string[] EnglishMonths = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    private static readonly string[] EnglishDays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

    public static Found? Find(string text, DateTime now, CultureInfo? culture = null)
    {
        culture ??= CultureInfo.CurrentCulture;
        if (string.IsNullOrWhiteSpace(text)) return null;
        var line = text.Trim();
        if (line.Length > 400) line = line[..400];
        var spans = new List<(int Index, int Length)>();
        var today = now.Date;
        DateTime? day = null;

        // 1. Numbers: 2026-11-14, 14.11.2026, 14/11/26, 11/14/2026 (month first where the culture writes it so), 14.11.
        var iso = IsoDate().Match(line);
        if (iso.Success && TryDate(int.Parse(iso.Groups[1].Value), int.Parse(iso.Groups[2].Value), int.Parse(iso.Groups[3].Value), out var d1))
        { day = d1; spans.Add((iso.Index, iso.Length)); }
        if (day == null)
        {
            var num = NumericDate().Match(line);
            if (num.Success)
            {
                int a = int.Parse(num.Groups[1].Value), b = int.Parse(num.Groups[2].Value);
                var monthFirst = culture.DateTimeFormat.ShortDatePattern.TrimStart().StartsWith('M') && num.Groups["sep"].Value == "/";
                var (dd, mm) = monthFirst ? (b, a) : (a, b);
                if (mm > 12 && dd <= 12 && num.Groups["sep"].Value == "/") (dd, mm) = (mm, dd);
                var hasYear = num.Groups[3].Success && num.Groups[3].Value.Length > 0;
                var y = hasYear ? int.Parse(num.Groups[3].Value) : today.Year;
                if (y < 100) y += 2000;
                if (TryDate(y, mm, dd, out var d2))
                {
                    if (!hasYear && d2 < today) TryDate(y + 1, mm, dd, out d2);
                    day = d2; spans.Add((num.Index, num.Length));
                }
            }
        }
        // 2. Words: 14 November (2026), Nov 14(th), 14th of Nov.
        if (day == null)
        {
            var months = MonthNames(culture);
            // Tried at every place (not only after the last try): "Friday 14 Nov" is "14 Nov", not "Friday 14".
            for (var m = WordDate().Match(line); m.Success; m = WordDate().Match(line, m.Index + 1))
            {
                var monthWord = m.Groups["m1"].Success ? m.Groups["m1"].Value : m.Groups["m2"].Value;
                var dayNum = m.Groups["d1"].Success ? m.Groups["d1"].Value : m.Groups["d2"].Value;
                var month = MonthOf(monthWord, months);
                if (month == 0) continue;
                var hasYear = m.Groups["y"].Success;
                var y = hasYear ? int.Parse(m.Groups["y"].Value) : today.Year;
                if (!TryDate(y, month, int.Parse(dayNum), out var d3)) continue;
                if (!hasYear && d3 < today) TryDate(y + 1, month, int.Parse(dayNum), out d3);
                day = d3; spans.Add((m.Index, m.Length));
                break;
            }
        }
        // 3. Relative: today, tomorrow, the day after tomorrow, (next) Friday.
        var rel = Relative().Match(line);
        if (rel.Success)
        {
            var w = rel.Value.ToLowerInvariant();
            if (day == null)
            {
                if (w.Contains("after tomorrow")) day = today.AddDays(2);
                else if (w.StartsWith("tomorrow")) day = today.AddDays(1);
                else if (w.StartsWith("today") || w.StartsWith("tonight")) day = today;
            }
            if (w is "today" or "tonight" or "tomorrow" || w.Contains("tomorrow")) spans.Add((rel.Index, rel.Length));
        }
        // A weekday: the day itself, or (with no other day) the next one of that name.
        var days = DayNames(culture);
        foreach (Match m in Word().Matches(line))
        {
            var dow = DayOf(m.Value, days);
            if (dow < 0) continue;
            var start = m.Index;
            var next = Next().Match(line[..start]);
            if (next.Success && next.Index + next.Length == start) start = next.Index;
            if (day == null)
            {
                // "Friday" on a Friday is today; "next Friday" is a week on.
                var diff = ((dow - (int)today.DayOfWeek) + 7) % 7;
                if (diff == 0 && next.Success && next.Value.TrimStart().StartsWith("next", StringComparison.OrdinalIgnoreCase)) diff = 7;
                day = today.AddDays(diff);
            }
            spans.Add((start, m.Index + m.Length - start));
            break;
        }
        // 4. A time or a time range: 19:00, 7pm, 7:30 pm, at 19, 19:00–21:00, 7-9pm.
        TimeSpan? t0 = null, t1 = null;
        foreach (Match tm in TimeRange().Matches(line))
        {
            if (tm.Length == 0 || spans.Any(sp => tm.Index < sp.Index + sp.Length && sp.Index < tm.Index + tm.Length)) continue;
            var ampm2 = tm.Groups["ap2"].Value;
            var ampm1 = tm.Groups["ap1"].Success && tm.Groups["ap1"].Value.Length > 0 ? tm.Groups["ap1"].Value : ampm2;
            if (Time(tm.Groups["h1"].Value, tm.Groups["m1"].Value, ampm1, tm.Groups["at"].Success || tm.Groups["h2"].Success || tm.Groups["m1"].Success && tm.Groups["m1"].Value.Length > 0, out var a))
            {
                t0 = a;
                if (tm.Groups["h2"].Success && tm.Groups["h2"].Value.Length > 0 && Time(tm.Groups["h2"].Value, tm.Groups["m2"].Value, ampm2, true, out var b)) t1 = b;
                spans.Add((tm.Index, tm.Length));
                break;
            }
        }
        if (day == null && t0 == null) return null;
        var d = day ?? today;
        if (day == null && t0 != null && d + t0.Value < now) d = d.AddDays(1); // a time alone: the next one
        var title = Title(line, spans);
        if (t0 == null) return new Found(d, null, true, title);
        var s = d + t0.Value;
        DateTime? e = null;
        if (t1 != null) { e = d + t1.Value; if (e <= s) e = e.Value.AddDays(1); }
        return new Found(s, e, false, title);
    }

    private static bool TryDate(int y, int m, int d, out DateTime day)
    {
        day = default;
        if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > DateTime.DaysInMonth(y, m)) return false;
        day = new DateTime(y, m, d);
        return true;
    }

    private static bool Time(string h, string m, string ampm, bool sure, out TimeSpan t)
    {
        t = default;
        if (!int.TryParse(h, out var hh)) return false;
        var mm = m.Length > 0 && int.TryParse(m, out var x) ? x : 0;
        var ap = ampm.ToLowerInvariant().Replace(".", "");
        // A bare number is a time only with "at", a range, minutes or am/pm (so "3 apples" stays text).
        if (!sure && ap.Length == 0) return false;
        if (ap.StartsWith('p') && hh < 12) hh += 12;
        if (ap.StartsWith('a') && hh == 12) hh = 0;
        if (hh > 23 || mm > 59) return false;
        t = new TimeSpan(hh, mm, 0);
        return true;
    }

    private static string Title(string line, List<(int Index, int Length)> spans)
    {
        var chars = line.ToCharArray();
        foreach (var (i, l) in spans) for (var k = i; k < i + l && k < chars.Length; k++) chars[k] = '\0';
        var rest = new string(chars).Replace("\0", " ");
        // Markdown marks and joining words left at the ends.
        rest = Leftover().Replace(rest, " ");
        rest = Spaces().Replace(rest, " ").Trim(' ', ',', ';', ':', '-', '–', '—', '·', '|', '(', ')', '.');
        rest = Ends().Replace(rest, "").Trim(' ', ',', ';', ':', '-', '–', '—', '·', '|');
        return rest.Length > 200 ? rest[..200] : rest;
    }

    private static string[][] MonthNames(CultureInfo c) =>
    [
        EnglishMonths,
        [.. c.DateTimeFormat.MonthNames.Take(12).Select(x => x.ToLowerInvariant())],
        [.. c.DateTimeFormat.MonthGenitiveNames.Take(12).Select(x => x.ToLowerInvariant())],
        [.. c.DateTimeFormat.AbbreviatedMonthNames.Take(12).Select(x => x.ToLowerInvariant().TrimEnd('.'))],
    ];

    private static int MonthOf(string word, string[][] names)
    {
        var w = word.ToLowerInvariant().TrimEnd('.');
        if (w.Length < 3) return 0;
        foreach (var list in names)
            for (var i = 0; i < 12; i++)
                if (list[i].Length > 0 && (list[i] == w || (w.Length >= 3 && list[i].StartsWith(w, StringComparison.Ordinal) && (w.Length >= 4 || list == names[0] || list == names[3])))) return i + 1;
        return 0;
    }

    private static string[][] DayNames(CultureInfo c) =>
    [
        EnglishDays,
        [.. c.DateTimeFormat.DayNames.Select(x => x.ToLowerInvariant())],
        [.. c.DateTimeFormat.AbbreviatedDayNames.Select(x => x.ToLowerInvariant().TrimEnd('.'))],
    ];

    private static int DayOf(string word, string[][] names)
    {
        var w = word.ToLowerInvariant().TrimEnd('.');
        if (w.Length < 3) return -1;
        foreach (var list in names)
            for (var i = 0; i < 7; i++)
                if (list[i] == w || (list == names[0] && w.Length >= 3 && list[i].StartsWith(w, StringComparison.Ordinal) && (w.Length == 3 || w == list[i][..w.Length] && w.Length >= 3) && (w.Length <= 4 || w == list[i]))) return i;
        return -1;
    }

    [GeneratedRegex(@"\b(\d{4})-(\d{1,2})-(\d{1,2})\b")]
    private static partial Regex IsoDate();
    [GeneratedRegex(@"(?<![\d:.])(\d{1,2})(?<sep>[./])(\d{1,2})(?:\k<sep>(\d{2,4})?)?(?![\d:])")]
    private static partial Regex NumericDate();
    [GeneratedRegex(@"(?:\b(?<d1>\d{1,2})(?:st|nd|rd|th|\.)?\s+(?:of\s+)?(?<m1>\p{L}{3,}\.?)|\b(?<m2>\p{L}{3,}\.?)\s+(?<d2>\d{1,2})(?:st|nd|rd|th)?\b)(?:,?\s+(?<y>(?:19|20|21)\d{2}))?", RegexOptions.IgnoreCase)]
    private static partial Regex WordDate();
    [GeneratedRegex(@"\b(?:the\s+day\s+after\s+tomorrow|tomorrow|today|tonight)\b", RegexOptions.IgnoreCase)]
    private static partial Regex Relative();
    [GeneratedRegex(@"\p{L}{3,}\.?")]
    private static partial Regex Word();
    [GeneratedRegex(@"\b(?:next|this|on)\s+$", RegexOptions.IgnoreCase)]
    private static partial Regex Next();
    [GeneratedRegex(@"(?:(?<at>\b(?:at|@|kl\.?|um|à)\s*))?(?<!\d[./-]?)\b(?<h1>\d{1,2})(?:[:.](?<m1>\d{2}))?\s*(?<ap1>[ap]\.?m\.?)?(?:\s*(?:-|–|—|to|until|till)\s*(?<h2>\d{1,2})(?:[:.](?<m2>\d{2}))?\s*(?<ap2>[ap]\.?m\.?)?)?(?![\d./])", RegexOptions.IgnoreCase)]
    private static partial Regex TimeRange();
    [GeneratedRegex(@"^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|>\s*)|\*\*|__|`")]
    private static partial Regex Leftover();
    [GeneratedRegex(@"\s{2,}")]
    private static partial Regex Spaces();
    [GeneratedRegex(@"(?:^(?:on|at|from)\s+)|(?:\s+(?:on|at|from|by|next|this)$)", RegexOptions.IgnoreCase)]
    private static partial Regex Ends();
}
