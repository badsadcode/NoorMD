using System.Text.RegularExpressions;
using NoorMD.Core.Settings;
using Xunit;

namespace NoorMD.Core.Tests;

public class ThemeCatalogTests
{
    private static string ThemesCss()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null && !File.Exists(Path.Combine(dir, "NoorMD.sln"))) dir = Path.GetDirectoryName(dir);
        return File.ReadAllText(Path.Combine(dir!, "src", "NoorMD", "wwwroot", "css", "themes.css"));
    }

    private static Dictionary<string, Dictionary<string, string>> ParseCss()
    {
        var result = new Dictionary<string, Dictionary<string, string>>();
        foreach (Match block in Regex.Matches(ThemesCss(), @"\[data-theme=([a-z]+)\][^{]*\{([^}]*)\}"))
        {
            var vars = new Dictionary<string, string>();
            foreach (Match v in Regex.Matches(block.Groups[2].Value, @"(--[a-z0-9-]+):\s*([^;]+);")) vars[v.Groups[1].Value] = v.Groups[2].Value.Trim();
            result[block.Groups[1].Value] = vars;
        }
        return result;
    }

    [Fact]
    public void Catalog_Matches_ThemesCss()
    {
        var css = ParseCss();
        Assert.Equal(ThemeCatalog.All.Select(t => t.Id).OrderBy(x => x), css.Keys.OrderBy(x => x));
        foreach (var t in ThemeCatalog.All)
        {
            var v = css[t.Id];
            Assert.Equal(t.Bg, v["--bg"]);
            Assert.Equal(t.Panel, v["--panel"]);
            Assert.Equal(t.Surface, v["--surface"]);
            Assert.Equal(t.Surface2, v["--surface2"]);
            Assert.Equal(t.Border, v["--border"]);
            Assert.Equal(t.Text, v["--text"]);
            Assert.Equal(t.Muted, v["--muted"]);
            Assert.Equal(t.Accent, v["--accent"]);
            Assert.Equal(t.OnAccent, v["--on-accent"]);
            Assert.Equal(t.IsDark ? "dark" : "light", v["--theme-scheme"]);
            Assert.Equal($"\"{t.Label}\"", v["--theme-label"]);
        }
    }

    private static double Luminance(string hex)
    {
        double C(int i) { var c = Convert.ToInt32(hex.Substring(1 + i * 2, 2), 16) / 255.0; return c <= 0.03928 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4); }
        return 0.2126 * C(0) + 0.7152 * C(1) + 0.0722 * C(2);
    }
    private static double Ratio(string a, string b)
    {
        var (x, y) = (Luminance(a), Luminance(b));
        return (Math.Max(x, y) + 0.05) / (Math.Min(x, y) + 0.05);
    }

    public static IEnumerable<object[]> ThemeIds => ThemeCatalog.All.Select(t => new object[] { t.Id });

    [Theory]
    [MemberData(nameof(ThemeIds))]
    public void Theme_Meets_Contrast_Minimums(string id)
    {
        var v = ParseCss()[id];
        string P(string name) => v[name][..7];
        Assert.True(Ratio(P("--text"), P("--panel")) >= 7, "text");
        Assert.True(Ratio(P("--text"), P("--surface2")) >= 7, "text on surface2");
        foreach (var name in new[] { "--muted", "--accent", "--tok-heading", "--tok-link", "--tok-code", "--tok-quote" })
            Assert.True(Ratio(P(name), P("--panel")) >= 4.5, name);
        Assert.True(Ratio(P("--muted"), P("--surface")) >= 4.5, "muted on surface");
        Assert.True(Ratio(P("--accent"), P("--surface2")) >= 4.5, "accent on surface2 (active tab)");
        Assert.True(Ratio(P("--on-accent"), P("--accent")) >= 4.5, "text on accent buttons");
        Assert.True(Ratio(P("--tok-delim"), P("--panel")) >= 3, "delimiters");
        Assert.True(Ratio(P("--tok-gutter"), P("--panel")) >= 3, "line numbers");
    }

    [Fact]
    public void Prefs_Accept_Only_Known_Themes()
    {
        var p = new EditorPrefs();
        using var a = System.Text.Json.JsonDocument.Parse("""{"theme":"evergreen"}""");
        p.Apply(a.RootElement);
        Assert.Equal("evergreen", p.Theme);
        using var b = System.Text.Json.JsonDocument.Parse("""{"theme":"../../evil"}""");
        p.Apply(b.RootElement);
        Assert.Equal("evergreen", p.Theme);
    }
}
