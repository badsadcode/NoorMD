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
        Version = "3.0.13",
        Density = "roomy",
        Menus =
        [
            new MenuSpec("File", [
                new MenuItemSpec("Add a music folder…", "music.addFolderUi"),
                new MenuItemSpec("Music folders…", "music.foldersUi"),
                new MenuItemSpec("Look for new music (rescan)", "music.rescanUi"),
                MenuItemSpec.Separator,
                new MenuItemSpec("New playlist…", "music.newPlaylist"),
                new MenuItemSpec("New smart collection…", "music.newSmart"),
                new MenuItemSpec("Import a playlist…", "music.importPlaylist"),
            ]),
            new MenuSpec("Edit", [
                new MenuItemSpec("Find in the library", "music.focusSearch", "Ctrl+F"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Edit the track…", "music.editTrack", "F2"),
                new MenuItemSpec("Edit the selected tracks… (Batch Organizer)", "music.batch"),
                new MenuItemSpec("Undo the last track edit", "music.undoEdit"),
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
                MenuItemSpec.Separator,
                new MenuItemSpec("Sound: equalizer and loudness…", "music.sound"),
            ]),
        ],
        Panels =
        [
            // The player and the library in one panel, to keep beside your writing (as in NoorMD 2.0). Not docked in
            // the Music bench itself (its tab has all of it); it docks in Markdown when you first play something.
            new PanelSpec("player", "Music", "♫", "none"),
        ],
    };

    MusicLibrary? _music;
    IBenchHost? _host;
    CancellationTokenSource? _scanCts;
    Task? _scanTask;
    readonly List<long> _scanQueued = [];
    readonly object _gate = new();

    ScanProgress? _lastScan;
    TrackEditor? _editor;
    BatchOrganizer? _batch;
    TrackEditor Editor(IBenchHost host) { var lib = Lib(host); lock (_gate) return _editor ??= new TrackEditor(lib); }
    BatchOrganizer Batch(IBenchHost host) { var lib = Lib(host); lock (_gate) return _batch ??= new BatchOrganizer(lib); }
    MusicLibrary Lib(IBenchHost host)
    {
        _host = host;
        bool first;
        MusicLibrary lib;
        lock (_gate) { first = _music == null; lib = _music ??= new MusicLibrary(Path.Combine(host.DataFolder, "library.db")); }
        // Each start looks through the folders again in the background (unchanged files are skipped at once), so a scan
        // that was stopped (NoorMD closed half-way) carries on, and new music turns up by itself.
        if (first) { var ids = lib.Folders().Select(f => f.Id).ToList(); if (ids.Count > 0) StartScan(host, ids); }
        return lib;
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
            var q = WithSmart(host, MusicRequests.Query(a), a);
            var res = Lib(host).Query(q);
            return Task.FromResult<JsonNode?>(new JsonObject { ["total"] = res.Total, ["offset"] = q.Offset, ["rows"] = new JsonArray(res.Rows.Select(Row).ToArray()) });
        });
        Command("music.ids", (a, host, _) =>
            Task.FromResult<JsonNode?>(new JsonArray(Lib(host).QueryIds(WithSmart(host, MusicRequests.Query(a), a) with { Offset = 0, Limit = 50_000 }).Select(i => (JsonNode?)i).ToArray())));
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
        // ------------------------------------------------------------ editing a track's tags and file name (journaled; undoable)
        Command("music.edit.validate", (a, host, _) =>
            Task.FromResult<JsonNode?>(new JsonArray(Editor(host).Validate(Long(a, "id"), Opt(a, "fileName", 1000)).Select(p => (JsonNode?)p).ToArray())));
        Command("music.edit.apply", async (a, host, ct) =>
        {
            var id = Long(a, "id");
            var tags = Run(() => MusicRequests.Tags(a));
            var rename = a.TryGetProperty("rename", out var rn) && rn.ValueKind == JsonValueKind.True ? Opt(a, "fileName", 1000) : null;
            return EditResult(host, await Task.Run(() => Run(() => Editor(host).Apply(id, tags, rename)), ct));
        });
        Command("music.undo", async (a, host, ct) =>
        {
            var last = Editor(host).LastUndoable() ?? throw new BenchException("There is no track edit to undo.");
            if (last.BatchId is long batchId) return BatchResult(host, await Task.Run(() => Run(() => Batch(host).Undo(batchId)), ct));
            return EditResult(host, await Task.Run(() => Run(() => Editor(host).Undo(last.Id)), ct));
        });
        Command("music.suggestName", (a, host, _) => Task.FromResult<JsonNode?>(SafeRename.SuggestName(Opt(a, "title", 500), Opt(a, "artist", 500))));

        // ------------------------------------------------------------ the batch organizer (preview first; every change undoable)
        Command("music.batch.preview", async (a, host, ct) =>
        {
            var ids = MusicRequests.Ids(a, "ids");
            var spec = Run(() => MusicRequests.Batch(a));
            var pv = await Task.Run(() => Run(() => Batch(host).Preview(ids, spec)), ct);
            return new JsonObject
            {
                ["willChange"] = pv.WillChange, ["unchanged"] = pv.Unchanged, ["blocked"] = pv.Blocked,
                ["items"] = new JsonArray(pv.Items.Select(i => (JsonNode?)new JsonObject
                {
                    ["id"] = i.TrackId, ["folder"] = i.Folder, ["oldName"] = i.OldName, ["newName"] = i.NewName, ["renames"] = i.Renames, ["ok"] = i.Ok,
                    ["tags"] = new JsonArray(i.TagChanges.Select(c => (JsonNode?)new JsonObject { ["field"] = c.Field, ["old"] = c.Old, ["new"] = c.New }).ToArray()),
                    ["problems"] = Strings(i.Problems), ["warnings"] = Strings(i.Warnings),
                }).ToArray()),
            };
        });
        Command("music.batch.apply", async (a, host, ct) =>
        {
            var ids = MusicRequests.Ids(a, "ids");
            var spec = Run(() => MusicRequests.Batch(a));
            return BatchResult(host, await Task.Run(() => Run(() => Batch(host).Apply(ids, spec)), ct));
        });
        Command("music.batch.undo", async (a, host, ct) => BatchResult(host, await Task.Run(() => Run(() => Batch(host).Undo(Long(a, "batchId"))), ct)));

        // ------------------------------------------------------------ smart collections (rules, kept up to date)
        Command("music.smart.save", (a, host, _) =>
        {
            var rules = Run(() => SmartSql.FromPayload(a.TryGetProperty("rules", out var r) ? r : default));
            var name = Opt(a, "name", 200)?.Trim() ?? "";
            if (name.Length == 0) throw new BenchException("Give the smart collection a name.");
            var id = Run(() => Lib(host).SaveSmart(OptLong(a, "id"), name, rules));
            host.Post("playlists");
            return Task.FromResult<JsonNode?>(new JsonObject { ["id"] = id, ["smart"] = Smart(host) });
        });
        Command("music.smart.count", (a, host, _) =>
            Task.FromResult<JsonNode?>(Run(() => Lib(host).Query(new LibraryQuery(Smart: SmartSql.FromPayload(a.TryGetProperty("rules", out var r) ? r : default), Limit: 1)).Total)));
        Command("music.smart.delete", (a, host, _) => { Lib(host).DeleteSmart(Long(a, "id")); host.Post("playlists"); return Task.FromResult<JsonNode?>(Smart(host)); });

        // ------------------------------------------------------------ files out and in (only through the system dialogs)
        Command("music.art.save", async (a, host, ct) =>
        {
            var t = Lib(host).Get(Long(a, "id")) ?? throw new BenchException("That track is no longer in the library.");
            var art = TagIO.ReadArtwork(t.Path) ?? FolderArt.Read(t.Folder) ?? throw new BenchException("This track has no cover picture.");
            var ext = art.MimeType switch { "image/png" => ".png", "image/webp" => ".webp", "image/gif" => ".gif", _ => ".jpg" };
            var path = await host.PickSaveFileAsync("Save the cover as a picture", SafeRename.SuggestName(t.Album ?? t.DisplayTitle, t.Artist) + " cover" + ext, [new FileFilter("Picture", [ext])]);
            if (path == null) return new JsonObject { ["cancelled"] = true };
            await Task.Run(() => Markdown.Core.AtomicFile.WriteAllBytes(path, art.Data), ct);
            return new JsonObject { ["path"] = path };
        });
        Command("music.playlist.import", async (a, host, ct) =>
        {
            var picked = await host.PickFilesAsync("Import a playlist", [new FileFilter("Playlists", [".m3u", ".m3u8"])]);
            if (picked.Count == 0) return new JsonObject { ["cancelled"] = true };
            var file = picked[0];
            var lib = Lib(host);
            var r = await Task.Run(() =>
            {
                var ids = new List<long>();
                int missing = 0, unsupported = 0;
                foreach (var p in M3u.Read(file))
                {
                    ct.ThrowIfCancellationRequested();
                    if (!AudioFormats.IsAudio(p)) { unsupported++; continue; }
                    if (!File.Exists(p)) { missing++; continue; }
                    try { ids.Add(lib.AddFile(p)); } catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { missing++; }
                }
                var id = lib.CreatePlaylist(Path.GetFileNameWithoutExtension(file));
                lib.SetPlaylistItems(id, ids);
                return new JsonObject { ["playlistId"] = id, ["added"] = ids.Count, ["missing"] = missing, ["unsupported"] = unsupported };
            }, ct);
            host.Post("playlists"); host.Post("changed", new { });
            return r;
        });
        Command("music.playlist.export", async (a, host, ct) =>
        {
            var lib = Lib(host);
            var id = Long(a, "id");
            var name = lib.PlaylistName(id) ?? throw new BenchException("That playlist no longer exists.");
            var path = await host.PickSaveFileAsync("Export the playlist", SafeRename.SuggestName(name, null) + ".m3u8", [new FileFilter("M3U8 playlist", [".m3u8"])]);
            if (path == null) return null;
            var tracks = lib.GetMany(lib.PlaylistTrackIds(id));
            await Task.Run(() => M3u.Write(path, tracks.Select(t => new M3u.Entry(t.Path, t.Duration, t.Artist == null ? t.DisplayTitle : $"{t.Artist} - {t.DisplayTitle}"))), ct);
            return new JsonObject { ["path"] = path, ["count"] = tracks.Count };
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
                if (sp.Phase is "done" or "error" or "unavailable" or "cancelled") _lastScan = sp;
                if (sp.Phase is "indexing" or "discovering" && sp.Discovered > 0 && (DateTime.UtcNow - last).TotalMilliseconds < 400) return;
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
                    catch (Exception ex) { host.Log("Music scan failed: " + ex.Message); var e = new ScanProgress(id, "error", 0, 0, 0, 0, 0, 0, 1, ex.Message); _lastScan = e; host.Post("scan", e); }
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
            ["smart"] = Smart(host),
            ["undo"] = DescribeUndo(host),
            ["lastScan"] = _lastScan is { } ls ? new JsonObject { ["phase"] = ls.Phase, ["discovered"] = ls.Discovered, ["added"] = ls.Added, ["errors"] = ls.Errors, ["message"] = ls.Message } : null,
        };
    }
    LibraryQuery WithSmart(IBenchHost host, LibraryQuery q, JsonElement a)
    {
        if (OptLong(a, "smartId") is not long sid) return q;
        var sc = Lib(host).Smart(sid) ?? throw new BenchException("That smart collection no longer exists.");
        return q with { Smart = sc.Rules };
    }
    JsonArray Smart(IBenchHost host)
    {
        var lib = Lib(host);
        return new(lib.SmartCollections().Select(sc => (JsonNode?)new JsonObject
        {
            ["id"] = sc.Id, ["name"] = sc.Name, ["matchAll"] = sc.Rules.MatchAll, ["limit"] = sc.Rules.Limit, ["limitSort"] = sc.Rules.LimitSort, ["limitDesc"] = sc.Rules.LimitDesc,
            ["rules"] = new JsonArray(sc.Rules.Rules.Select(r => (JsonNode?)new JsonObject { ["field"] = r.Field, ["op"] = r.Op, ["value"] = r.Value }).ToArray()),
            ["count"] = lib.Query(new LibraryQuery(Smart: sc.Rules, Limit: 1)).Total,
        }).ToArray());
    }
    JsonNode? DescribeUndo(IBenchHost host)
    {
        if (Editor(host).LastUndoable() is not { } j) return null;
        if (j.BatchId is long b)
            return new JsonObject { ["id"] = j.Id, ["utc"] = j.Utc.ToString("o"), ["batchId"] = b, ["count"] = Lib(host).BatchJournal(b).Count(e => e.Status is "done" or "partial") };
        return new JsonObject { ["id"] = j.Id, ["utc"] = j.Utc.ToString("o"), ["oldName"] = Path.GetFileName(j.OldPath), ["newName"] = Path.GetFileName(j.NewPath) };
    }
    JsonNode EditResult(IBenchHost host, Music.Core.EditResult r)
    {
        host.Post("changed", new { trackId = r.Track?.Id });
        return new JsonObject { ["ok"] = r.Ok, ["tagsSaved"] = r.TagsSaved, ["renamed"] = r.Renamed, ["problems"] = Strings(r.Problems), ["track"] = r.Track == null ? null : Detail(r.Track), ["undo"] = DescribeUndo(host) };
    }
    JsonNode BatchResult(IBenchHost host, Music.Core.BatchResult r)
    {
        host.Post("changed", new { });
        return new JsonObject
        {
            ["batchId"] = r.BatchId, ["done"] = r.Done, ["failed"] = r.Failed, ["skipped"] = r.Skipped,
            ["items"] = new JsonArray(r.Items.Select(i => (JsonNode?)new JsonObject { ["id"] = i.TrackId, ["oldName"] = i.OldName, ["newName"] = i.NewName, ["status"] = i.Status, ["message"] = i.Message }).ToArray()),
            ["undo"] = DescribeUndo(host),
        };
    }
    static JsonArray Strings(IEnumerable<string> xs) => new(xs.Select(x => (JsonNode?)x).ToArray());

    static JsonObject StatsJson(LibraryStats s) => new()
    {
        ["total"] = s.Total, ["missing"] = s.Missing, ["favorite"] = s.Favorite, ["keep"] = s.Keep, ["maybe"] = s.Maybe, ["skip"] = s.Skip, ["untriaged"] = s.Untriaged,
    };
    JsonArray Playlists(IBenchHost host) => new(Lib(host).Playlists().Select(p => (JsonNode?)new JsonObject { ["id"] = p.Id, ["name"] = p.Name, ["count"] = p.Count }).ToArray());

    static JsonNode? Row(TrackRow t) => new JsonObject
    {
        ["id"] = t.Id, ["title"] = t.Title, ["displayTitle"] = t.DisplayTitle, ["artist"] = t.Artist, ["album"] = t.Album, ["genre"] = t.Genre, ["year"] = t.Year,
        ["duration"] = t.Duration, ["triage"] = (int)t.Triage, ["missing"] = t.Missing, ["fileName"] = t.FileName, ["folder"] = t.Folder, ["hasArt"] = t.HasArtwork, ["readError"] = t.ReadError,
        ["rgGain"] = Num(t.ReplayGainDb), ["rgPeak"] = Num(t.ReplayGainPeak), ["loudness"] = Num(t.Loudness), ["peak"] = Num(t.Peak), ["plays"] = t.PlayCount,
    };
    static JsonNode? Num(double? v) => v is double d && double.IsFinite(d) ? d : null;

    static JsonNode Detail(TrackRow t) => new JsonObject
    {
        ["id"] = t.Id, ["path"] = t.Path, ["fileName"] = t.FileName, ["folder"] = t.Folder, ["displayTitle"] = t.DisplayTitle, ["triage"] = (int)t.Triage,
        ["missing"] = t.Missing || !File.Exists(t.Path), ["hasArt"] = t.HasArtwork, ["readError"] = t.ReadError, ["duration"] = t.Duration, ["playCount"] = t.PlayCount,
        ["readOnly"] = File.Exists(t.Path) && new FileInfo(t.Path).IsReadOnly,
        ["tags"] = new JsonObject { ["title"] = t.Title, ["artist"] = t.Artist, ["album"] = t.Album, ["albumArtist"] = t.AlbumArtist, ["genre"] = t.Genre, ["year"] = t.Year, ["trackNumber"] = t.TrackNumber, ["comment"] = t.Comment },
    };

    // ------------------------------------------------------------------ helpers

    static string Str(JsonElement a, string name) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
    static long? OptLong(JsonElement a, string name) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : null;
    static double? OptDouble(JsonElement a, string name) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;
    static string? Opt(JsonElement a, string name, int max)
    {
        if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String) return null;
        var t = v.GetString()!;
        return t.Length > max ? throw new BenchException($"“{name}” is too long.") : t;
    }
    static long Long(JsonElement a, string name) => OptLong(a, name) ?? throw new BenchException($"Missing “{name}”.");
    static T Run<T>(Func<T> fn)
    {
        try { return fn(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException) { throw new BenchException(ex.Message); }
    }
}
