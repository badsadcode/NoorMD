using System.Text.Json;
using System.Text.Json.Nodes;
using Music.Core;
using Noor.Contracts;

namespace Music.Bench;

/// <summary>Music: your music folders as a library (search, sort, favourites, playlists) and a player that keeps
/// playing whichever bench you're in. The page refers to tracks only by library id; folders come from the folder
/// dialog, never from the page. Audio and artwork are streamed to the page (/media/noor.music/…), with ranges.</summary>
public sealed class MusicBench : BenchBase, IBenchMedia
{
    public override BenchManifest Manifest { get; } = new()
    {
        Id = "noor.music",
        Name = "Music",
        Icon = "♫",
        Description = "Your music library and a player that keeps playing beside your work: queue, playlists, favourites, equalizer.",
        Version = "3.0.12",
        Density = "roomy",
        Menus =
        [
            new MenuSpec("File", [
                new MenuItemSpec("Add a music folder…", "music.addFolderUi"),
                new MenuItemSpec("Music folders…", "music.foldersUi"),
                new MenuItemSpec("Look for new music (rescan)", "music.rescanUi"),
                MenuItemSpec.Separator,
                new MenuItemSpec("New playlist…", "music.newPlaylist"),
            ]),
            new MenuSpec("Edit", [
                new MenuItemSpec("Find in the library", "music.focusSearch", "Ctrl+F"),
            ]),
            new MenuSpec("Playback", [
                new MenuItemSpec("Play / pause", "music.toggle"),
                new MenuItemSpec("Next", "music.next"),
                new MenuItemSpec("Previous", "music.prev"),
                new MenuItemSpec("A random track", "music.random"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Shuffle", "music.shuffle"),
                new MenuItemSpec("Repeat: off / all / this track", "music.repeat"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Show the playing track", "music.reveal.playing"),
                new MenuItemSpec("Favourite the playing track ★", "music.favCurrent"),
            ]),
        ],
        Panels =
        [
            new PanelSpec("player", "Now playing", "♫", "right"),
            new PanelSpec("queue", "Up next", "☰", "right"),
            new PanelSpec("sound", "Sound", "🎚", "right"),
        ],
    };

    MusicLibrary? _music;
    IBenchHost? _host;
    CancellationTokenSource? _scanCts;
    Task? _scanTask;
    readonly List<long> _scanQueued = [];
    readonly object _gate = new();

    MusicLibrary Lib(IBenchHost host)
    {
        _host = host;
        lock (_gate) return _music ??= new MusicLibrary(Path.Combine(host.DataFolder, "library.db"));
    }

    public MusicBench()
    {
        Command("music.status", (a, host, _) => Task.FromResult<JsonNode?>(Status(host)));
        Command("music.addFolder", async (a, host, _) =>
        {
            var folder = await host.PickFolderAsync("Add a music folder (its subfolders too)");
            if (folder == null) return null;
            var id = Run(() => Lib(host).AddFolder(folder, recursive: true));
            StartScan(host, [id]);
            return new JsonObject { ["folderId"] = id, ["path"] = folder };
        });
        Command("music.removeFolder", (a, host, _) =>
        {
            Run(() => { Lib(host).RemoveFolder(Long(a, "id")); return 0; });
            host.Post("changed");
            return Task.FromResult<JsonNode?>(Status(host));
        });
        Command("music.rescan", (a, host, _) =>
        {
            var lib = Lib(host);
            StartScan(host, OptLong(a, "id") is long one ? [one] : lib.Folders().Select(f => f.Id).ToList());
            return Task.FromResult<JsonNode?>(null);
        });
        Command("music.cancelScan", (a, host, _) => { _scanCts?.Cancel(); return Task.FromResult<JsonNode?>(null); });
        Command("music.query", (a, host, _) =>
        {
            var q = MusicRequests.Query(a);
            var res = Lib(host).Query(q);
            return Task.FromResult<JsonNode?>(new JsonObject { ["total"] = res.Total, ["offset"] = q.Offset, ["rows"] = new JsonArray(res.Rows.Select(Row).ToArray()) });
        });
        Command("music.ids", (a, host, _) =>
            Task.FromResult<JsonNode?>(new JsonArray(Lib(host).QueryIds(MusicRequests.Query(a) with { Offset = 0, Limit = 50_000 }).Select(i => (JsonNode?)i).ToArray())));
        Command("music.tracks", (a, host, _) =>
            Task.FromResult<JsonNode?>(new JsonArray(Lib(host).GetMany(MusicRequests.Ids(a, "ids").Take(2000)).Select(Row).ToArray())));
        Command("music.track", (a, host, _) =>
            Task.FromResult<JsonNode?>(Lib(host).Get(Long(a, "id")) is { } t ? Detail(t) : throw new BenchException("That track is no longer in the library.")));
        Command("music.setTriage", (a, host, _) =>
        {
            var ids = MusicRequests.Ids(a, "ids");
            Lib(host).SetTriage(ids, (Triage)Math.Clamp((int)(OptLong(a, "value") ?? 0), 0, 4));
            host.Post("triage", new { ids, value = OptLong(a, "value") ?? 0 });
            return Task.FromResult<JsonNode?>(StatsJson(Lib(host).Stats()));
        });
        Command("music.played", (a, host, _) => { Lib(host).MarkPlayed(Long(a, "id")); return Task.FromResult<JsonNode?>(null); });
        Command("music.playlists", (a, host, _) => Task.FromResult<JsonNode?>(Playlists(host)));
        Command("music.playlist.create", (a, host, _) =>
        {
            var name = Str(a, "name").Trim();
            var id = Lib(host).CreatePlaylist(name.Length > 0 ? name[..Math.Min(200, name.Length)] : "New playlist");
            var ids = MusicRequests.Ids(a, "ids");
            if (ids.Count > 0) Lib(host).SetPlaylistItems(id, ids);
            host.Post("playlists");
            return Task.FromResult<JsonNode?>(new JsonObject { ["id"] = id });
        });
        Command("music.playlist.rename", (a, host, _) =>
        {
            var name = Str(a, "name").Trim();
            if (name.Length == 0) throw new BenchException("Give the playlist a name.");
            Lib(host).RenamePlaylist(Long(a, "id"), name[..Math.Min(200, name.Length)]);
            host.Post("playlists");
            return Task.FromResult<JsonNode?>(null);
        });
        Command("music.playlist.delete", (a, host, _) => { Lib(host).DeletePlaylist(Long(a, "id")); host.Post("playlists"); return Task.FromResult<JsonNode?>(null); });
        Command("music.playlist.setItems", (a, host, _) => { Lib(host).SetPlaylistItems(Long(a, "id"), MusicRequests.Ids(a, "ids")); host.Post("playlists"); return Task.FromResult<JsonNode?>(null); });
        Command("music.playlist.add", (a, host, _) => { Lib(host).AddToPlaylist(Long(a, "id"), MusicRequests.Ids(a, "ids")); host.Post("playlists"); return Task.FromResult<JsonNode?>(Playlists(host)); });
        Command("music.session.get", (a, host, _) => Task.FromResult<JsonNode?>(Lib(host).GetState("session") is { } s ? JsonNode.Parse(s) : null));
        Command("music.session.save", (a, host, _) =>
        {
            if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty("session", out var s) || s.ValueKind != JsonValueKind.Object) throw new BenchException("No session.");
            var json = s.GetRawText();
            if (json.Length > 4_000_000) throw new BenchException("The session is too big.");
            Lib(host).SetState("session", json);
            return Task.FromResult<JsonNode?>(null);
        });
        Command("music.loudness.set", (a, host, _) =>
        {
            try { Lib(host).SetLoudness(Long(a, "id"), OptDouble(a, "lufs") ?? double.NaN, OptDouble(a, "peak") ?? double.NaN); }
            catch (ArgumentException ex) { throw new BenchException(ex.Message); }
            return Task.FromResult<JsonNode?>(null);
        });
        Command("music.loudness.unmeasured", (a, host, _) =>
        {
            var ids = a.ValueKind == JsonValueKind.Object && a.TryGetProperty("ids", out var _ids) ? MusicRequests.Ids(a, "ids") : null;
            return Task.FromResult<JsonNode?>(new JsonArray(Lib(host).Unmeasured(ids, (int)Math.Clamp(OptLong(a, "limit") ?? 50_000, 1, 50_000)).Select(i => (JsonNode?)i).ToArray()));
        });
        Command("music.reveal", (a, host, _) =>
        {
            var t = Lib(host).Get(Long(a, "id")) ?? throw new BenchException("That track is no longer in the library.");
            if (!File.Exists(t.Path)) throw new BenchException($"“{t.FileName}” is missing on disk.");
            if (OperatingSystem.IsWindows()) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", $"/select,\"{t.Path}\"") { UseShellExecute = false });
            return Task.FromResult<JsonNode?>(null);
        });
    }

    // ------------------------------------------------------------------ media: audio (with ranges) and artwork

    public BenchMediaReply? ServeMedia(string path, string? range)
    {
        MusicLibrary? lib;
        lock (_gate) lib = _music;
        var parts = path.Split('/');
        if (lib == null || parts.Length != 2 || !long.TryParse(parts[1], out var id) || lib.Get(id) is not { } track) return null;
        if (parts[0] == "track")
        {
            var r = MediaResponse.Build(track.Path, range, AudioFormats.ContentType(track.Path));
            return new BenchMediaReply(r.Status, r.Reason, r.Body.Length > 0 ? new MemoryStream(r.Body) : null, r.Headers);
        }
        if (parts[0] == "art")
        {
            var art = TagIO.ReadArtwork(track.Path) ?? FolderArt.Read(track.Folder);
            return art is { } x ? new BenchMediaReply(200, "OK", new MemoryStream(x.Data), $"Content-Type: {x.MimeType}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff") : null;
        }
        return null;
    }

    // ------------------------------------------------------------------ scanning (in the background; the page hears progress)

    void StartScan(IBenchHost host, IReadOnlyList<long> folderIds)
    {
        lock (_gate)
        {
            if (_scanTask is { IsCompleted: false })
            {
                foreach (var id in folderIds) if (!_scanQueued.Contains(id)) _scanQueued.Add(id);
                return;
            }
            _scanCts = new CancellationTokenSource();
            var ct = _scanCts.Token;
            var lib = Lib(host);
            var last = DateTime.MinValue;
            var progress = new Progress<ScanProgress>(sp =>
            {
                if (sp.Phase is "indexing" && (DateTime.UtcNow - last).TotalMilliseconds < 400) return;
                last = DateTime.UtcNow;
                host.Post("scan", sp);
            });
            _scanTask = Task.Run(() =>
            {
                foreach (var id in folderIds)
                {
                    if (ct.IsCancellationRequested) break;
                    try { lib.ScanFolder(id, progress, ct); }
                    catch (OperationCanceledException) { break; }
                    catch (Exception ex) { host.Log("Music scan failed: " + ex.Message); host.Post("scan", new ScanProgress(id, "error", 0, 0, 0, 0, 0, 0, 1, ex.Message)); }
                }
            }, ct).ContinueWith(_ =>
            {
                host.Post("changed", new { scanFinished = true });
                List<long> next;
                lock (_gate) { next = _scanQueued.ToList(); _scanQueued.Clear(); }
                if (next.Count > 0 && !ct.IsCancellationRequested) StartScan(host, next);
            }, TaskScheduler.Default);
        }
    }

    // ------------------------------------------------------------------ what the page sees

    JsonObject Status(IBenchHost host)
    {
        var lib = Lib(host);
        return new JsonObject
        {
            ["folders"] = new JsonArray(lib.Folders().Select(f => (JsonNode?)new JsonObject { ["id"] = f.Id, ["path"] = f.Path, ["tracks"] = f.TrackCount, ["lastScan"] = f.LastScanUtc?.ToString("o") }).ToArray()),
            ["stats"] = StatsJson(lib.Stats()),
            ["playlists"] = Playlists(host),
            ["scanning"] = _scanTask is { IsCompleted: false },
        };
    }
    static JsonObject StatsJson(LibraryStats s) => new()
    {
        ["total"] = s.Total, ["missing"] = s.Missing, ["favorite"] = s.Favorite, ["keep"] = s.Keep, ["maybe"] = s.Maybe, ["skip"] = s.Skip, ["untriaged"] = s.Untriaged,
    };
    JsonArray Playlists(IBenchHost host) => new(Lib(host).Playlists().Select(p => (JsonNode?)new JsonObject { ["id"] = p.Id, ["name"] = p.Name, ["count"] = p.Count }).ToArray());

    static JsonNode? Row(TrackRow t) => new JsonObject
    {
        ["id"] = t.Id, ["title"] = t.Title, ["displayTitle"] = t.DisplayTitle, ["artist"] = t.Artist, ["album"] = t.Album, ["genre"] = t.Genre, ["year"] = t.Year,
        ["duration"] = t.Duration, ["triage"] = (int)t.Triage, ["missing"] = t.Missing, ["fileName"] = t.FileName, ["hasArt"] = t.HasArtwork, ["readError"] = t.ReadError,
        ["rgGain"] = Num(t.ReplayGainDb), ["rgPeak"] = Num(t.ReplayGainPeak), ["loudness"] = Num(t.Loudness), ["peak"] = Num(t.Peak), ["plays"] = t.PlayCount,
    };
    static JsonNode? Num(double? v) => v is double d && double.IsFinite(d) ? d : null;

    static JsonNode Detail(TrackRow t) => new JsonObject
    {
        ["id"] = t.Id, ["path"] = t.Path, ["fileName"] = t.FileName, ["folder"] = t.Folder, ["displayTitle"] = t.DisplayTitle, ["triage"] = (int)t.Triage,
        ["missing"] = t.Missing || !File.Exists(t.Path), ["hasArt"] = t.HasArtwork, ["duration"] = t.Duration, ["playCount"] = t.PlayCount,
        ["tags"] = new JsonObject { ["title"] = t.Title, ["artist"] = t.Artist, ["album"] = t.Album, ["albumArtist"] = t.AlbumArtist, ["genre"] = t.Genre, ["year"] = t.Year, ["trackNumber"] = t.TrackNumber, ["comment"] = t.Comment },
    };

    // ------------------------------------------------------------------ helpers

    static string Str(JsonElement a, string name) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
    static long? OptLong(JsonElement a, string name) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : null;
    static double? OptDouble(JsonElement a, string name) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;
    static long Long(JsonElement a, string name) => OptLong(a, name) ?? throw new BenchException($"Missing “{name}”.");
    static T Run<T>(Func<T> fn)
    {
        try { return fn(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException) { throw new BenchException(ex.Message); }
    }
}
