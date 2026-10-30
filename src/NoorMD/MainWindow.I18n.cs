using System.IO;
using Microsoft.Win32;
using NoorMD.Core.Bridge;
using NoorMD.Core.Localization;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// Languages (Core/Localization): the built-in ones beside the page (wwwroot/lang), your own in Documents\NoorMD\
/// Translations. The page asks for the chosen language's lines and translates itself at once; the app's own dialogs
/// use the language chosen when NoorMD started (Tr).
/// </summary>
public partial class MainWindow
{
    private static string BuiltInLanguages => Path.Combine(AppContext.BaseDirectory, "wwwroot", "lang");
    private static string YourTranslations => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "NoorMD", "Translations");

    /// <summary>The app's own words in the language of this start.</summary>
    private void UseStartLanguage()
    {
        try { Tr.Use(Translations.Load(_settings.Prefs.Language, BuiltInLanguages, YourTranslations)); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { NoorMD.Core.Log.Error("Reading the translation failed", ex); }
    }

    private async Task<object?> DispatchI18nAsync(BridgeRequest req)
    {
        switch (req.Type)
        {
            case "i18n.languages":
                return await Task.Run(() => new { languages = Translations.List(BuiltInLanguages, YourTranslations), folder = YourTranslations, start = _startLanguage });
            case "i18n.load":
            {
                var code = req.GetString("code", 20) ?? "en";
                if (!Translations.IsCode(code)) throw new BridgeError("That isn't a language code.");
                return await Task.Run(() => new { code, lines = Translations.Load(code, BuiltInLanguages, YourTranslations) });
            }
            case "i18n.template":
            {
                // A file to translate: every English text, with what the language has already.
                var code = req.GetString("code", 20) ?? "";
                var name = req.GetString("name", 80) ?? code;
                if (!Translations.IsCode(code) || code == "en") throw new BridgeError("Give the language a code first (like it, pt-BR).");
                Directory.CreateDirectory(YourTranslations);
                var dlg = new SaveFileDialog { Title = Tr.T("Save a translation to fill in"), FileName = code + ".json", InitialDirectory = YourTranslations, Filter = Tr.T("Translation (*.json)|*.json"), AddExtension = true };
                NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var text = await Task.Run(() => Translations.Template(code, name, Translations.Keys(BuiltInLanguages), Translations.Load(code, BuiltInLanguages, YourTranslations)));
                NoorMD.Core.Documents.AtomicFile.WriteAllText(dlg.FileName, text);
                return new { path = dlg.FileName, name = Path.GetFileName(dlg.FileName) };
            }
            case "i18n.folder":
                Directory.CreateDirectory(YourTranslations);
                OpenFolder(YourTranslations);
                return new { folder = YourTranslations };
            default:
                throw new BridgeError("Unknown request: " + req.Type);
        }
    }
}
