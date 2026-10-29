namespace NoorMD.Core.Calendar;

/// <summary>
/// Public holidays worked out by their rules (fixed days, Easter, "the first Monday in May", Midsummer…), nothing
/// downloaded. National days off only (not regional ones), named in English. Where a country moves a holiday that
/// falls on a weekend to a weekday (the US, the UK, Australia, New Zealand), the day off is the moved one, marked
/// "(observed)".
/// </summary>
public static class Holidays
{
    public sealed record Country(string Code, string Name);
    public sealed record Holiday(DateTime Date, string Name);

    public static readonly IReadOnlyList<Country> Countries =
    [
        new("AU", "Australia"), new("AT", "Austria"), new("BE", "Belgium"), new("CA", "Canada"), new("DK", "Denmark"),
        new("FI", "Finland"), new("FR", "France"), new("DE", "Germany"), new("IE", "Ireland"), new("IT", "Italy"),
        new("NL", "Netherlands"), new("NZ", "New Zealand"), new("NO", "Norway"), new("PL", "Poland"), new("ES", "Spain"),
        new("SE", "Sweden"), new("GB", "United Kingdom"), new("US", "United States"),
    ];

    /// <summary>Easter Sunday (Gregorian), by the anonymous Gregorian algorithm.</summary>
    public static DateTime Easter(int year)
    {
        int a = year % 19, b = year / 100, c = year % 100, d = b / 4, e = b % 4, f = (b + 8) / 25, g = (b - f + 1) / 3;
        int h = (19 * a + b - d - g + 15) % 30, i = c / 4, k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = (a + 11 * h + 22 * l) / 451;
        var month = (h + l - 7 * m + 114) / 31;
        var day = (h + l - 7 * m + 114) % 31 + 1;
        return new DateTime(year, month, day);
    }

    private static DateTime Nth(int year, int month, DayOfWeek day, int n)
    {
        var first = new DateTime(year, month, 1);
        return first.AddDays(((int)day - (int)first.DayOfWeek + 7) % 7 + 7 * (n - 1));
    }

    private static DateTime Last(int year, int month, DayOfWeek day)
    {
        var last = new DateTime(year, month, DateTime.DaysInMonth(year, month));
        return last.AddDays(-(((int)last.DayOfWeek - (int)day + 7) % 7));
    }

    /// <summary>The given weekday on or after a date (Midsummer: the Saturday between 20 and 26 June).</summary>
    private static DateTime OnOrAfter(DateTime d, DayOfWeek day) => d.AddDays(((int)day - (int)d.DayOfWeek + 7) % 7);

    /// <summary>The US rule: Saturday → the Friday before, Sunday → the Monday after.</summary>
    private static Holiday UsObserved(DateTime d, string name) => d.DayOfWeek switch
    {
        DayOfWeek.Saturday => new(d.AddDays(-1), name + " (observed)"),
        DayOfWeek.Sunday => new(d.AddDays(1), name + " (observed)"),
        _ => new(d, name),
    };

    /// <summary>The UK, Australia, New Zealand rule: a weekend holiday moves to the next weekday not taken by another.</summary>
    private static void Substitute(List<Holiday> list, params (DateTime Date, string Name)[] days)
    {
        // The ones on weekdays keep their day; then the weekend ones move, in order, to the next free weekday (a
        // Sunday Christmas goes to Tuesday when Boxing Day has the Monday).
        static bool Weekend(DateTime d) => d.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
        foreach (var (date, name) in days.Where(x => !Weekend(x.Date))) list.Add(new(date, name));
        var taken = new HashSet<DateTime>(list.Select(h => h.Date));
        foreach (var (date, name) in days.Where(x => Weekend(x.Date)))
        {
            var d = date;
            while (d.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday || taken.Contains(d)) d = d.AddDays(1);
            list.Add(new(d, name + " (observed)"));
            taken.Add(d);
        }
    }

    /// <summary>A country's public holidays in a year, in date order (empty for an unknown country).</summary>
    public static List<Holiday> For(string code, int year)
    {
        if (year is < 1900 or > 2200) return [];
        var e = Easter(year);
        DateTime D(int m, int d) => new(year, m, d);
        var h = new List<Holiday>();
        void Add(DateTime d, string name) => h.Add(new(d, name));
        switch (code)
        {
            case "US":
                h.Add(UsObserved(D(1, 1), "New Year's Day"));
                Add(Nth(year, 1, DayOfWeek.Monday, 3), "Martin Luther King Jr. Day");
                Add(Nth(year, 2, DayOfWeek.Monday, 3), "Presidents' Day");
                Add(Last(year, 5, DayOfWeek.Monday), "Memorial Day");
                if (year >= 2021) h.Add(UsObserved(D(6, 19), "Juneteenth"));
                h.Add(UsObserved(D(7, 4), "Independence Day"));
                Add(Nth(year, 9, DayOfWeek.Monday, 1), "Labor Day");
                Add(Nth(year, 10, DayOfWeek.Monday, 2), "Columbus Day");
                h.Add(UsObserved(D(11, 11), "Veterans Day"));
                Add(Nth(year, 11, DayOfWeek.Thursday, 4), "Thanksgiving");
                h.Add(UsObserved(D(12, 25), "Christmas Day"));
                break;
            case "CA":
                Add(D(1, 1), "New Year's Day");
                Add(e.AddDays(-2), "Good Friday");
                // The Monday before 25 May.
                Add(D(5, 24).AddDays(-(((int)D(5, 24).DayOfWeek - (int)DayOfWeek.Monday + 7) % 7)), "Victoria Day");
                Add(D(7, 1), "Canada Day");
                Add(Nth(year, 9, DayOfWeek.Monday, 1), "Labour Day");
                if (year >= 2021) Add(D(9, 30), "National Day for Truth and Reconciliation");
                Add(Nth(year, 10, DayOfWeek.Monday, 2), "Thanksgiving");
                Add(D(11, 11), "Remembrance Day");
                Add(D(12, 25), "Christmas Day");
                Add(D(12, 26), "Boxing Day");
                break;
            case "GB":
                Add(e.AddDays(-2), "Good Friday");
                Add(e.AddDays(1), "Easter Monday");
                Add(Nth(year, 5, DayOfWeek.Monday, 1), "Early May bank holiday");
                Add(Last(year, 5, DayOfWeek.Monday), "Spring bank holiday");
                Add(Last(year, 8, DayOfWeek.Monday), "Summer bank holiday");
                Substitute(h, (D(1, 1), "New Year's Day"), (D(12, 25), "Christmas Day"), (D(12, 26), "Boxing Day"));
                break;
            case "IE":
                Add(D(1, 1), "New Year's Day");
                if (year >= 2023) Add(D(2, 1).DayOfWeek == DayOfWeek.Friday ? D(2, 1) : Nth(year, 2, DayOfWeek.Monday, 1), "St Brigid's Day");
                Add(D(3, 17), "St Patrick's Day");
                Add(e.AddDays(1), "Easter Monday");
                Add(Nth(year, 5, DayOfWeek.Monday, 1), "May Day");
                Add(Nth(year, 6, DayOfWeek.Monday, 1), "June bank holiday");
                Add(Nth(year, 8, DayOfWeek.Monday, 1), "August bank holiday");
                Add(Last(year, 10, DayOfWeek.Monday), "October bank holiday");
                Add(D(12, 25), "Christmas Day");
                Add(D(12, 26), "St Stephen's Day");
                break;
            case "AU":
                Add(e.AddDays(-2), "Good Friday");
                Add(e.AddDays(1), "Easter Monday");
                Add(D(4, 25), "Anzac Day");
                Add(Nth(year, 6, DayOfWeek.Monday, 2), "King's Birthday");
                Substitute(h, (D(1, 1), "New Year's Day"), (D(1, 26), "Australia Day"), (D(12, 25), "Christmas Day"), (D(12, 26), "Boxing Day"));
                break;
            case "NZ":
                Add(D(2, 6), "Waitangi Day");
                Add(e.AddDays(-2), "Good Friday");
                Add(e.AddDays(1), "Easter Monday");
                Add(D(4, 25), "Anzac Day");
                Add(Nth(year, 6, DayOfWeek.Monday, 1), "King's Birthday");
                Add(Nth(year, 10, DayOfWeek.Monday, 4), "Labour Day");
                Substitute(h, (D(1, 1), "New Year's Day"), (D(1, 2), "Day after New Year's Day"), (D(12, 25), "Christmas Day"), (D(12, 26), "Boxing Day"));
                break;
            case "DE":
                Add(D(1, 1), "New Year's Day");
                Add(e.AddDays(-2), "Good Friday");
                Add(e.AddDays(1), "Easter Monday");
                Add(D(5, 1), "Labour Day");
                Add(e.AddDays(39), "Ascension Day");
                Add(e.AddDays(50), "Whit Monday");
                Add(D(10, 3), "German Unity Day");
                Add(D(12, 25), "Christmas Day");
                Add(D(12, 26), "St Stephen's Day");
                break;
            case "AT":
                Add(D(1, 1), "New Year's Day");
                Add(D(1, 6), "Epiphany");
                Add(e.AddDays(1), "Easter Monday");
                Add(D(5, 1), "Labour Day");
                Add(e.AddDays(39), "Ascension Day");
                Add(e.AddDays(50), "Whit Monday");
                Add(e.AddDays(60), "Corpus Christi");
                Add(D(8, 15), "Assumption Day");
                Add(D(10, 26), "National Day");
                Add(D(11, 1), "All Saints' Day");
                Add(D(12, 8), "Immaculate Conception");
                Add(D(12, 25), "Christmas Day");
                Add(D(12, 26), "St Stephen's Day");
                break;
            case "FR":
                Add(D(1, 1), "New Year's Day");
                Add(e.AddDays(1), "Easter Monday");
                Add(D(5, 1), "Labour Day");
                Add(D(5, 8), "Victory in Europe Day");
                Add(e.AddDays(39), "Ascension Day");
                Add(e.AddDays(50), "Whit Monday");
                Add(D(7, 14), "Bastille Day");
                Add(D(8, 15), "Assumption Day");
                Add(D(11, 1), "All Saints' Day");
                Add(D(11, 11), "Armistice Day");
                Add(D(12, 25), "Christmas Day");
                break;
            case "BE":
                Add(D(1, 1), "New Year's Day");
                Add(e.AddDays(1), "Easter Monday");
                Add(D(5, 1), "Labour Day");
                Add(e.AddDays(39), "Ascension Day");
                Add(e.AddDays(50), "Whit Monday");
                Add(D(7, 21), "National Day");
                Add(D(8, 15), "Assumption Day");
                Add(D(11, 1), "All Saints' Day");
                Add(D(11, 11), "Armistice Day");
                Add(D(12, 25), "Christmas Day");
                break;
            case "NL":
                Add(D(1, 1), "New Year's Day");
                Add(e, "Easter Sunday");
                Add(e.AddDays(1), "Easter Monday");
                Add(D(4, 27).DayOfWeek == DayOfWeek.Sunday ? D(4, 26) : D(4, 27), "King's Day");
                Add(D(5, 5), "Liberation Day");
                Add(e.AddDays(39), "Ascension Day");
                Add(e.AddDays(49), "Whit Sunday");
                Add(e.AddDays(50), "Whit Monday");
                Add(D(12, 25), "Christmas Day");
                Add(D(12, 26), "Second Day of Christmas");
                break;
            case "ES":
                Add(D(1, 1), "New Year's Day");
                Add(D(1, 6), "Epiphany");
                Add(e.AddDays(-2), "Good Friday");
                Add(D(5, 1), "Labour Day");
                Add(D(8, 15), "Assumption Day");
                Add(D(10, 12), "National Day of Spain");
                Add(D(11, 1), "All Saints' Day");
                Add(D(12, 6), "Constitution Day");
                Add(D(12, 8), "Immaculate Conception");
                Add(D(12, 25), "Christmas Day");
                break;
            case "IT":
                Add(D(1, 1), "New Year's Day");
                Add(D(1, 6), "Epiphany");
                Add(e, "Easter Sunday");
                Add(e.AddDays(1), "Easter Monday");
                Add(D(4, 25), "Liberation Day");
                Add(D(5, 1), "Labour Day");
                Add(D(6, 2), "Republic Day");
                Add(D(8, 15), "Ferragosto");
                Add(D(11, 1), "All Saints' Day");
                Add(D(12, 8), "Immaculate Conception");
                Add(D(12, 25), "Christmas Day");
                Add(D(12, 26), "St Stephen's Day");
                break;
            case "PL":
                Add(D(1, 1), "New Year's Day");
                Add(D(1, 6), "Epiphany");
                Add(e, "Easter Sunday");
                Add(e.AddDays(1), "Easter Monday");
                Add(D(5, 1), "Labour Day");
                Add(D(5, 3), "Constitution Day");
                Add(e.AddDays(49), "Pentecost");
                Add(e.AddDays(60), "Corpus Christi");
                Add(D(8, 15), "Assumption Day");
                Add(D(11, 1), "All Saints' Day");
                Add(D(11, 11), "Independence Day");
                if (year >= 2025) Add(D(12, 24), "Christmas Eve");
                Add(D(12, 25), "Christmas Day");
                Add(D(12, 26), "Second Day of Christmas");
                break;
            case "SE":
                Add(D(1, 1), "New Year's Day");
                Add(D(1, 6), "Epiphany");
                Add(e.AddDays(-2), "Good Friday");
                Add(e, "Easter Sunday");
                Add(e.AddDays(1), "Easter Monday");
                Add(D(5, 1), "May Day");
                Add(e.AddDays(39), "Ascension Day");
                Add(D(6, 6), "National Day");
                Add(e.AddDays(49), "Whit Sunday");
                Add(OnOrAfter(D(6, 19), DayOfWeek.Friday), "Midsummer Eve");
                Add(OnOrAfter(D(6, 20), DayOfWeek.Saturday), "Midsummer Day");
                Add(OnOrAfter(D(10, 31), DayOfWeek.Saturday), "All Saints' Day");
                Add(D(12, 24), "Christmas Eve");
                Add(D(12, 25), "Christmas Day");
                Add(D(12, 26), "Boxing Day");
                Add(D(12, 31), "New Year's Eve");
                break;
            case "NO":
                Add(D(1, 1), "New Year's Day");
                Add(e.AddDays(-3), "Maundy Thursday");
                Add(e.AddDays(-2), "Good Friday");
                Add(e, "Easter Sunday");
                Add(e.AddDays(1), "Easter Monday");
                Add(D(5, 1), "Labour Day");
                Add(D(5, 17), "Constitution Day");
                Add(e.AddDays(39), "Ascension Day");
                Add(e.AddDays(49), "Whit Sunday");
                Add(e.AddDays(50), "Whit Monday");
                Add(D(12, 25), "Christmas Day");
                Add(D(12, 26), "Second Day of Christmas");
                break;
            case "DK":
                Add(D(1, 1), "New Year's Day");
                Add(e.AddDays(-3), "Maundy Thursday");
                Add(e.AddDays(-2), "Good Friday");
                Add(e, "Easter Sunday");
                Add(e.AddDays(1), "Easter Monday");
                if (year < 2024) Add(e.AddDays(26), "General Prayer Day");
                Add(e.AddDays(39), "Ascension Day");
                Add(e.AddDays(49), "Whit Sunday");
                Add(e.AddDays(50), "Whit Monday");
                Add(D(6, 5), "Constitution Day");
                Add(D(12, 25), "Christmas Day");
                Add(D(12, 26), "Second Day of Christmas");
                break;
            case "FI":
                Add(D(1, 1), "New Year's Day");
                Add(D(1, 6), "Epiphany");
                Add(e.AddDays(-2), "Good Friday");
                Add(e, "Easter Sunday");
                Add(e.AddDays(1), "Easter Monday");
                Add(D(5, 1), "May Day");
                Add(e.AddDays(39), "Ascension Day");
                Add(e.AddDays(49), "Whit Sunday");
                Add(OnOrAfter(D(6, 19), DayOfWeek.Friday), "Midsummer Eve");
                Add(OnOrAfter(D(6, 20), DayOfWeek.Saturday), "Midsummer Day");
                Add(OnOrAfter(D(10, 31), DayOfWeek.Saturday), "All Saints' Day");
                Add(D(12, 6), "Independence Day");
                Add(D(12, 24), "Christmas Eve");
                Add(D(12, 25), "Christmas Day");
                Add(D(12, 26), "St Stephen's Day");
                break;
            default:
                return [];
        }
        return h.OrderBy(x => x.Date).ToList();
    }

    /// <summary>A country's holidays between two days ([from, to)).</summary>
    public static List<Holiday> Between(string code, DateTime from, DateTime to)
    {
        var list = new List<Holiday>();
        for (var y = from.Year; y <= to.Year; y++) list.AddRange(For(code, y).Where(x => x.Date >= from.Date && x.Date < to));
        return list;
    }
}
