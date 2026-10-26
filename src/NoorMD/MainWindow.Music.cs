using System.Diagnostics;
using System.IO;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Media;

namespace NoorMD;

/// <summary>
/// Creator's Bench host side: the music index, background scanning, audio/artwork serving and track editing.
/// The page refers to tracks only by library id; paths come from native dialogs, never from the page.
/// Nothing here starts until the Music Bench is first used.
/// </summary>
public partial class MainWindow
{
    private MusicLibrary? _music;
    private TrackEditor? _trackEditor;
    private BatchOrganizer? _batch;
    private CancellationTokenSource? _scanCts;
    private Task? _scanTask;

    private MusicLibrary Music
    {
        get
        {
            if (_music != null) return _music;
            _music = new MusicLibrary(Path.Combine(App.Paths.Local, "Music", "library.db"));
            _trackEditor = new TrackEditor(_music);
            _batch = new BatchOrganizer(_music);
            return _music;
        }
    }
    private TrackEditor Editor => (_ = Music) != null ? _trackEditor! : throw new InvalidOperationException();
    private BatchOrganizer Batch => (_ = Music) != null ? _batch! : throw new InvalidOperationException();

    // ------------------------------------------------------------------ media serving

    /// <summary>Serves /_media/{id} (audio, with HTTP ranges) and /_art/{id} (embedded artwork).</summary>
    private bool TryServeMedia(Uri uri, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var path = uri.AbsolutePath;
        var isMedia = path.StartsWith("/_media/", StringComparison.Ordinal);
        var isArt = path.StartsWith("/_art/", StringComparison.Ordinal);
        if (!isMedia && !isArt) return false;
        if (!long.TryParse(path[(isMedia ? 8 : 6)..], out var id) || _music == null || _music.Get(id) is not { } track)
        {
            e.Response = Core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
            return true;
        }
        if (isArt)
        {
            var art = TagIO.ReadArtwork(track.Path);
            e.Response = art is { } a
                ? Core.Environment.CreateWebResourceResponse(new MemoryStream(a.Data), 200, "OK", $"Content-Type: {a.MimeType}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff")
                : Core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
            return true;
        }
        string? range = null;
        try { range = e.Request.Headers.GetHeader("Range"); } catch { /* no Range header */ }
        var r = MediaResponse.Build(track.Path, range, AudioFormats.ContentType(track.Path));
        e.Response = Core.Environment.CreateWebResourceResponse(r.Body.Length > 0 ? new MemoryStream(r.Body) : null, r.Status, r.Reason, r.Headers);
        return true;
    }

    // ------------------------------------------------------------------ bridge

    private static readonly JsonSerializerOptions MusicJson = new(JsonSerializerDefaults.Web);

    private async Task<object?> DispatchMusicAsync(BridgeRequest req)
    {
        var p = req.Payload;
        switch (req.Type)
        {
            case "music.status":
                return new { folders = Music.Folders(), stats = Music.Stats(), playlists = Music.Playlists(), scanning = _scanTask is { IsCompleted: false }, undo = DescribeUndo() };
            case "music.addFolder":
            {
                var dlg = new OpenFolderDialog { Title = "Add a music folder (subfolders included)", Multiselect = false };
                if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                var id = Music.AddFolder(dlg.FolderName, recursive: true);
                StartScan([id]);
                return new { folderId = id };
            }
            case "music.removeFolder":
                Music.RemoveFolder(Long(p, "id"));
                PushEvent("music.changed", new { });
                return null;
            case "music.rescan":
                StartScan(NoorMD.Core.Bridge.Json.OptLong(p, "id") is long one ? [one] : Music.Folders().Select(f => f.Id).ToList());
                return null;
            case "music.cancelScan":
                _scanCts?.Cancel();
                return null;
            case "music.query":
                var q = MusicRequests.Query(p);
                var res = Music.Query(q);
                return new { total = res.Total, offset = q.Offset, rows = res.Rows.Select(Row) };
            case "music.ids":
                return Music.QueryIds(MusicRequests.Query(p) with { Offset = 0 });
            case "music.tracks":
                return Music.GetMany(Ids(p, "ids")).Select(Row);
            case "music.track":
                return Music.Get(Long(p, "id")) is { } t ? Detail(t) : throw new BridgeError("That track is no longer in the library.");
            case "music.setTriage":
                Music.SetTriage(Ids(p, "ids"), (Triage)Math.Clamp((int)Long(p, "value"), 0, 4));
                return Music.Stats();
            case "music.played":
                Music.MarkPlayed(Long(p, "id"));
                return null;
            case "music.edit.validate":
                return Editor.Validate(Long(p, "id"), req.GetString("fileName", 1000));
            case "music.edit.apply":
                return EditResultForPage(await Task.Run(() => Editor.Apply(Long(p, "id"), MusicRequests.Tags(p), NoorMD.Core.Bridge.Json.IsTrue(p, "rename") ? req.GetString("fileName", 1000) : null)));
            case "music.undo":
            {
                var last = Editor.LastUndoable() ?? throw new BridgeError("There is no track edit to undo.");
                if (last.BatchId is long batchId) return BatchResultForPage(await Task.Run(() => Batch.Undo(batchId)));
                return EditResultForPage(await Task.Run(() => Editor.Undo(last.Id)));
            }
            case "music.batch.preview":
            {
                var ids = Ids(p, "ids");
                var spec = MusicRequests.Batch(p);
                try
                {
                    var pv = await Task.Run(() => Batch.Preview(ids, spec));
                    return new { willChange = pv.WillChange, unchanged = pv.Unchanged, blocked = pv.Blocked, items = pv.Items.Select(BatchItemForPage) };
                }
                catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
            }
            case "music.batch.apply":
            {
                var ids = Ids(p, "ids");
                var spec = MusicRequests.Batch(p);
                try { return BatchResultForPage(await Task.Run(() => Batch.Apply(ids, spec))); }
                catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
            }
            case "music.batch.undo":
                return BatchResultForPage(await Task.Run(() => Batch.Undo(Long(p, "batchId"))));
            case "music.suggestName":
                return SafeRename.SuggestName(req.GetString("title", 500), req.GetString("artist", 500));
            case "music.playlists":
                return Music.Playlists();
            case "music.playlist.create":
            {
                var id = Music.CreatePlaylist(req.GetString("name", 200) ?? "New playlist");
                if (p.TryGetProperty("ids", out _)) Music.SetPlaylistItems(id, Ids(p, "ids"));
                return new { id };
            }
            case "music.playlist.rename": Music.RenamePlaylist(Long(p, "id"), req.GetString("name", 200) ?? ""); return null;
            case "music.playlist.delete": Music.DeletePlaylist(Long(p, "id")); return null;
            case "music.playlist.setItems": Music.SetPlaylistItems(Long(p, "id"), Ids(p, "ids")); return null;
            case "music.playlist.add": Music.AddToPlaylist(Long(p, "id"), Ids(p, "ids")); return Music.Playlists();
            case "music.playlist.import": return await ImportPlaylistAsync();
            case "music.playlist.export": return ExportPlaylist(Long(p, "id"));
            case "music.session.get": return Music.GetState("session");
            case "music.session.save":
            {
                var json = req.GetString("json", 4_000_000) ?? "{}";
                using var _ = JsonDocument.Parse(json); // must be valid JSON
                Music.SetState("session", json);
                return null;
            }
            case "music.reveal":
            {
                var tr = Music.Get(Long(p, "id")) ?? throw new BridgeError("Unknown track.");
                if (!File.Exists(tr.Path)) throw new BridgeError($"\"{tr.FileName}\" is missing on disk.");
                Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{tr.Path}\"") { UseShellExecute = false });
                return null;
            }
            default:
                throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }

    private object? DescribeUndo()
    {
        if (_trackEditor?.LastUndoable() is not { } j) return null;
        if (j.BatchId is long b)
            return new { id = j.Id, utc = j.Utc, batchId = b, count = Music.BatchJournal(b).Count(e => e.Status is "done" or "partial") };
        return new { id = j.Id, utc = j.Utc, oldName = Path.GetFileName(j.OldPath), newName = Path.GetFileName(j.NewPath) };
    }

    private static object BatchItemForPage(BatchItem i) => new
    {
        id = i.TrackId, folder = i.Folder, oldName = i.OldName, newName = i.NewName, renames = i.Renames, ok = i.Ok,
        tags = i.TagChanges.Select(c => new { field = c.Field, old = c.Old, @new = c.New }), problems = i.Problems, warnings = i.Warnings,
    };

    private object BatchResultForPage(BatchResult r)
    {
        PushEvent("music.changed", new { });
        return new
        {
            batchId = r.BatchId, done = r.Done, failed = r.Failed, skipped = r.Skipped,
            items = r.Items.Select(i => new { id = i.TrackId, oldName = i.OldName, newName = i.NewName, status = i.Status, message = i.Message }),
            undo = DescribeUndo(),
        };
    }

    private object EditResultForPage(EditResult r)
    {
        PushEvent("music.changed", new { trackId = r.Track?.Id });
        return new { ok = r.Ok, tagsSaved = r.TagsSaved, renamed = r.Renamed, problems = r.Problems, track = r.Track == null ? null : Detail(r.Track), undo = DescribeUndo() };
    }

    private void StartScan(IReadOnlyList<long> folderIds)
    {
        if (_scanTask is { IsCompleted: false }) { PushNotice("A scan is already running."); return; }
        _scanCts = new CancellationTokenSource();
        var ct = _scanCts.Token;
        var lastPush = DateTime.MinValue;
        var progress = new Progress<ScanProgress>(sp =>
        {
            // Progress<T> posts back to the UI thread; throttle so a fast scan doesn't flood the page.
            if (sp.Phase is "indexing" && (DateTime.UtcNow - lastPush).TotalMilliseconds < 400) return;
            lastPush = DateTime.UtcNow;
            PushEvent("music.scan", sp);
        });
        var lib = Music;
        _scanTask = Task.Run(() =>
        {
            foreach (var id in folderIds)
            {
                if (ct.IsCancellationRequested) break;
                try { lib.ScanFolder(id, progress, ct); }
                catch (Exception ex) { Log.Error("Music scan failed", ex); ((IProgress<ScanProgress>)progress).Report(new ScanProgress(id, "error", 0, 0, 0, 0, 0, 0, 1, ex.Message)); }
            }
        }, ct).ContinueWith(_ => Dispatcher.BeginInvoke(() => PushEvent("music.changed", new { scanFinished = true })), TaskScheduler.Default);
    }

    private async Task<object?> ImportPlaylistAsync()
    {
        var dlg = new OpenFileDialog { Title = "Import playlist", Filter = "Playlists (*.m3u;*.m3u8)|*.m3u;*.m3u8|All files (*.*)|*.*", CheckFileExists = true };
        if (dlg.ShowDialog(this) != true) return new { cancelled = true };
        var file = dlg.FileName;
        var lib = Music;
        return await Task.Run(() =>
        {
            var paths = M3u.Read(file);
            var ids = new List<long>();
            int missing = 0, unsupported = 0;
            foreach (var path in paths)
            {
                if (!AudioFormats.IsAudio(path)) { unsupported++; continue; }
                if (!File.Exists(path)) { missing++; continue; }
                ids.Add(lib.AddFile(path));
            }
            var id = lib.CreatePlaylist(Path.GetFileNameWithoutExtension(file));
            lib.SetPlaylistItems(id, ids);
            return (object)new { playlistId = id, added = ids.Count, missing, unsupported };
        });
    }

    private object? ExportPlaylist(long id)
    {
        var name = Music.PlaylistName(id) ?? throw new BridgeError("Unknown playlist.");
        var dlg = new SaveFileDialog { Title = "Export playlist", Filter = "M3U8 playlist (*.m3u8)|*.m3u8", DefaultExt = ".m3u8", FileName = NoorMD.Core.Documents.DocumentFile.SafeFileName(name, ".m3u8"), OverwritePrompt = true };
        if (dlg.ShowDialog(this) != true) return null;
        var tracks = Music.GetMany(Music.PlaylistTrackIds(id));
        M3u.Write(dlg.FileName, tracks.Select(t => new M3u.Entry(t.Path, t.Duration, t.Artist == null ? t.DisplayTitle : $"{t.Artist} - {t.DisplayTitle}")));
        return new { path = dlg.FileName, count = tracks.Count };
    }

    // ------------------------------------------------------------------ payload helpers

    private static long Long(JsonElement p, string name) =>
        NoorMD.Core.Bridge.Json.OptLong(p, name) ?? throw new BridgeError($"Missing \"{name}\".");

    private static List<long> Ids(JsonElement p, string name) => MusicRequests.Ids(p, name);

    private static object Row(TrackRow t) => new
    {
        id = t.Id, title = t.Title, displayTitle = t.DisplayTitle, artist = t.Artist, album = t.Album, genre = t.Genre, year = t.Year,
        duration = t.Duration, triage = (int)t.Triage, missing = t.Missing, fileName = t.FileName, folder = t.Folder, hasArt = t.HasArtwork, readError = t.ReadError,
    };

    private static object Detail(TrackRow t) => new
    {
        id = t.Id, path = t.Path, fileName = t.FileName, folder = t.Folder, displayTitle = t.DisplayTitle, triage = (int)t.Triage, missing = t.Missing || !File.Exists(t.Path),
        hasArt = t.HasArtwork, readError = t.ReadError, duration = t.Duration, playCount = t.PlayCount,
        readOnly = File.Exists(t.Path) && new FileInfo(t.Path).IsReadOnly,
        tags = new { title = t.Title, artist = t.Artist, album = t.Album, albumArtist = t.AlbumArtist, genre = t.Genre, year = t.Year, trackNumber = t.TrackNumber, comment = t.Comment },
    };
}
