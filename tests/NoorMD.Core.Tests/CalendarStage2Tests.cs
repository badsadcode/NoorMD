using System.Globalization;
using NoorMD.Core.Calendar;
using Xunit;

namespace NoorMD.Core.Tests;

public class CalendarStage2Tests
{
    private static DateTime D(int y, int m, int d) => new(y, m, d);
    private static HashSet<DateTime> Days(string country, int year) => Holidays.For(country, year).Select(h => h.Date).ToHashSet();
    private static string? Name(string country, DateTime day) => Holidays.For(country, day.Year).FirstOrDefault(h => h.Date == day)?.Name;

    [Theory]
    [InlineData(2000, 4, 23)]
    [InlineData(2024, 3, 31)]
    [InlineData(2025, 4, 20)]
    [InlineData(2026, 4, 5)]
    [InlineData(2027, 3, 28)]
    [InlineData(2038, 4, 25)]
    public void Easter_falls_on_the_right_Sunday(int y, int m, int d) => Assert.Equal(D(y, m, d), Holidays.Easter(y));

    [Fact]
    public void Holidays_follow_their_rules()
    {
        // Easter-based and nth-weekday days.
        Assert.Equal("Ascension Day", Name("DE", D(2026, 5, 14)));
        Assert.Equal("Whit Monday", Name("DE", D(2026, 5, 25)));
        Assert.Equal("Thanksgiving", Name("US", D(2026, 11, 26)));
        Assert.Equal("Victoria Day", Name("CA", D(2026, 5, 18)));
        Assert.Equal("Memorial Day", Name("US", D(2026, 5, 25)));
        // Midsummer: the Friday and Saturday between 19 and 26 June; All Saints' the Saturday from 31 October.
        Assert.Equal("Midsummer Eve", Name("SE", D(2026, 6, 19)));
        Assert.Equal("Midsummer Day", Name("SE", D(2026, 6, 20)));
        Assert.Equal("Midsummer Eve", Name("FI", D(2027, 6, 25)));
        Assert.Equal("All Saints' Day", Name("SE", D(2026, 10, 31)));
        // King's Day moves off a Sunday.
        Assert.Equal("King's Day", Name("NL", D(2025, 4, 26)));
        // Changes over the years.
        Assert.Contains(D(2025, 12, 24), Days("PL", 2025));
        Assert.DoesNotContain(D(2024, 12, 24), Days("PL", 2024));
        Assert.DoesNotContain(Holidays.For("DK", 2025), h => h.Name == "General Prayer Day");
        Assert.Contains(Holidays.For("DK", 2023), h => h.Name == "General Prayer Day");
        Assert.Empty(Holidays.For("XX", 2026));
        Assert.All(Holidays.Countries, c => Assert.NotEmpty(Holidays.For(c.Code, 2026)));
    }

    [Fact]
    public void Weekend_holidays_move_where_the_country_moves_them()
    {
        // US: 4 July 2026 is a Saturday, so the day off is Friday the 3rd.
        Assert.Equal("Independence Day (observed)", Name("US", D(2026, 7, 3)));
        Assert.Equal("Christmas Day (observed)", Name("US", D(2027, 12, 24)));
        // UK 2022: Christmas on a Sunday, Boxing Day keeps Monday, Christmas moves to Tuesday.
        Assert.Equal("Boxing Day", Name("GB", D(2022, 12, 26)));
        Assert.Equal("Christmas Day (observed)", Name("GB", D(2022, 12, 27)));
        // UK 2027: both on the weekend, they move to Monday and Tuesday.
        Assert.Equal("Christmas Day (observed)", Name("GB", D(2027, 12, 27)));
        Assert.Equal("Boxing Day (observed)", Name("GB", D(2027, 12, 28)));
        // No country has two holidays on one day by moving them.
        foreach (var c in Holidays.Countries)
            for (var y = 2020; y <= 2035; y++)
            {
                var observed = Holidays.For(c.Code, y).Where(h => h.Name.EndsWith("(observed)", StringComparison.Ordinal)).Select(h => h.Date).ToList();
                Assert.Equal(observed.Count, observed.Distinct().Count());
            }
        // Between spans the years.
        Assert.Equal(["Christmas Day", "Second Day of Christmas", "New Year's Day"], Holidays.Between("NL", D(2026, 12, 20), D(2027, 1, 5)).Select(h => h.Name));
    }

    private static CalendarEntry Stream(string id, string start, string end, string title, string? game = null, CalendarRepeat? repeat = null) =>
        CalendarCheck.Clamped(new CalendarEntry { Id = id, Title = title, Category = "stream", Start = start, End = end, Game = game, Platform = "Twitch", Repeat = repeat });

    private static readonly CalendarEntry[] Entries =
    [
        // Every Friday 19:00–22:00 from 6 November 2026, and a one-off on Tuesday the 10th.
        Stream("fri", "2026-11-06T19:00", "2026-11-06T22:00", "Friday night", "Elden Ring", new CalendarRepeat { Freq = "weekly" }),
        Stream("tue", "2026-11-10T20:00", "2026-11-10T21:30", "Speedrun practice", "Celeste"),
        CalendarCheck.Clamped(new CalendarEntry { Id = "bday", Title = "Ana", Category = "birthday", AllDay = true, Start = "2026-11-11", End = "2026-11-11", SinceYear = 1996, Repeat = new CalendarRepeat { Freq = "yearly" } }),
    ];

    [Fact]
    public void The_next_stream_is_the_one_on_now_or_the_coming_one()
    {
        var next = StreamSchedule.Next(Entries, new DateTime(2026, 11, 6, 20, 30, 0))!;
        Assert.Equal("fri", next.EntryId);
        Assert.True(next.LiveAt(new DateTime(2026, 11, 6, 20, 30, 0)));
        Assert.Equal("tue", StreamSchedule.Next(Entries, new DateTime(2026, 11, 6, 22, 0, 0))!.EntryId);
        Assert.Equal(new DateTime(2026, 11, 13, 19, 0, 0), StreamSchedule.Next(Entries, new DateTime(2026, 11, 11, 9, 0, 0))!.Start);
        // Only streams count: the birthday is not one.
        Assert.All(StreamSchedule.Between(Entries, D(2026, 11, 1), D(2026, 12, 1)), s => Assert.NotEqual("bday", s.EntryId));
        Assert.Null(StreamSchedule.Next([], DateTime.Now));
    }

    [Fact]
    public void A_week_starts_on_Monday_or_Sunday()
    {
        Assert.Equal(D(2026, 11, 9), StreamSchedule.WeekStart(D(2026, 11, 13), mondayFirst: true));
        Assert.Equal(D(2026, 11, 8), StreamSchedule.WeekStart(D(2026, 11, 13), mondayFirst: false));
        var week = StreamSchedule.Week(Entries, D(2026, 11, 12), true);
        Assert.Equal(["tue", "fri"], week.Select(s => s.EntryId));
    }

    [Fact]
    public void The_schedule_as_text_for_Discord_X_and_plain()
    {
        var culture = CultureInfo.GetCultureInfo("en-GB");
        var zone = TimeZoneInfo.Utc;
        var start = D(2026, 11, 9);
        var week = StreamSchedule.Week(Entries, start, true);
        var discord = StreamSchedule.Text(week, "discord", start, "Stream schedule", culture, zone);
        // Discord's own time stamps: each reader sees their own time zone.
        var unix = new DateTimeOffset(2026, 11, 10, 20, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds();
        Assert.Contains($"<t:{unix}:F>", discord);
        Assert.Contains("**Speedrun practice** · Celeste · Twitch", discord);
        Assert.StartsWith("**📅 Stream schedule · 9–15 Nov**", discord);
        var x = StreamSchedule.Text(week, "x", start, "Stream schedule", culture, zone);
        Assert.True(x.Length <= 280);
        Assert.Contains("Tue 20:00 Celeste", x);
        var plain = StreamSchedule.Text(week, "plain", start, "Stream schedule", culture, zone);
        Assert.Contains("Fri 13 Nov  19:00–22:00  Friday night · Elden Ring · Twitch", plain);
        Assert.Contains("UTC", plain);
        Assert.Contains("No streams planned", StreamSchedule.Text([], "plain", start, "Stream schedule", culture, zone));
        // Very many streams still fit X.
        var many = Enumerable.Range(0, 40).Select(i => new StreamSlot($"s{i}", "A long stream title number " + i, "Some game with a long name", "Twitch", "", start.AddHours(i * 4), start.AddHours(i * 4 + 2), false)).ToList();
        var crowded = StreamSchedule.Text(many, "x", start, "Stream schedule", culture, zone);
        Assert.True(crowded.Length <= 280);
        Assert.EndsWith("…", crowded);
    }

    [Fact]
    public void An_agenda_block_for_a_note()
    {
        var md = StreamSchedule.Agenda(Entries, D(2026, 11, 9), 7, CultureInfo.GetCultureInfo("en-GB"), Holidays.Between("US", D(2026, 11, 9), D(2026, 11, 16)));
        Assert.StartsWith("## Agenda · 9 Nov – 15 Nov 2026", md);
        Assert.Contains("**Tuesday 10 November**\n- 20:00 Speedrun practice · Celeste", md);
        Assert.Contains("- Ana (30)", md);
        Assert.Contains("- 🎌 Veterans Day", md);
        Assert.Contains("Nothing planned", StreamSchedule.Agenda([], D(2026, 11, 9), 7, CultureInfo.InvariantCulture));
    }
}
