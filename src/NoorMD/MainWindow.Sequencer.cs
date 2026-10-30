using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Export;
using NoorMD.Media;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// NoorSequencer: the page edits a song (tracks × bars of numbered patterns); the app renders it with the same code for
/// listening and exporting, and serves the preview from memory at /_sound/{key}.wav like NoorSound. Export writes
/// the mix, a seamless loop, stems and MIDI with the song's recipe beside them. Your songs are recipes in the local data folder.
/// </summary>
public partial class MainWindow
{
    /// <summary>The longest stretch rendered for listening at once (a long song plays from the bar you choose).</summary>
    private const double SongPreviewSeconds = 240;
    private readonly HashSet<string> _songFolders = new(StringComparer.OrdinalIgnoreCase);
    private static string UserSongFolder => Path.Combine(App.Paths.Local, "Sequencer", "Songs");

    private void AllowSamples(SongRecipe r)
    {
        foreach (var path in r.Files()) { try { _soundSampleFiles.Add(Path.GetFullPath(path)); } catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { } }
    }

    private object FontForPage(string path)
    {
        var font = LoadSample(path)?.Font ?? throw new BridgeError("That SoundFont can't be read (or it is no longer where it was).");
        return new
        {
            path = Path.GetFullPath(path), name = font.Name.Length > 0 && font.Name != "SoundFont" ? font.Name : Path.GetFileNameWithoutExtension(path),
            presets = font.Presets.Select(p => new { index = p.Index, name = p.Name, bank = p.Bank, program = p.Program }),
        };
    }

    private static SongRecipe SongFrom(JsonElement p)
    {
        if (!p.TryGetProperty("song", out var r) || r.ValueKind != JsonValueKind.Object) throw new BridgeError("Missing the song.");
        var raw = r.GetRawText();
        if (raw.Length > 2_000_000) throw new BridgeError("That song is too big.");
        try { return SongRecipe.FromJson(raw); }
        catch (JsonException ex) { throw new BridgeError("The song can't be read: " + ex.Message); }
    }

    private static JsonElement SongForPage(SongRecipe r) => JsonDocument.Parse(r.ToJson()).RootElement.Clone();

    /// <summary>Only files already allowed are kept, so a song can't smuggle in another path.</summary>
    private void DropUnallowedFiles(SongRecipe song)
    {
        bool Allowed(string path) { try { return _soundSampleFiles.Contains(Path.GetFullPath(path)); } catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException) { return false; } }
        foreach (var t in song.Tracks)
            if (!string.IsNullOrEmpty(t.Instrument.Path) && !Allowed(t.Instrument.Path)) t.Instrument.Path = null;
        foreach (var fx in song.Tracks.SelectMany(t => t.Effects).Concat(song.MasterEffects))
            if (fx.Type == "convolution" && !string.IsNullOrEmpty(fx.IrPath) && !Allowed(fx.IrPath)) fx.IrPath = null;
    }

    private string Serve(SoundRender render, string what)
    {
        var wav = render.ToWav(16);
        var key = "s" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(what)))[..19].ToLowerInvariant();
        lock (_soundPreviews)
        {
            if (!_soundPreviews.ContainsKey(key)) { _soundPreviews[key] = wav; _soundPreviewOrder.Enqueue(key); }
            // A few minutes of song is tens of megabytes: keep the newest few, and not too much at once.
            while (_soundPreviewOrder.Count > 8 || (_soundPreviewOrder.Count > 1 && _soundPreviews.Values.Sum(w => (long)w.Length) > 160L * 1024 * 1024))
                _soundPreviews.Remove(_soundPreviewOrder.Dequeue());
        }
        return $"/_sound/{key}.wav";
    }

    private static object UserSongs()
    {
        var list = new List<object>();
        if (!Directory.Exists(UserSongFolder)) return list;
        foreach (var f in Directory.EnumerateFiles(UserSongFolder, "*.json").OrderBy(f => f, StringComparer.CurrentCultureIgnoreCase))
        {
            try
            {
                var r = SongRecipe.FromJson(File.ReadAllText(f));
                list.Add(new { id = "user:" + Path.GetFileName(f), name = r.Name, family = r.Family, description = $"{r.Bars} bars · {r.Tempo:0} BPM" });
            }
            catch (Exception ex) when (ex is JsonException or IOException or ArgumentException) { /* a broken file is left out */ }
        }
        return list;
    }

    private static string UserSongPath(string id)
    {
        var file = id.StartsWith("user:", StringComparison.Ordinal) ? id[5..] : "";
        if (file.Length == 0 || file != Path.GetFileName(file) || !file.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) throw new BridgeError("Unknown song.");
        return Path.Combine(UserSongFolder, file);
    }

    /// <summary>The song kept in the open Vault (Music folder) with an OGG of it (its loop, or the first minute), to find, link and open again.</summary>
    private async Task<string> SaveSongToVaultAsync(SongRecipe song, string stem)
    {
        var v = _vault ?? throw new BridgeError("Open a Vault first.");
        var folder = Path.Combine(v.Root, "Music");
        Directory.CreateDirectory(folder);
        var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var recipePath = PictureConvert.FreePath(folder, stem + ".noorsong", ".json", taken);
        var listen = PictureConvert.FreePath(folder, Path.GetFileNameWithoutExtension(Path.GetFileNameWithoutExtension(recipePath)), ".ogg", taken);
        var looped = song.LoopEnd - song.LoopStart < song.Bars;
        var render = await Task.Run(() => looped ? SequencerEngine.Render(song, SoundRate, true, LoadSample)
            : SequencerEngine.RenderBars(song, 0, Math.Min(song.Bars, Math.Max(1, (int)(60 / song.BarSeconds))), SoundRate, LoadSample));
        await File.WriteAllBytesAsync(listen, await Task.Run(() => SoundOgg.Encode(render, 0.4, song.Name, looped)));
        await File.WriteAllTextAsync(recipePath, song.ToJson(), new UTF8Encoding(false));
        ScheduleRescan(0);
        return Path.GetRelativePath(v.Root, recipePath).Replace('\\', '/');
    }

    private async Task<object?> DispatchSequencerAsync(BridgeRequest req)
    {
        var p = req.Payload;
        try
        {
            switch (req.Type)
            {
                case "seq.templates":
                    return new
                    {
                        templates = SongTemplates.All.Select(t => new { id = t.Id, name = t.Name, description = t.Description }), mine = UserSongs(),
                        scales = SongScales.All.Keys, kit = SongRecipe.KitRows,
                    };
                case "seq.template":
                {
                    var id = req.GetString("id", 300) ?? "";
                    var song = id.StartsWith("user:", StringComparison.Ordinal) ? SongRecipe.FromJson(await File.ReadAllTextAsync(UserSongPath(id))) : SongTemplates.Make(id) ?? throw new BridgeError("Unknown template.");
                    AllowSamples(song);
                    return SongForPage(song);
                }
                case "seq.render":
                {
                    // Listening: the loop (played over and over), or from a bar on, at most a few minutes at once.
                    var song = SongFrom(p);
                    var loop = p.TryGetProperty("loop", out var l) && l.ValueKind == JsonValueKind.True;
                    int from = loop ? song.LoopStart : Math.Clamp((int)(Json.OptDouble(p, "fromBar") ?? 0), 0, song.Bars - 1);
                    var most = Math.Max(1, (int)(SongPreviewSeconds / song.BarSeconds));
                    int to = loop ? song.LoopEnd : Math.Min(song.Bars, from + most);
                    var cut = !loop && to < song.Bars;
                    // An adaptive layer: only its tracks, at the level shared by all layers (as exported).
                    var layer = req.GetString("layer", 8) is { Length: > 0 } id && song.Layers.Any(x => x.Id == id) ? id : null;
                    SoundRender render;
                    await SoundGate.WaitAsync();
                    try
                    {
                        render = await Task.Run(() => layer != null
                            ? loop ? SequencerEngine.RenderLayers(song, SoundRate, true, LoadSample).Single(x => x.Layer.Id == layer).Render : SequencerEngine.RenderLayerBars(song, layer, from, to, SoundRate, LoadSample)
                            : loop ? SequencerEngine.Render(song, SoundRate, true, LoadSample) : SequencerEngine.RenderBars(song, from, to, SoundRate, LoadSample));
                    }
                    finally { SoundGate.Release(); }
                    var url = Serve(render, $"{song.ToJson()}|{loop}|{from}|{to}|{layer}");
                    return new { url, seconds = render.Seconds, fromBar = from, toBar = to, barSeconds = song.BarSeconds, loop, cut, layer, peakDb = render.PeakDb, warnings = render.Warnings,
                        levels = render.Levels?.Select(x => new { name = x.Name, peakDb = x.PeakDb }) };
                }
                case "seq.transition":
                {
                    // How a game's change of music sounds: one layer's loop, then the next fading in over it, in time.
                    var song = SongFrom(p);
                    string? from = req.GetString("from", 8), to = req.GetString("to", 8);
                    if (!song.Layers.Any(x => x.Id == from) || !song.Layers.Any(x => x.Id == to)) throw new BridgeError("Choose two layers of the song.");
                    var fade = Math.Clamp(Json.OptDouble(p, "fadeBars") ?? 1, 0, 8) * song.BarSeconds;
                    SoundRender render;
                    await SoundGate.WaitAsync();
                    try
                    {
                        render = await Task.Run(() =>
                        {
                            var layers = SequencerEngine.RenderLayers(song, SoundRate, true, LoadSample);
                            return SequencerEngine.Transition(layers.Single(x => x.Layer.Id == from).Render, layers.Single(x => x.Layer.Id == to).Render, Math.Max(0.01, fade));
                        });
                    }
                    finally { SoundGate.Release(); }
                    return new { url = Serve(render, $"{song.ToJson()}|transition|{from}|{to}|{fade}"), seconds = render.Seconds, switchAt = render.Seconds / 2, barSeconds = song.BarSeconds };
                }
                case "seq.loopcheck":
                {
                    // The loop inspector: how the loop wraps, and the seam to listen to (its last two seconds, then its first two).
                    var song = SongFrom(p);
                    var layer = req.GetString("layer", 8) is { Length: > 0 } id && song.Layers.Any(x => x.Id == id) ? id : null;
                    SequencerEngine.LoopReport report;
                    SoundRender loop;
                    await SoundGate.WaitAsync();
                    try
                    {
                        (report, loop) = await Task.Run(() => (SequencerEngine.CheckLoop(song, SoundRate, LoadSample, layer), SequencerEngine.Render(song, SoundRate, true, LoadSample, layer)));
                    }
                    finally { SoundGate.Release(); }
                    var n = loop.Left.Length;
                    var half = Math.Min(n, 2 * SoundRate);
                    float[] Seam(float[] x) => [.. x[(n - half)..], .. x[..half]];
                    var seam = new SoundRender { SampleRate = loop.SampleRate, Left = Seam(loop.Left), Right = Seam(loop.Right) };
                    return new
                    {
                        seconds = report.Seconds, seamJump = report.SeamJump, tailPercent = report.TailPercent, startDb = report.StartDb, endDb = report.EndDb, checks = report.Checks,
                        seamUrl = Serve(seam, $"{song.ToJson()}|seam|{layer}"), seamAt = (double)half / SoundRate,
                    };
                }
                case "seq.note":
                {
                    var song = SongFrom(p);
                    var track = (int)(Json.OptDouble(p, "track") ?? 0);
                    // One note, or a chord ("pitches").
                    var pitches = p.TryGetProperty("pitches", out var ps) && ps.ValueKind == JsonValueKind.Array
                        ? ps.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.Number).Take(8).Select(x => Math.Clamp((int)x.GetDouble(), 0, 127)).ToList()
                        : [Math.Clamp((int)(Json.OptDouble(p, "pitch") ?? 60), 0, 127)];
                    if (pitches.Count == 0) throw new BridgeError("No notes to play.");
                    var velocity = Math.Clamp(Json.OptDouble(p, "velocity") ?? 0.8, 0.05, 1);
                    var render = await Task.Run(() => SequencerEngine.RenderNotes(song, track, pitches, velocity, SoundRate, LoadSample));
                    return new { url = Serve(render, $"{song.ToJson()}|note|{track}|{string.Join(',', pitches)}|{velocity}") };
                }
                case "seq.sample.pick":
                {
                    var dlg = new OpenFileDialog { Title = "Choose a sound to play as an instrument (WAV)", Filter = "WAV sound (*.wav)|*.wav", CheckFileExists = true };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    var full = Path.GetFullPath(dlg.FileName);
                    if (new FileInfo(full).Length > 100 * 1024 * 1024) throw new BridgeError("That file is too big (over 100 MB) for a sample.");
                    _soundSampleFiles.Add(full);
                    var audio = LoadSample(full) ?? throw new BridgeError("That WAV file can't be read (PCM or 32-bit float WAV files work).");
                    return new { path = full, name = Path.GetFileName(full), seconds = Math.Round(audio.Seconds, 3) };
                }
                case "seq.font.pick":
                {
                    // A SoundFont (.sf2) as an instrument: its presets to choose from.
                    var dlg = new OpenFileDialog { Title = "Choose a SoundFont (.sf2)", Filter = "SoundFont 2 (*.sf2)|*.sf2", CheckFileExists = true };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    var full = Path.GetFullPath(dlg.FileName);
                    if (new FileInfo(full).Length > SoundFont.MaxBytes) throw new BridgeError("That SoundFont is too big (over 512 MB).");
                    _soundSampleFiles.Add(full);
                    return FontForPage(full);
                }
                case "seq.font.presets":
                {
                    // The presets of a font the song already uses (allowed when the song was opened or the font picked).
                    var path = req.GetString("path", 1000) ?? "";
                    return FontForPage(path);
                }
                case "seq.sample.fromSound":
                {
                    // NoorSound sound (a preset or one of yours) as an instrument: rendered once into the app's own folder.
                    var id = req.GetString("id", 300) ?? "";
                    var recipe = id.StartsWith("user:", StringComparison.Ordinal) ? SoundRecipe.FromJson(await File.ReadAllTextAsync(UserPresetPath(id))) : SoundPresets.Make(id);
                    AllowSamples(recipe);
                    if (recipe.Duration > 20) recipe.Duration = 20;
                    var render = await Task.Run(() => SoundEngine.Render(recipe, SoundRate, LoadSample));
                    var folder = Path.Combine(App.Paths.Local, "Sequencer", "Samples");
                    Directory.CreateDirectory(folder);
                    var path = Path.Combine(folder, NoorMD.Core.Documents.DocumentFile.SafeFileName($"{recipe.Name} {Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(recipe.ToJson())))[..8]}", ".wav"));
                    if (!File.Exists(path)) await File.WriteAllBytesAsync(path, render.ToWav(16));
                    _soundSampleFiles.Add(Path.GetFullPath(path));
                    return new { path, name = recipe.Name + ".wav", seconds = Math.Round(render.Seconds, 3) };
                }
                case "seq.sample.library":
                {
                    // WAV files in NoorMusic's library (other formats can't be played as instruments yet).
                    var search = req.GetString("search", 200);
                    var rows = await Task.Run(() => Music.Query(new NoorMD.Media.LibraryQuery(Search: string.IsNullOrWhiteSpace(search) ? null : search, Limit: 2000)).Rows);
                    return new
                    {
                        tracks = rows.Where(r => !r.Missing && r.Path.EndsWith(".wav", StringComparison.OrdinalIgnoreCase)).Take(200)
                            .Select(r => new { id = r.Id, title = r.DisplayTitle, artist = r.Artist, seconds = Math.Round(r.Duration, 1) }),
                    };
                }
                case "seq.sample.fromLibrary":
                {
                    var row = Music.Get((long)(Json.OptDouble(p, "id") ?? -1)) ?? throw new BridgeError("That track is no longer in NoorMusic.");
                    if (!row.Path.EndsWith(".wav", StringComparison.OrdinalIgnoreCase) || !File.Exists(row.Path)) throw new BridgeError("Only WAV files can be played as an instrument.");
                    if (new FileInfo(row.Path).Length > 100 * 1024 * 1024) throw new BridgeError("That file is too big (over 100 MB) for a sample.");
                    var full = Path.GetFullPath(row.Path);
                    _soundSampleFiles.Add(full);
                    var audio = LoadSample(full) ?? throw new BridgeError("That WAV file can't be read (PCM or 32-bit float WAV files work).");
                    return new { path = full, name = Path.GetFileName(full), seconds = Math.Round(audio.Seconds, 3) };
                }
                case "seq.export":
                {
                    var song = SongFrom(p);
                    DropUnallowedFiles(song);
                    var parts = p.TryGetProperty("parts", out var pa) && pa.ValueKind == JsonValueKind.Object ? pa : default;
                    bool Part(string key, bool fallback) => parts.ValueKind == JsonValueKind.Object && parts.TryGetProperty(key, out var v) ? v.ValueKind == JsonValueKind.True : fallback;
                    bool mix = Part("mix", true), loop = Part("loop", false), stems = Part("stems", false), midi = Part("midi", false);
                    var layers = Part("layers", false) && song.Layers.Count > 0;
                    if (!mix && !loop && !stems && !midi && !layers) throw new BridgeError("Choose something to export: the song, the loop, the layers, stems or MIDI.");
                    var bits = (int)(Json.OptDouble(p, "bits") ?? 16) == 24 ? 24 : 16;
                    var rate = (int)(Json.OptDouble(p, "sampleRate") ?? SoundRate) == 44100 ? 44100 : 48000;
                    // WAV, OGG (smaller; what engines stream music from) or both.
                    var format = req.GetString("format", 8) is "ogg" or "both" ? req.GetString("format", 8)! : "wav";
                    var quality = Math.Clamp(Json.OptDouble(p, "oggQuality") ?? 0.5, 0.1, 0.9);
                    string[] exts = format == "both" ? [".wav", ".ogg"] : [format == "ogg" ? ".ogg" : ".wav"];
                    var place = ExportPlaceFrom(p, "music");
                    var root = ExportBase(place, $"Save “{song.Name}” in… (you can make a new folder here)");
                    if (root == null) return new { cancelled = true };
                    var tokens = ExportTokens(song.Name, song.Family, 0, place.Project?.Name);
                    var folder = ExportLayouts.Under(root, ExportLayouts.Folders(ExportLayouts.Expand(place.FolderPattern, tokens)));
                    var file = ExportLayouts.FileName(ExportLayouts.Expand(place.FilePattern, tokens), song.Name);
                    var stem = ExportLayouts.FileName(tokens["name"], song.Name);
                    string LayerFile(SongLayer l) => ExportLayouts.FileName($"{file}_{ExportLayouts.NameTokens(l.Name)["name"]}_loop", song.Name);
                    var planned = new List<string>();
                    foreach (var ext in exts)
                    {
                        if (mix) planned.Add(Path.Combine(folder, file + ext));
                        if (loop) planned.Add(Path.Combine(folder, file + "_loop" + ext));
                        if (layers) planned.AddRange(song.Layers.Select(l => Path.Combine(folder, LayerFile(l) + ext)));
                    }
                    if (midi) planned.Add(Path.Combine(folder, file + ".mid"));
                    planned.Add(Path.Combine(folder, stem + ".noorsong.json"));
                    var how = AskReplace(planned, $"“{song.Name}”");
                    if (how == null) return new { cancelled = true };
                    var keep = how == "keep";
                    Directory.CreateDirectory(folder);
                    var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    var files = new List<string>();
                    string? stemDir = null;
                    var warnings = new List<string>();
                    var steps = (mix || stems ? 1 : 0) + (loop ? 1 : 0) + (layers ? 1 : 0) + (midi ? 1 : 0);
                    var done = 0;
                    void Progress() => PushEvent("seq.exportProgress", new { done = ++done, total = steps });
                    async Task Write(SoundRender r, string name, bool isLoop, string title)
                    {
                        foreach (var ext in exts)
                        {
                            var path = ExportTarget(folder, name + ext, keep, taken);
                            await File.WriteAllBytesAsync(path, ext == ".ogg" ? await Task.Run(() => SoundOgg.Encode(r, quality, title, isLoop)) : r.ToWav(bits));
                            files.Add(path);
                        }
                    }
                    if (mix || stems)
                    {
                        // The whole song, and beside it a folder with each track on its own (same gain as in the mix).
                        var (whole, parts2) = await Task.Run(() => SequencerEngine.RenderStems(song, rate, false, LoadSample));
                        warnings.AddRange(whole.Warnings);
                        if (mix) await Write(whole, file, false, song.Name);
                        if (stems)
                        {
                            stemDir = keep ? PictureConvert.FreePath(folder, file + " stems", "", taken) : Path.Combine(folder, file + " stems");
                            Directory.CreateDirectory(stemDir);
                            var stemTaken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                            for (var k = 0; k < parts2.Count; k++)
                            {
                                var name = Path.GetFileNameWithoutExtension(NoorMD.Core.Documents.DocumentFile.SafeFileName($"{k + 1:00} {parts2[k].Name}", ".wav"));
                                await File.WriteAllBytesAsync(keep ? PictureConvert.FreePath(stemDir, name, ".wav", stemTaken) : ExportTarget(stemDir, name + ".wav", false, stemTaken), parts2[k].Render.ToWav(bits));
                            }
                        }
                        Progress();
                    }
                    if (loop)
                    {
                        // The loop region with its tails folded into its start: it repeats without a gap or a click.
                        await Write(await Task.Run(() => SequencerEngine.Render(song, rate, true, LoadSample)), file + "_loop", true, song.Name);
                        Progress();
                    }
                    if (layers)
                    {
                        // Each adaptive layer as a loop of the same length and one shared level, for a game to crossfade.
                        foreach (var (l, r) in await Task.Run(() => SequencerEngine.RenderLayers(song, rate, true, LoadSample)))
                            await Write(r, LayerFile(l), true, $"{song.Name} ({l.Name})");
                        Progress();
                    }
                    if (midi)
                    {
                        var path = ExportTarget(folder, file + ".mid", keep, taken);
                        await File.WriteAllBytesAsync(path, SequencerEngine.ToMidi(song));
                        files.Add(path);
                        Progress();
                    }
                    // The song goes with the files, so it can be opened and changed later.
                    var recipePath = ExportTarget(folder, stem + ".noorsong.json", keep, taken);
                    await File.WriteAllTextAsync(recipePath, song.ToJson(), new UTF8Encoding(false));
                    _songFolders.Add(folder);
                    // Optionally kept in the open Vault too, with a small OGG to listen to from there.
                    string? vault = null; var notes = new List<string>();
                    if (Json.IsTrue(p, "vault"))
                    {
                        if (_vault == null) notes.Add("No Vault is open, so the song wasn't kept there.");
                        else
                            try { vault = await SaveSongToVaultAsync(song, stem); }
                            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { notes.Add("The song couldn't be kept in the Vault: " + ex.Message); }
                    }
                    // Optionally in NoorMusic too, to audition and rate (the song, the loop and the layers; not stems).
                    var music = 0;
                    if (Json.IsTrue(p, "musicBench"))
                        try { music = await AddToMusicBenchAsync(files); }
                        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or Microsoft.Data.Sqlite.SqliteException) { notes.Add("The files couldn't be added to NoorMusic: " + ex.Message); }
                    Log.Info($"NoorSequencer: exported {files.Count} file(s) of “{song.Name}”");
                    return new
                    {
                        folder, files = files.Select(Path.GetFileName), recipe = Path.GetFileName(recipePath), stems = stemDir == null ? null : Path.GetFileName(stemDir),
                        warnings = warnings.Distinct(), project = place.Project?.Name, relative = Path.GetRelativePath(root, folder).Replace('\\', '/'), vault, notes, music,
                    };
                }
                case "seq.reveal":
                {
                    var folder = req.GetString("folder", 4000) ?? "";
                    if (!_songFolders.Contains(folder) || !Directory.Exists(folder)) throw new BridgeError("That is not a folder the song went to.");
                    Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = false, ArgumentList = { folder } });
                    return null;
                }
                case "seq.save":
                {
                    var song = SongFrom(p);
                    DropUnallowedFiles(song);
                    Directory.CreateDirectory(UserSongFolder);
                    var file = NoorMD.Core.Documents.DocumentFile.SafeFileName(song.Name, ".json");
                    var path = Path.Combine(UserSongFolder, file);
                    var replaced = File.Exists(path);
                    await File.WriteAllTextAsync(path, song.ToJson(), new UTF8Encoding(false));
                    return new { id = "user:" + file, replaced, mine = UserSongs() };
                }
                case "seq.delete":
                    File.Delete(UserSongPath(req.GetString("id", 300) ?? ""));
                    return new { mine = UserSongs() };
                case "seq.open":
                {
                    var dlg = new OpenFileDialog { Title = "Open a song", Filter = "Songs (*.noorsong.json;*.json)|*.noorsong.json;*.json", CheckFileExists = true };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    if (new FileInfo(dlg.FileName).Length > 2_000_000) throw new BridgeError("That file is too big for a song.");
                    var opened = SongRecipe.FromJson(await File.ReadAllTextAsync(dlg.FileName)).FindSamplesBeside(Path.GetDirectoryName(Path.GetFullPath(dlg.FileName))!);
                    AllowSamples(opened);
                    return new { song = SongForPage(opened) };
                }
                default: throw new BridgeError($"Unknown command \"{req.Type}\".");
            }
        }
        catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
        catch (JsonException ex) { throw new BridgeError("The song can't be read: " + ex.Message); }
    }
}
