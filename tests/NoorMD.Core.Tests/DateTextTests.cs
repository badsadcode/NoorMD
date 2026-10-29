using System.Globalization;
using NoorMD.Core.Calendar;
using Xunit;

namespace NoorMD.Core.Tests;

public class DateTextTests
{
    // Wednesday 28 October 2026, 10:00.
    private static readonly DateTime Now = new(2026, 10, 28, 10, 0, 0);
    private static readonly CultureInfo Gb = CultureInfo.GetCultureInfo("en-GB"), Us = CultureInfo.GetCultureInfo("en-US"), De = CultureInfo.GetCultureInfo("de-DE");

    private static DateText.Found F(string s, CultureInfo? c = null) => DateText.Find(s, Now, c ?? Gb) ?? throw new Xunit.Sdk.XunitException("nothing found in: " + s);

    [Theory]
    [InlineData("Dentist 2026-11-14 at 9:30", 2026, 11, 14, 9, 30, "Dentist")]
    [InlineData("- [ ] Friday 14 Nov 19:00 Stream with Ola", 2026, 11, 14, 19, 0, "Stream with Ola")]
    [InlineData("November 14th, 2026 at 7pm: **Concert**", 2026, 11, 14, 19, 0, "Concert")]
    [InlineData("Call mum tomorrow at 18", 2026, 10, 29, 18, 0, "Call mum")]
    [InlineData("Meeting 14.11. 10:30–12:00", 2026, 11, 14, 10, 30, "Meeting")]
    public void Finds_the_day_and_time_and_keeps_the_rest_as_the_title(string text, int y, int mo, int d, int h, int mi, string title)
    {
        var f = F(text);
        Assert.False(f.AllDay);
        Assert.Equal(new DateTime(y, mo, d, h, mi, 0), f.Start);
        Assert.Equal(title, f.Title);
    }

    [Fact]
    public void A_range_gives_the_end_and_am_pm_carries_over()
    {
        var f = F("Game night 7-10pm on Saturday");
        Assert.Equal(new DateTime(2026, 10, 31, 19, 0, 0), f.Start);
        Assert.Equal(new DateTime(2026, 10, 31, 22, 0, 0), f.End);
        Assert.Equal("Game night", f.Title);
        Assert.Equal(new DateTime(2026, 11, 14, 12, 0, 0), F("Meeting 14.11. 10:30–12:00").End);
    }

    [Fact]
    public void A_day_without_a_time_is_all_day_and_a_past_day_means_next_year()
    {
        var f = F("Ola's birthday 3 March");
        Assert.True(f.AllDay);
        Assert.Equal(new DateTime(2027, 3, 3), f.Start);
        Assert.Equal("Ola's birthday", f.Title);
        Assert.Equal(new DateTime(2026, 12, 24), F("24/12 Christmas eve").Start);
    }

    [Fact]
    public void Weekdays_are_the_next_one_and_next_means_a_week_on_when_it_is_today()
    {
        Assert.Equal(new DateTime(2026, 10, 30), F("Friday: tidy up").Start.Date);
        Assert.Equal(new DateTime(2026, 10, 28), F("Wednesday review").Start.Date);
        Assert.Equal(new DateTime(2026, 11, 4), F("next Wednesday review").Start.Date);
        Assert.Equal("review", F("next Wednesday review").Title);
    }

    [Fact]
    public void The_culture_decides_month_first_and_its_own_names_work()
    {
        Assert.Equal(new DateTime(2026, 11, 3), F("Vet 11/3", Us).Start.Date);
        Assert.Equal(new DateTime(2027, 3, 11), F("Vet 11/3", Gb).Start.Date);
        var de = F("Zahnarzt am 5. Dezember um 14:15", De);
        Assert.Equal(new DateTime(2026, 12, 5, 14, 15, 0), de.Start);
        Assert.Equal(new DateTime(2026, 11, 2), F("Montag Sport", De).Start.Date);
    }

    [Fact]
    public void A_time_alone_is_today_or_tomorrow_and_plain_numbers_are_not_times()
    {
        Assert.Equal(new DateTime(2026, 10, 28, 19, 0, 0), F("Stream 19:00").Start);
        Assert.Equal(new DateTime(2026, 10, 29, 8, 0, 0), F("Run at 8am").Start);
        Assert.Null(DateText.Find("Buy 3 apples and 12 eggs", Now, Gb));
        Assert.Null(DateText.Find("", Now, Gb));
    }
}
