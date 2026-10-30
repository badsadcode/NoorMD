using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Calendar;
using NoorMD.Core.Bridge;
using NoorMD.Core.Documents;
using NoorMD.Core.Stream;
using NoorMD.Core.Vaults;
using NoorMD.Media;

namespace NoorMD;

/// <summary>
/// NoorStream: OBS overlays (Now Playing, credits roll) served on 127.0.0.1 only, an optional now-playing.txt for an
/// OBS Text source, the supporters list and the stream log. Supporters and streams are ordinary notes in the open
/// Vault. Nothing is ever published: titles and descriptions are copied for the user to paste. No accounts, no tokens.
/// </summary>
public partial class MainWindow
{
    private OverlayServer? _overlay;
    private JsonObject? _streamCfg;
    private JsonObject? _nowPlaying;
    private (DateTime StartUtc, List<TrackMark> Marks, long? LastId)? _streamSession;
    private string? _lastTxt;

    private string StreamFile => Path.Combine(App.Paths.Local, "Stream", "stream.json");

    private JsonObject StreamCfg
    {
        get
        {
            if (_streamCfg != null) return _streamCfg;
            try { _streamCfg = File.Exists(StreamFile) ? JsonNode.Parse(File.ReadAllText(StreamFile)) as JsonObject : null; }
            catch (Exception ex) when (ex is JsonException or IOException) { Log.Error("stream.json unreadable; starting fresh", ex); }
            return _streamCfg ??= new JsonObject();
        }
    }

    private void SaveStreamCfg()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(StreamFile)!);
        AtomicFile.WriteAllText(StreamFile, StreamCfg.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }

    private string CfgString(string key, string fallback) => StreamCfg[key] is JsonValue v && v.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s) ? s : fallback;
    private bool CfgBool(string key) => StreamCfg[key] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
    private int Port => StreamCfg["port"] is JsonValue v && v.TryGetValue<int>(out var p) && p is >= 1024 and <= 65535 ? p : OverlayServer.DefaultPort;

    /// <summary>Called once the page is ready: restarts the overlay server if it was on.</summary>
    private void RestoreStream()
    {
        if (CfgBool("serverEnabled")) try { StartOverlay(Port); } catch (Exception ex) { Log.Error("Overlay server could not start", ex); PushNotice($"The OBS overlay server could not start on port {Port}: {ex.Message}"); }
    }

    private void StartOverlay(int port)
    {
        if (_overlay is { Running: true } && _overlay.Port == port) return;
        _overlay?.StopAsync().GetAwaiter().GetResult();
        var root = Path.Combine(AppContext.BaseDirectory, "wwwroot", "overlay");
        var fonts = Path.Combine(AppContext.BaseDirectory, "wwwroot", "vendor", "inter", "files");
        var server = new OverlayServer(root, path => path switch
        {
            "/inter.woff2" => (File.ReadAllBytes(Path.Combine(fonts, "inter-latin-wght-normal.woff2")), "font/woff2"),
            "/inter-ext.woff2" => (File.ReadAllBytes(Path.Combine(fonts, "inter-latin-ext-wght-normal.woff2")), "font/woff2"),
            "/art" => CurrentArt(),
            _ => null,
        });
        server.Start(port);
        _overlay = server;
        BroadcastOverlayState();
    }

    private (byte[], string)? CurrentArt()
    {
        if (_nowPlaying?["id"] is not JsonValue v || !v.TryGetValue<long>(out var id) || _music?.Get(id) is not { } t) return null;
        return (TagIO.ReadArtwork(t.Path) ?? FolderArt.Read(t.Folder)) is { } a ? (a.Data, a.MimeType) : null;
    }

    private void BroadcastOverlayState()
    {
        if (_overlay is not { Running: true } o) return;
        o.Broadcast("np.config", (StreamCfg["nowPlaying"] ?? new JsonObject()).ToJsonString());
        o.Broadcast("np.track", (_nowPlaying ?? new JsonObject()).ToJsonString());
        o.Broadcast("credits.config", new JsonObject { ["config"] = StreamCfg["credits"]?.DeepClone() ?? new JsonObject(), ["effects"] = StreamCfg["effects"]?.DeepClone() ?? new JsonArray() }.ToJsonString());
        try { o.Broadcast("credits.data", JsonSerializer.Serialize(new { supporters = ActiveSupporters() })); }
        catch (Exception ex) when (ex is IOException or BridgeError) { /* no Vault yet: the roll shows a placeholder */ }
        o.Broadcast("sc.config", (StreamCfg["schedule"] ?? new JsonObject()).ToJsonString());
        BroadcastSchedule(force: true);
    }

    private string? _lastScheduleJson;

    /// <summary>
    /// The stream schedule for the "Next stream" and "This week" overlays: the stream that is on or next, the week's
    /// streams and the coming ones, from the calendar. Sent when it changes (the overlays count down by themselves).
    /// </summary>
    private void BroadcastSchedule(bool force = false)
    {
        if (_overlay is not { Running: true } o) return;
        var monday = StreamCfg["schedule"]?["mondayFirst"] is not JsonValue v || !v.TryGetValue<bool>(out var first) || first;
        var now = DateTime.Now;
        string json;
        try
        {
            var entries = Calendar.Entries;
            var next = StreamSchedule.Next(entries, now);
            json = JsonSerializer.Serialize(new
            {
                next = next == null ? null : SlotForPage(next),
                week = StreamSchedule.Week(entries, now, monday).Select(SlotForPage),
                upcoming = StreamSchedule.Between(entries, now, now.AddDays(14)).Take(10).Select(SlotForPage),
                weekStart = CalendarTime.Day(StreamSchedule.WeekStart(now, monday)),
            });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return; }
        if (!force && json == _lastScheduleJson) return;
        _lastScheduleJson = json;
        o.Broadcast("sc.data", json);
    }

    private object[] ActiveSupporters() =>
        (_vault == null ? [] : ReadSupporters().List.Where(s => s.Active).Select(s => (object)new { name = s.Name, channel = s.Channel, tier = s.Tier }).ToArray());

    // ------------------------------------------------------------------ Vault notes

    private string SupportersPath() => VaultFile(CfgString("supportersNote", "Stream/Supporters.md"));
    private string StreamsFolder() => VaultFile(CfgString("streamsFolder", "Streams"));

    private string VaultFile(string relative)
    {
        var v = V();
        return VaultPaths.Resolve(v.Root, relative) ?? throw new BridgeError($"\"{relative}\" is not a valid path inside the Vault.");
    }

    private (string Path, bool Exists, IReadOnlyList<Supporter> List) ReadSupporters()
    {
        var path = SupportersPath();
        if (!File.Exists(path)) return (path, false, []);
        return (path, true, SupportersFile.Parse(TextFileCodec.Decode(File.ReadAllBytes(path)).Text));
    }

    private void WriteSupporters(IReadOnlyList<Supporter> list)
    {
        var path = SupportersPath();
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        string? existing = null;
        if (File.Exists(path)) existing = TextFileCodec.Decode(File.ReadAllBytes(path)).Text;
        AtomicFile.WriteAllText(path, SupportersFile.Write(existing, list));
        ScheduleRescan(0);
        try { _overlay?.Broadcast("credits.data", JsonSerializer.Serialize(new { supporters = ActiveSupporters() })); } catch (IOException) { }
    }

    private static Supporter SupporterFrom(JsonElement e)
    {
        string? S(string n, int max) => NoorMD.Core.Bridge.Json.OptString(e, n, max) is { } s && s.Trim().Length > 0 ? s.Trim() : null;
        DateOnly? D(string n) => DateOnly.TryParseExact(S(n, 20), "yyyy-MM-dd", out var d) ? d : null;
        var name = S("name", 200) ?? throw new BridgeError("Every supporter needs a name.");
        return new Supporter(name, SupportersFile.CleanLink(S("channel", 500)), S("tier", 100), D("since"), D("until"), S("note", 1000));
    }

    private static object SupporterForPage(Supporter s) => new
    {
        name = s.Name, channel = s.Channel, tier = s.Tier, since = s.Since?.ToString("yyyy-MM-dd"), until = s.Until?.ToString("yyyy-MM-dd"), note = s.Note, active = s.Active,
    };

    private IReadOnlyList<StreamEntry> StreamHistory()
    {
        if (_vault == null) return [];
        var folder = StreamsFolder();
        if (!Directory.Exists(folder)) return [];
        var list = new List<StreamEntry>();
        foreach (var f in Directory.EnumerateFiles(folder, "*.md", SearchOption.TopDirectoryOnly))
        {
            try
            {
                if (new FileInfo(f).Length > 2_000_000) continue;
                if (StreamLog.Parse(TextFileCodec.Decode(File.ReadAllBytes(f)).Text, VaultPaths.ToRelative(_vault.Root, f)) is { } e) list.Add(e);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidDataException) { }
        }
        return list.OrderByDescending(e => e.Date).ThenByDescending(e => e.Number ?? 0).ToList();
    }

    private object StreamForPage(StreamEntry e) => new
    {
        title = e.Title, date = e.Date.ToString("yyyy-MM-dd"), number = e.Number, description = e.Description, keywords = e.Keywords, thumbnail = e.Thumbnail,
        url = e.Url, notes = e.Notes, path = e.Path, tracklist = e.Tracklist.Select(t => new { offset = t.Offset, text = t.Text, stamp = StreamLog.Stamp(t.Offset) }),
        thumbnailData = ThumbData(e),
    };

    private string? ThumbData(StreamEntry e)
    {
        if (string.IsNullOrEmpty(e.Thumbnail) || _vault == null || e.Path == null) return null;
        try
        {
            var noteDir = Path.GetDirectoryName(Path.Combine(_vault.Root, e.Path))!;
            var full = Path.GetFullPath(Path.Combine(noteDir, e.Thumbnail));
            if (VaultPaths.ToRelative(_vault.Root, full) == null || !File.Exists(full) || new FileInfo(full).Length > 4_000_000) return null;
            var mime = Path.GetExtension(full).ToLowerInvariant() switch { ".png" => "image/png", ".webp" => "image/webp", ".gif" => "image/gif", _ => "image/jpeg" };
            return $"data:{mime};base64,{Convert.ToBase64String(File.ReadAllBytes(full))}";
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException) { return null; }
    }

    private StreamEntry StreamFrom(JsonElement e)
    {
        string S(string n, int max) => NoorMD.Core.Bridge.Json.OptString(e, n, max) ?? "";
        var marks = new List<TrackMark>();
        if (e.TryGetProperty("tracklist", out var tl) && tl.ValueKind == JsonValueKind.Array)
            foreach (var t in tl.EnumerateArray().Take(2000))
                if (NoorMD.Core.Bridge.Json.OptDouble(t, "offset") is double off && NoorMD.Core.Bridge.Json.OptString(t, "text", 500) is { } text) marks.Add(new TrackMark(Math.Max(0, off), text));
        return new StreamEntry
        {
            Title = S("title", 300).Trim(),
            Date = DateOnly.TryParseExact(S("date", 20), "yyyy-MM-dd", out var d) ? d : DateOnly.FromDateTime(DateTime.Now),
            Number = NoorMD.Core.Bridge.Json.OptInt(e, "number"),
            Description = S("description", 20_000),
            Keywords = StreamLog.Keywords(S("keywords", 5000)),
            Thumbnail = S("thumbnail", 1000) is { Length: > 0 } th ? th : null,
            Url = SupportersFile.CleanLink(S("url", 1000)),
            Tracklist = marks,
            Notes = S("notes", 100_000),
        };
    }

    // ------------------------------------------------------------------ bridge

    private async Task<object?> DispatchStreamAsync(BridgeRequest req)
    {
        var p = req.Payload;
        switch (req.Type)
        {
            case "stream.window":
                return OpenStreamWindow(req.GetString("tab", 20), NoorMD.Core.Bridge.Json.IsTrue(p, "toggle"), NoorMD.Core.Bridge.Json.IsTrue(p, "close"));
            case "stream.dock":
            {
                // "Dock in the main window" from NoorStream window: close it (after this reply) and show the panel.
                var tab = req.GetString("tab", 20);
                _ = Dispatcher.BeginInvoke(() => { _streamWindow?.Close(); Activate(); PushEvent("stream.dock", new { tab }); });
                return null;
            }
            case "stream.track":
                SendTrackToStreamWindow();
                return null;
            case "stream.status":
            {
                var cfg = StreamCfg;
                return new
                {
                    server = new { running = _overlay is { Running: true }, port = _overlay?.Port ?? Port, url = _overlay is { Running: true } o ? o.BaseUrl : $"http://127.0.0.1:{Port}/", clients = _overlay?.SseClients ?? 0 },
                    enabled = CfgBool("serverEnabled"),
                    nowPlaying = cfg["nowPlaying"], credits = cfg["credits"], schedule = cfg["schedule"], effects = cfg["effects"] ?? new JsonArray(), templates = cfg["templates"] ?? new JsonArray(),
                    txt = new { enabled = CfgBool("txtEnabled"), path = CfgString("txtPath", Path.Combine(App.Paths.Local, "Stream", "now-playing.txt")), format = CfgString("txtFormat", "{artist} - {title}") },
                    vault = _vault?.Root, supportersNote = CfgString("supportersNote", "Stream/Supporters.md"), streamsFolder = CfgString("streamsFolder", "Streams"),
                    session = _streamSession is { } s ? new { start = s.StartUtc, marks = s.Marks.Select(m => new { offset = m.Offset, text = m.Text, stamp = StreamLog.Stamp(m.Offset) }) } : null,
                };
            }
            case "stream.server":
            {
                var on = NoorMD.Core.Bridge.Json.IsTrue(p, "enabled");
                var port = NoorMD.Core.Bridge.Json.OptInt(p, "port") ?? Port;
                if (port is < 1024 or > 65535) throw new BridgeError("Choose a port between 1024 and 65535.");
                StreamCfg["port"] = port;
                StreamCfg["serverEnabled"] = on;
                SaveStreamCfg();
                if (!on) { if (_overlay != null) await _overlay.StopAsync(); _overlay = null; return new { running = false }; }
                try { StartOverlay(port); }
                catch (SocketException ex) { StreamCfg["serverEnabled"] = false; SaveStreamCfg(); throw new BridgeError($"Port {port} is in use by another program ({ex.SocketErrorCode}). Choose another port."); }
                return new { running = true, url = _overlay!.BaseUrl };
            }
            case "stream.np.config":
                StreamCfg["nowPlaying"] = JsonNode.Parse(Bounded(p, "config"));
                SaveStreamCfg();
                _overlay?.Broadcast("np.config", StreamCfg["nowPlaying"]!.ToJsonString());
                return null;
            case "stream.sc.config":
                StreamCfg["schedule"] = JsonNode.Parse(Bounded(p, "config"));
                SaveStreamCfg();
                _overlay?.Broadcast("sc.config", StreamCfg["schedule"]!.ToJsonString());
                BroadcastSchedule(force: true);
                return null;
            case "stream.np.update":
                OnNowPlaying(p);
                return null;
            case "stream.credits.config":
                StreamCfg["credits"] = JsonNode.Parse(Bounded(p, "config"));
                if (p.TryGetProperty("effects", out _)) StreamCfg["effects"] = JsonNode.Parse(Bounded(p, "effects"));
                SaveStreamCfg();
                BroadcastOverlayState();
                return null;
            case "stream.credits.start":
                if (_overlay is not { Running: true } ov) throw new BridgeError("Turn on the OBS overlay server first.");
                try { ov.Broadcast("credits.data", JsonSerializer.Serialize(new { supporters = ActiveSupporters() })); } catch (IOException) { }
                ov.Broadcast("credits.start", "{}");
                ov.ForgetEvent("credits.start"); // a reconnecting overlay must not restart the roll
                return new { clients = ov.SseClients };
            case "stream.credits.stop":
                _overlay?.Broadcast("credits.stop", "{}");
                _overlay?.ForgetEvent("credits.stop");
                return null;
            case "stream.txt":
            {
                StreamCfg["txtEnabled"] = NoorMD.Core.Bridge.Json.IsTrue(p, "enabled");
                if (req.GetString("format", 200) is { Length: > 0 } fmt) StreamCfg["txtFormat"] = fmt;
                if (NoorMD.Core.Bridge.Json.IsTrue(p, "choose"))
                {
                    var dlg = new SaveFileDialog { Title = "Where should NoorMD write the current song (for an OBS Text source)?", Filter = "Text file (*.txt)|*.txt", FileName = "now-playing.txt", OverwritePrompt = false };
                    Ui.NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    StreamCfg["txtPath"] = dlg.FileName;
                }
                SaveStreamCfg();
                _lastTxt = null;
                WriteNowPlayingTxt();
                return new { path = CfgString("txtPath", Path.Combine(App.Paths.Local, "Stream", "now-playing.txt")) };
            }
            case "stream.paths":
                if (req.GetString("supportersNote", 300) is { Length: > 0 } sn) { _ = VaultFile(sn); StreamCfg["supportersNote"] = sn.EndsWith(".md", StringComparison.OrdinalIgnoreCase) ? sn : sn + ".md"; }
                if (req.GetString("streamsFolder", 300) is { Length: > 0 } sf) { _ = VaultFile(sf); StreamCfg["streamsFolder"] = sf; }
                SaveStreamCfg();
                return null;
            case "stream.supporters.get":
            {
                var (path, exists, list) = ReadSupporters();
                return new { path = VaultPaths.ToRelative(V().Root, path), exists, supporters = list.Select(SupporterForPage) };
            }
            case "stream.supporters.save":
            {
                if (!p.TryGetProperty("supporters", out var arr) || arr.ValueKind != JsonValueKind.Array) throw new BridgeError("No supporters were sent.");
                var list = arr.EnumerateArray().Take(10_000).Select(SupporterFrom).ToList();
                WriteSupporters(list);
                return new { path = VaultPaths.ToRelative(V().Root, SupportersPath()), count = list.Count };
            }
            case "stream.supporters.import":
            {
                var text = req.GetString("text", 2_000_000) ?? "";
                var imported = SupportersFile.Import(text);
                if (imported.Count == 0) throw new BridgeError("No names were found in the pasted text.");
                // Merge into the list as it is on screen (it may have unsaved edits), or the saved note.
                IReadOnlyList<Supporter> current = p.TryGetProperty("current", out var cur) && cur.ValueKind == JsonValueKind.Array
                    ? cur.EnumerateArray().Take(10_000).Where(x => NoorMD.Core.Bridge.Json.OptString(x, "name", 200) is { Length: > 0 }).Select(SupporterFrom).ToList()
                    : ReadSupporters().List;
                var r = SupportersFile.Merge(current, imported, NoorMD.Core.Bridge.Json.IsTrue(p, "markMissingAsLeft"), DateOnly.FromDateTime(DateTime.Now));
                return new { found = imported.Count, added = r.Added, updated = r.Updated, returned = r.Returned, left = r.Left, merged = r.Merged.Select(SupporterForPage) };
            }
            case "stream.log.list":
                return new { folder = CfgString("streamsFolder", "Streams"), streams = StreamHistory().Select(e => new { title = e.Title, date = e.Date.ToString("yyyy-MM-dd"), number = e.Number, path = e.Path, keywords = e.Keywords, tracks = e.Tracklist.Count }), nextNumber = (StreamHistory().Max(e => e.Number) ?? 0) + 1 };
            case "stream.log.get":
            {
                var rel = req.GetString("path", 1000) ?? throw new BridgeError("Missing path.");
                var full = VaultFile(rel);
                var e = File.Exists(full) ? StreamLog.Parse(TextFileCodec.Decode(File.ReadAllBytes(full)).Text, rel) : null;
                return e == null ? throw new BridgeError("That stream note is no longer there.") : StreamForPage(e);
            }
            case "stream.log.save":
            {
                if (!p.TryGetProperty("entry", out var je)) throw new BridgeError("Nothing to save.");
                var e = StreamFrom(je);
                var folder = StreamsFolder();
                Directory.CreateDirectory(folder);
                var rel = req.GetString("path", 1000);
                string full;
                if (rel is { Length: > 0 })
                {
                    full = VaultFile(rel);
                    if (File.Exists(full) && StreamLog.Parse(TextFileCodec.Decode(File.ReadAllBytes(full)).Text) == null) throw new BridgeError("That note is not a NoorMD stream note; it was not overwritten.");
                }
                else full = Path.Combine(folder, VaultPaths.UniqueName(folder, Path.GetFileNameWithoutExtension(StreamLog.FileName(e)), ".md"));
                AtomicFile.WriteAllText(full, StreamLog.Serialize(e));
                ScheduleRescan(0);
                return new { path = VaultPaths.ToRelative(V().Root, full) };
            }
            case "stream.log.thumbnail":
            {
                var v = V();
                var dlg = new OpenFileDialog { Title = "Choose the stream thumbnail", Filter = "Pictures (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp", CheckFileExists = true };
                Ui.NativeCursor.Restore();
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                if (new FileInfo(dlg.FileName).Length > 20_000_000) throw new BridgeError("That picture is larger than 20 MB.");
                var attachments = VaultPaths.Resolve(v.Root, v.Info.Attachments) ?? v.Root;
                string dest;
                if (VaultPaths.ToRelative(v.Root, dlg.FileName) != null) dest = dlg.FileName; // already in the Vault: link it, don't copy
                else
                {
                    Directory.CreateDirectory(attachments);
                    dest = Path.Combine(attachments, VaultPaths.UniqueName(attachments, Path.GetFileNameWithoutExtension(dlg.FileName), Path.GetExtension(dlg.FileName).ToLowerInvariant()));
                    await Task.Run(() => File.Copy(dlg.FileName, dest, overwrite: false));
                    ScheduleRescan(0);
                }
                var rel = Path.GetRelativePath(StreamsFolder(), dest).Replace('\\', '/');
                var bytes = await File.ReadAllBytesAsync(dest);
                var mime = Path.GetExtension(dest).ToLowerInvariant() switch { ".png" => "image/png", ".webp" => "image/webp", _ => "image/jpeg" };
                return new { thumbnail = rel, thumbnailData = bytes.Length <= 4_000_000 ? $"data:{mime};base64,{Convert.ToBase64String(bytes)}" : null };
            }
            case "stream.templates.save":
                StreamCfg["templates"] = JsonNode.Parse(Bounded(p, "templates"));
                SaveStreamCfg();
                return null;
            case "stream.session.start":
                _streamSession = (DateTime.UtcNow, [], null);
                if (_nowPlaying is { } np && np["playing"] is JsonValue pl && pl.TryGetValue<bool>(out var playing) && playing) MarkTrack(np);
                return new { start = _streamSession.Value.StartUtc };
            case "stream.session.stop":
            {
                var s = _streamSession;
                _streamSession = null;
                return new { marks = (s?.Marks ?? []).Select(m => new { offset = m.Offset, text = m.Text, stamp = StreamLog.Stamp(m.Offset) }), seconds = s is { } x ? (DateTime.UtcNow - x.StartUtc).TotalSeconds : 0 };
            }
            case "stream.chapters":
            {
                var marks = new List<TrackMark>();
                if (p.TryGetProperty("tracklist", out var tl) && tl.ValueKind == JsonValueKind.Array)
                    foreach (var t in tl.EnumerateArray().Take(2000))
                        if (NoorMD.Core.Bridge.Json.OptDouble(t, "offset") is double off && NoorMD.Core.Bridge.Json.OptString(t, "text", 500) is { } text) marks.Add(new TrackMark(off, text));
                return StreamLog.Chapters(marks);
            }
            case "stream.fill":
            {
                var values = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
                if (p.TryGetProperty("values", out var vals) && vals.ValueKind == JsonValueKind.Object)
                    foreach (var prop in vals.EnumerateObject()) values[prop.Name.ToLowerInvariant()] = prop.Value.ValueKind == JsonValueKind.String ? prop.Value.GetString() : prop.Value.GetRawText();
                var date = DateOnly.TryParseExact(req.GetString("date", 20), "yyyy-MM-dd", out var d) ? d : DateOnly.FromDateTime(DateTime.Now);
                return StreamLog.Fill(req.GetString("template", 20_000) ?? "", values, date);
            }
            default:
                throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }

    private static string Bounded(JsonElement p, string name)
    {
        if (p.ValueKind != JsonValueKind.Object || !p.TryGetProperty(name, out var v) || v.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array)) throw new BridgeError($"Missing \"{name}\".");
        var raw = v.GetRawText();
        if (raw.Length > 200_000) throw new BridgeError("That configuration is too large.");
        return raw;
    }

    private void OnNowPlaying(JsonElement p)
    {
        if (!p.TryGetProperty("track", out var t) || t.ValueKind != JsonValueKind.Object) { _nowPlaying = null; }
        else
        {
            var n = new JsonObject
            {
                ["id"] = NoorMD.Core.Bridge.Json.OptLong(t, "id"),
                ["title"] = NoorMD.Core.Bridge.Json.OptString(t, "title", 300),
                ["artist"] = NoorMD.Core.Bridge.Json.OptString(t, "artist", 300),
                ["hasArt"] = NoorMD.Core.Bridge.Json.IsTrue(t, "hasArt"),
                ["playing"] = NoorMD.Core.Bridge.Json.IsTrue(t, "playing"),
                ["position"] = NoorMD.Core.Bridge.Json.OptDouble(t, "position") ?? 0,
                ["duration"] = NoorMD.Core.Bridge.Json.OptDouble(t, "duration") ?? 0,
            };
            _nowPlaying = n;
            if (NoorMD.Core.Bridge.Json.IsTrue(t, "playing")) MarkTrack(n);
        }
        _overlay?.Broadcast("np.track", (_nowPlaying ?? new JsonObject()).ToJsonString());
        WriteNowPlayingTxt();
        SendTrackToStreamWindow();
    }

    /// <summary>While a stream session runs, every newly started track is added to its tracklist with its offset.</summary>
    private void MarkTrack(JsonObject n)
    {
        if (_streamSession is not { } s || n["id"] is not JsonValue iv || !iv.TryGetValue<long>(out var id) || s.LastId == id) return;
        var title = n["title"]?.GetValue<string>() ?? "";
        var artist = n["artist"]?.GetValue<string>();
        s.Marks.Add(new TrackMark((DateTime.UtcNow - s.StartUtc).TotalSeconds, string.IsNullOrWhiteSpace(artist) ? title : $"{artist} – {title}"));
        _streamSession = (s.StartUtc, s.Marks, id);
    }

    private void WriteNowPlayingTxt()
    {
        if (!CfgBool("txtEnabled")) return;
        var title = _nowPlaying?["title"]?.GetValue<string>();
        var text = string.IsNullOrEmpty(title) ? "" : StreamLog.Fill(CfgString("txtFormat", "{artist} - {title}"),
            new Dictionary<string, string?> { ["title"] = title, ["artist"] = _nowPlaying?["artist"]?.GetValue<string>() ?? "" }, DateOnly.FromDateTime(DateTime.Now)).Trim(' ', '-', '–');
        if (text == _lastTxt) return;
        _lastTxt = text;
        var path = CfgString("txtPath", Path.Combine(App.Paths.Local, "Stream", "now-playing.txt"));
        try { Directory.CreateDirectory(Path.GetDirectoryName(path)!); AtomicFile.WriteAllText(path, text); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { Log.Error("now-playing.txt could not be written", ex); }
    }
}
