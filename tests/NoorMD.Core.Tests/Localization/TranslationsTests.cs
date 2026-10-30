using System.Text.Json;
using NoorMD.Core.Localization;
using Xunit;

namespace NoorMD.Core.Tests.Localization;

/// <summary>Languages: the built-in lines, your own over them, the list with how much is done, and a file to fill in.</summary>
public class TranslationsTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "noormd-i18n-" + Guid.NewGuid().ToString("N"));
    private string BuiltIn => Path.Combine(_root, "lang");
    private string Yours => Path.Combine(_root, "Translations");

    public TranslationsTests()
    {
        Directory.CreateDirectory(BuiltIn); Directory.CreateDirectory(Yours);
        File.WriteAllText(Path.Combine(BuiltIn, "en.json"), """{ "_language": "English", "File": "", "Edit": "", "{0} words": "" }""");
        File.WriteAllText(Path.Combine(BuiltIn, "pl.json"), """{ "_language": "Polski", "File": "Plik", "Edit": "Edycja", "{0} words": "" }""");
        File.WriteAllText(Path.Combine(Yours, "pl.json"), """{ "Edit": "Edytuj", "{0} words": "{0} słów", }""");   // a trailing comma is forgiven
        File.WriteAllText(Path.Combine(Yours, "it.json"), """{ "_language": "Italiano", "File": "File" }""");
        File.WriteAllText(Path.Combine(Yours, "not a code.json"), "{}");
        File.WriteAllText(Path.Combine(Yours, "de.json"), "{ broken");
    }

    public void Dispose() { try { Directory.Delete(_root, true); } catch (IOException) { } }

    [Fact]
    public void Your_lines_win_over_the_built_in_ones_and_empty_ones_stay_english()
    {
        var pl = Translations.Load("pl", BuiltIn, Yours);
        Assert.Equal("Plik", pl["File"]);
        Assert.Equal("Edytuj", pl["Edit"]);
        Assert.Equal("{0} słów", pl["{0} words"]);
        Assert.Empty(Translations.Load("en", BuiltIn, Yours));
        Assert.Empty(Translations.Load("../pl", BuiltIn, Yours));
        Assert.Empty(Translations.Load("de", BuiltIn, Yours)); // a broken file gives nothing, not an error
    }

    [Fact]
    public void The_list_names_each_language_and_how_much_is_translated()
    {
        var list = Translations.List(BuiltIn, Yours);
        Assert.Equal(["en", "de", "it", "pl"], list.Select(l => l.Code));
        var pl = list.Single(l => l.Code == "pl");
        Assert.Equal(("Polski", true, true, 3, 3), (pl.Name, pl.BuiltIn, pl.Yours, pl.Done, pl.Total));
        var it = list.Single(l => l.Code == "it");
        Assert.Equal(("Italiano", false, 1), (it.Name, it.BuiltIn, it.Done));
    }

    [Fact]
    public void A_file_to_fill_in_has_every_text_with_what_is_done()
    {
        var json = Translations.Template("pl", "Polski", Translations.Keys(BuiltIn), Translations.Load("pl", BuiltIn, Yours));
        using var doc = JsonDocument.Parse(json);
        var o = doc.RootElement;
        Assert.Equal("Polski", o.GetProperty("_language").GetString());
        Assert.Equal("Plik", o.GetProperty("File").GetString());
        Assert.Equal("{0} słów", o.GetProperty("{0} words").GetString());
        Assert.Contains("słów", json); // written as it reads, not escaped
        Assert.Equal("", JsonDocument.Parse(Translations.Template("sv", "Svenska", Translations.Keys(BuiltIn), new Dictionary<string, string>())).RootElement.GetProperty("Edit").GetString());
    }

    [Fact]
    public void Codes_are_short_language_codes_only()
    {
        Assert.True(Translations.IsCode("pl")); Assert.True(Translations.IsCode("pt-BR")); Assert.True(Translations.IsCode("en"));
        Assert.False(Translations.IsCode("PL")); Assert.False(Translations.IsCode("../x")); Assert.False(Translations.IsCode("")); Assert.False(Translations.IsCode(null));
        Tr.Use(new Dictionary<string, string> { ["Open a sprite"] = "Otwórz sprite", ["{0} pictures"] = "{0} obrazów" });
        Assert.Equal("Otwórz sprite", Tr.T("Open a sprite"));
        Assert.Equal("Save", Tr.T("Save"));
        Assert.Equal("3 obrazów", Tr.T("{0} pictures", 3));
        Tr.Use([]);
    }
}
