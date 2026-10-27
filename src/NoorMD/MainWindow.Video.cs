using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Media;

namespace NoorMD;

/// <summary>
/// Video Bench: a local video library (series by folder, episode order, resume, subtitles, timestamped notes) and a
/// detachable always-on-top player window. Videos are served to the page by id from /_video/{id}; subtitles are
/// converted to WebVTT and served from /_sub/{id}/{n}. Files are never modified.
/// </summary>
public partial class MainWindow
{
    private VideoLibrary? _videoLib;
    private VideoWindow? _videoWindow;
    private Task? _videoScan;

    private VideoLibrary Videos => _videoLib ??= new VideoLibrary(Path.Combine(App.Paths.Local, "Video", "library.db"));

    /// <summary>Serves /_video/{id} (with HTTP ranges) and /_sub/{id}/{n} (WebVTT). Shared with the pop-out player window.</summary>
    internal bool TryServeVideo(Uri uri, CoreWebView2WebResourceRequestedEventArgs e, CoreWebView2Environment env)
    {
        var path = uri.AbsolutePath;
        var isVideo = path.StartsWith("/_video/", StringComparison.Ordinal);
        var isSub = path.StartsWith("/_sub/", StringComparison.Ordinal);
        if (!isVideo && !isSub) return false;
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2 || !long.TryParse(parts[1], out var id) || Videos.Get(id) is not { } v)
        {
            e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
            return true;
        }
        if (isSub)
        {
            var subs = SubtitleConverter.Find(v.Path);
            if (parts.Length < 3 || !int.TryParse(parts[2], out var n) || n < 0 || n >= subs.Count || new FileInfo(subs[n].Path).Length > SubtitleConverter.MaxBytes)
            {
                e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
                return true;
            }
            var vtt = SubtitleConverter.ToVtt(ReadSubtitleText(subs[n].Path), Path.GetExtension(subs[n].Path));
            e.Response = env.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(vtt)), 200, "OK", "Content-Type: text/vtt; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
            return true;
        }
        string? range = null;
        try { range = e.Request.Headers.GetHeader("Range"); } catch { /* no Range header */ }
        var r = MediaResponse.Build(v.Path, range ?? "bytes=0-", VideoFormats.ContentType(v.Path)); // always ranged: videos can be gigabytes
        e.Response = env.CreateWebResourceResponse(r.Body.Length > 0 ? new MemoryStream(r.Body) : null, r.Status, r.Reason, r.Headers);
        return true;
    }

    /// <summary>Subtitle files come in UTF-8, UTF-16 (with BOM) or an old ANSI code page; fall back to Windows-1252 when UTF-8 doesn't fit.</summary>
    private static string ReadSubtitleText(string path)
    {
        var bytes = File.ReadAllBytes(path);
        try
        {
            using var reader = new StreamReader(new MemoryStream(bytes), new UTF8Encoding(false, throwOnInvalidBytes: true), detectEncodingFromByteOrderMarks: true);
            return reader.ReadToEnd();
        }
        catch (DecoderFallbackException)
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            return Encoding.GetEncoding(1252).GetString(bytes);
        }
    }

    private async Task<object?> DispatchVideoAsync(BridgeRequest req)
    {
        var p = req.Payload;
        try
        {
            switch (req.Type)
            {
                case "video.status":
                    return new { folders = Videos.Folders(), count = Videos.Count(), series = Videos.Series().Select(SeriesForPage), resume = Videos.ContinueWatching().Select(VideoForPage), playlists = Videos.Playlists(), scanning = _videoScan is { IsCompleted: false } };
                case "video.query":
                    return Videos.Query(new VideoQuery(req.GetString("search", 200), req.GetString("filter", 20) ?? "all", req.GetString("series", 2000),
                        NoorMD.Core.Bridge.Json.OptLong(p, "playlistId"), req.GetString("sort", 20) ?? "series", NoorMD.Core.Bridge.Json.IsTrue(p, "desc"))).Select(VideoForPage);
                case "video.playlists":
                    return Videos.Playlists();
                case "video.playlist.create":
                    return new { id = Videos.CreatePlaylist(req.GetString("name", 300) ?? "", Ids(p, "ids")), playlists = Videos.Playlists() };
                case "video.playlist.rename":
                    Videos.RenamePlaylist(Long(p, "id"), req.GetString("name", 300) ?? "");
                    return Videos.Playlists();
                case "video.playlist.delete":
                    Videos.DeletePlaylist(Long(p, "id"));
                    return Videos.Playlists();
                case "video.playlist.items": return Videos.PlaylistItems(Long(p, "id"));
                case "video.playlist.setItems":
                    Videos.SetPlaylistItems(Long(p, "id"), Ids(p, "ids"));
                    return Videos.Playlists();
                case "video.playlist.add":
                    Videos.AddToPlaylist(Long(p, "id"), Ids(p, "ids"));
                    return Videos.Playlists();
                case "video.addFolder":
                {
                    var dlg = new OpenFolderDialog { Title = "Add a video folder (subfolders included)", Multiselect = false };
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    var id = Videos.AddFolder(dlg.FolderName);
                    await ScanVideosAsync([id]);
                    return new { folderId = id };
                }
                case "video.removeFolder":
                    Videos.RemoveFolder(Long(p, "id"));
                    return null;
                case "video.rescan":
                    await ScanVideosAsync(Videos.Folders().Select(f => f.Id).ToList());
                    return null;
                case "video.episodes":
                    return Videos.Episodes(req.GetString("key", 2000) ?? "").Select(VideoForPage);
                case "video.search":
                    return Videos.Search(req.GetString("text", 200) ?? "").Select(VideoForPage);
                case "video.get":
                {
                    var v = Videos.Get(Long(p, "id")) ?? throw new BridgeError("That video is no longer in the library.");
                    return VideoDetail(v);
                }
                case "video.position":
                    return Videos.SetPosition(Long(p, "id"), NoorMD.Core.Bridge.Json.OptDouble(p, "position") ?? double.NaN, NoorMD.Core.Bridge.Json.OptDouble(p, "duration") ?? 0) is { } row ? VideoForPage(row) : null;
                case "video.watched":
                    Videos.SetWatched(Ids(p, "ids"), NoorMD.Core.Bridge.Json.IsTrue(p, "value"));
                    return null;
                case "video.next":
                    return Videos.NextEpisode(Long(p, "id")) is { } next ? VideoForPage(next) : null;
                case "video.note.add":
                    return new { id = Videos.AddNote(Long(p, "id"), NoorMD.Core.Bridge.Json.OptDouble(p, "time") ?? double.NaN, req.GetString("text", 20_000) ?? ""), notes = Videos.Notes(Long(p, "id")).Select(NoteForPage) };
                case "video.note.update":
                    Videos.UpdateNote(Long(p, "noteId"), req.GetString("text", 20_000) ?? "", NoorMD.Core.Bridge.Json.OptDouble(p, "time"));
                    return Videos.Notes(Long(p, "id")).Select(NoteForPage);
                case "video.note.delete":
                    Videos.DeleteNote(Long(p, "noteId"));
                    return Videos.Notes(Long(p, "id")).Select(NoteForPage);
                case "video.note.insert":
                {
                    var s = ActiveSession ?? throw new BridgeError("Open a document to insert the notes into.");
                    var md = Videos.NotesMarkdown(Long(p, "id"));
                    PushEvent("insert.text", new { tabId = s.TabId, markdown = md });
                    return new { document = s.FileName };
                }
                case "video.reveal":
                {
                    var v = Videos.Get(Long(p, "id")) ?? throw new BridgeError("Unknown video.");
                    if (!File.Exists(v.Path)) throw new BridgeError($"\"{v.FileName}\" is missing on disk.");
                    Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{v.Path}\"") { UseShellExecute = false });
                    return null;
                }
                case "video.popout":
                {
                    var v = Videos.Get(Long(p, "id")) ?? throw new BridgeError("Unknown video.");
                    var time = NoorMD.Core.Bridge.Json.OptDouble(p, "time") ?? v.Position;
                    if (_videoWindow == null) { _videoWindow = new VideoWindow(this); _videoWindow.Show(); }
                    _videoWindow.Play(v.Id, time, NoorMD.Core.Bridge.Json.IsTrue(p, "paused"), !p.TryGetProperty("pauseOnNote", out var pn) || pn.ValueKind != JsonValueKind.False);
                    _videoWindow.Activate();
                    return null;
                }
                case "video.popout.close":
                    _videoWindow?.Close();
                    return null;
                case "video.session.get": return Videos.GetState("session");
                case "video.session.save":
                {
                    var json = req.GetString("json", 200_000) ?? "{}";
                    using var _ = JsonDocument.Parse(json);
                    Videos.SetState("session", json);
                    return null;
                }
                default:
                    throw new BridgeError($"Unknown command \"{req.Type}\".");
            }
        }
        catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
    }

    private readonly SemaphoreSlim _videoScanGate = new(1, 1);

    private async Task ScanVideosAsync(IReadOnlyList<long> folderIds)
    {
        await _videoScanGate.WaitAsync(); // one scan at a time: two at once would both add the same new files
        try
        {
            _videoScan = Task.Run(() =>
            {
                var found = 0; var added = 0; var missing = 0;
                foreach (var id in folderIds)
                {
                    try { var r = Videos.Scan(id); found += r.Found; added += r.Added; missing += r.Missing; }
                    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or Microsoft.Data.Sqlite.SqliteException) { Log.Error("Video scan failed", ex); }
                }
                Dispatcher.BeginInvoke(() => PushEvent("video.scanned", new { found, added, missing }));
            });
            await _videoScan;
        }
        finally { _videoScanGate.Release(); }
    }

    internal void VideoWindowClosed(long? id, double time)
    {
        _videoWindow = null;
        if (id is long v) PushEvent("video.popin", new { id = v, time });
    }

    internal object? VideoRequestFromWindow(string type, JsonElement p) => type switch
    {
        "video.position" => Videos.SetPosition(Long(p, "id"), NoorMD.Core.Bridge.Json.OptDouble(p, "position") ?? double.NaN, NoorMD.Core.Bridge.Json.OptDouble(p, "duration") ?? 0) is { } r ? VideoForPage(r) : null,
        "video.get" => Videos.Get(Long(p, "id")) is { } v ? VideoDetail(v) : throw new BridgeError("That video is no longer in the library."),
        "video.next" => Videos.NextEpisode(Long(p, "id")) is { } n ? VideoForPage(n) : null,
        "video.note.add" => new { id = Videos.AddNote(Long(p, "id"), NoorMD.Core.Bridge.Json.OptDouble(p, "time") ?? double.NaN, NoorMD.Core.Bridge.Json.OptString(p, "text", 20_000) ?? ""), notes = Videos.Notes(Long(p, "id")).Select(NoteForPage) },
        _ => throw new BridgeError($"Unknown command \"{type}\"."),
    };

    internal void VideoNotesChanged(long id) => PushEvent("video.notes", new { id });

    private static object SeriesForPage(VideoSeries s) => new { key = s.Key, name = s.Name, folder = s.Folder, count = s.Count, watched = s.Watched, lastWatched = s.LastWatchedUtc, resumeId = s.ResumeId };

    private static object VideoForPage(VideoRow v) => new
    {
        id = v.Id, title = v.Title, series = v.Series, seriesKey = v.SeriesKey, season = v.Season, episode = v.Episode, duration = v.Duration,
        width = v.Width, height = v.Height, position = v.Position, watched = v.Watched, lastWatched = v.LastWatchedUtc, missing = v.Missing,
        notes = v.NoteCount, fileName = v.FileName, folder = v.Folder,
    };

    private object VideoDetail(VideoRow v) => new
    {
        video = VideoForPage(v),
        subtitles = SubtitleConverter.Find(v.Path).Select((s, i) => new { index = i, label = s.Label, lang = LangOf(s.Label) }),
        notes = Videos.Notes(v.Id).Select(NoteForPage),
        next = Videos.NextEpisode(v.Id) is { } n ? VideoForPage(n) : null,
        exists = File.Exists(v.Path),
    };

    private static string LangOf(string label)
    {
        var first = label.Split(' ', '.', '(')[0].ToLowerInvariant();
        return first.Length is 2 or 3 && first.All(char.IsAsciiLetter) ? first : "und";
    }

    private static object NoteForPage(VideoNote n) => new { id = n.Id, time = n.Time, text = n.Text, stamp = VideoLibrary.Stamp(n.Time) };
}
