using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Media;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// Sound Bench: procedural sound effects and ambiences. The page edits a recipe; the app renders it (the same recipe and
/// seed always give the same sound), serves the preview from memory at /_sound/{key}.wav, and exports WAV files with the
/// recipe next to them. Your own presets are recipes kept in the local data folder.
/// </summary>
public partial class MainWindow
{
    private const int SoundRate = 48000;
    private const double PreviewSeconds = 30;
    private readonly Dictionary<string, byte[]> _soundPreviews = new(StringComparer.Ordinal);
    private readonly Queue<string> _soundPreviewOrder = new();
    private readonly HashSet<string> _soundFolders = new(StringComparer.OrdinalIgnoreCase);
    private static readonly SemaphoreSlim SoundGate = new(1);

    private static string UserSoundFolder => Path.Combine(App.Paths.Local, "Sound", "Presets");

    /// <summary>Serves /_sound/{key}.wav: a preview rendered moments ago.</summary>
    private bool TryServeSound(Uri uri, CoreWebView2WebResourceRequestedEventArgs e, CoreWebView2Environment env)
    {
        var path = uri.AbsolutePath;
        if (!path.StartsWith("/_sound/", StringComparison.Ordinal)) return false;
        var key = Path.GetFileNameWithoutExtension(path[8..]);
        byte[]? wav;
        lock (_soundPreviews) _soundPreviews.TryGetValue(key, out wav);
        e.Response = wav != null
            ? env.CreateWebResourceResponse(new MemoryStream(wav), 200, "OK", "Content-Type: audio/wav\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff")
            : env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
        return true;
    }

    private static SoundRecipe RecipeFrom(JsonElement p)
    {
        if (!p.TryGetProperty("recipe", out var r) || r.ValueKind != JsonValueKind.Object) throw new BridgeError("Missing the sound recipe.");
        var raw = r.GetRawText();
        if (raw.Length > 200_000) throw new BridgeError("That recipe is too big.");
        try { return SoundRecipe.FromJson(raw); }
        catch (JsonException ex) { throw new BridgeError("The recipe can't be read: " + ex.Message); }
    }

    private static JsonElement RecipeForPage(SoundRecipe r) => JsonDocument.Parse(r.ToJson()).RootElement.Clone();

    private static object UserPresets()
    {
        var list = new List<object>();
        if (!Directory.Exists(UserSoundFolder)) return list;
        foreach (var f in Directory.EnumerateFiles(UserSoundFolder, "*.json").OrderBy(f => f, StringComparer.CurrentCultureIgnoreCase))
        {
            try
            {
                var r = SoundRecipe.FromJson(File.ReadAllText(f));
                list.Add(new { id = "user:" + Path.GetFileName(f), family = r.Family, name = r.Name, description = "Your preset" });
            }
            catch (Exception ex) when (ex is JsonException or IOException or ArgumentException) { /* a broken file is left out */ }
        }
        return list;
    }

    private static string UserPresetPath(string id)
    {
        var file = id.StartsWith("user:", StringComparison.Ordinal) ? id[5..] : "";
        if (file.Length == 0 || file != Path.GetFileName(file) || !file.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) throw new BridgeError("Unknown preset.");
        return Path.Combine(UserSoundFolder, file);
    }

    private async Task<object?> DispatchSoundAsync(BridgeRequest req)
    {
        var p = req.Payload;
        try
        {
            switch (req.Type)
            {
                case "sound.presets":
                    return new { builtIn = SoundPresets.All.Select(x => new { id = x.Id, family = x.Family, name = x.Name, description = x.Description }), mine = UserPresets() };
                case "sound.preset":
                {
                    var id = req.GetString("id", 300) ?? "";
                    var recipe = id.StartsWith("user:", StringComparison.Ordinal) ? SoundRecipe.FromJson(await File.ReadAllTextAsync(UserPresetPath(id))) : SoundPresets.Make(id);
                    return RecipeForPage(recipe);
                }
                case "sound.render":
                {
                    // A preview: at most the first 30 seconds (a long ambience is exported in full).
                    var recipe = RecipeFrom(p);
                    var cut = recipe.Duration > PreviewSeconds;
                    if (cut) { recipe.Duration = PreviewSeconds; }
                    var json = recipe.ToJson();
                    var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json)))[..20].ToLowerInvariant();
                    SoundRender render;
                    await SoundGate.WaitAsync();
                    try { render = await Task.Run(() => SoundEngine.Render(recipe, SoundRate)); } finally { SoundGate.Release(); }
                    var wav = render.ToWav(16);
                    lock (_soundPreviews)
                    {
                        if (!_soundPreviews.ContainsKey(key)) { _soundPreviews[key] = wav; _soundPreviewOrder.Enqueue(key); }
                        while (_soundPreviewOrder.Count > 6) _soundPreviews.Remove(_soundPreviewOrder.Dequeue());
                    }
                    return new
                    {
                        url = $"/_sound/{key}.wav", seconds = render.Seconds, peakDb = render.PeakDb, rmsDb = render.RmsDb, cut,
                        peaks = render.Peaks(600).Select(v => MathF.Round(v, 3)),
                    };
                }
                case "sound.export":
                {
                    var recipe = RecipeFrom(p);
                    var count = Math.Clamp((int)(NoorMD.Core.Bridge.Json.OptDouble(p, "variations") ?? 1), 1, 20);
                    var bits = (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "bits") ?? 16) == 24 ? 24 : 16;
                    var rate = (int)(NoorMD.Core.Bridge.Json.OptDouble(p, "sampleRate") ?? SoundRate) == 44100 ? 44100 : 48000;
                    var dlg = new OpenFolderDialog { Title = $"Save “{recipe.Name}” ({count} file{(count == 1 ? "" : "s")}) in… (you can make a new folder here)" };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    var folder = dlg.FolderName;
                    var stem = NoorMD.Core.Documents.DocumentFile.SafeFileName(recipe.Name.Replace(' ', '_'), ".wav");
                    stem = Path.GetFileNameWithoutExtension(stem);
                    var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    var files = new List<string>();
                    for (var i = 0; i < count; i++)
                    {
                        var v = recipe.Clone();
                        v.Seed = recipe.Seed + i;
                        var name = count == 1 ? stem : $"{stem}_{i + 1:00}";
                        var path = PictureConvert.FreePath(folder, name, ".wav", taken);
                        var render = await Task.Run(() => SoundEngine.Render(v, rate));
                        await File.WriteAllBytesAsync(path, render.ToWav(bits));
                        files.Add(path);
                        PushEvent("sound.exportProgress", new { done = i + 1, total = count });
                    }
                    // The recipe goes with the sounds, so they can be made again or changed later.
                    var recipePath = PictureConvert.FreePath(folder, stem + ".noorsound", ".json", taken);
                    await File.WriteAllTextAsync(recipePath, recipe.ToJson(), new UTF8Encoding(false));
                    _soundFolders.Add(folder);
                    Log.Info($"Sound Bench: exported {files.Count} file(s) of “{recipe.Name}”");
                    return new { folder, files = files.Select(Path.GetFileName), recipe = Path.GetFileName(recipePath) };
                }
                case "sound.reveal":
                {
                    var folder = req.GetString("folder", 4000) ?? "";
                    if (!_soundFolders.Contains(folder) || !Directory.Exists(folder)) throw new BridgeError("That is not a folder the sounds went to.");
                    Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = false, ArgumentList = { folder } });
                    return null;
                }
                case "sound.save":
                {
                    var recipe = RecipeFrom(p);
                    Directory.CreateDirectory(UserSoundFolder);
                    var file = NoorMD.Core.Documents.DocumentFile.SafeFileName(recipe.Name, ".json");
                    var path = Path.Combine(UserSoundFolder, file);
                    var replaced = File.Exists(path);
                    await File.WriteAllTextAsync(path, recipe.ToJson(), new UTF8Encoding(false));
                    return new { id = "user:" + file, replaced, mine = UserPresets() };
                }
                case "sound.delete":
                    File.Delete(UserPresetPath(req.GetString("id", 300) ?? ""));
                    return new { mine = UserPresets() };
                case "sound.open":
                {
                    var dlg = new OpenFileDialog { Title = "Open a sound recipe", Filter = "Sound recipes (*.noorsound.json;*.json)|*.noorsound.json;*.json", CheckFileExists = true };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    if (new FileInfo(dlg.FileName).Length > 200_000) throw new BridgeError("That file is too big for a sound recipe.");
                    return new { recipe = RecipeForPage(SoundRecipe.FromJson(await File.ReadAllTextAsync(dlg.FileName))) };
                }
                default: throw new BridgeError($"Unknown command \"{req.Type}\".");
            }
        }
        catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
        catch (JsonException ex) { throw new BridgeError("The recipe can't be read: " + ex.Message); }
    }
}
