using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Media;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// Radio Bench: your internet radio stations. The page plays a station through a small relay on the loopback address
/// (<see cref="RadioRelay"/>), which also reads the song titles from the stream. Nothing is recorded or downloaded, and
/// the online directory (Radio Browser) is asked only when you search it.
/// </summary>
public partial class MainWindow
{
    private RadioLibrary? _radioLib;
    private RadioRelay? _radioRelay;
    private static readonly Lazy<HttpClient> RadioHttp = new(() =>
    {
        var h = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = true, MaxAutomaticRedirections = 5, ConnectTimeout = TimeSpan.FromSeconds(10) }) { Timeout = TimeSpan.FromSeconds(15) };
        h.DefaultRequestHeaders.UserAgent.ParseAdd("NoorMD/2.0");
        return h;
    });

    private RadioLibrary Radio => _radioLib ??= new RadioLibrary(Path.Combine(App.Paths.Local, "Radio", "stations.db"));

    private RadioRelay Relay
    {
        get
        {
            if (_radioRelay != null) return _radioRelay;
            _radioRelay = new RadioRelay();
            _radioRelay.Title += (token, title) => Dispatcher.BeginInvoke(() => PushEvent("radio.title", new { token, title }));
            _radioRelay.Failed += (token, message) => Dispatcher.BeginInvoke(() => PushEvent("radio.failed", new { token, message }));
            return _radioRelay;
        }
    }

    private static object StationForPage(RadioStation s) => new
    {
        id = s.Id, name = s.Name, url = s.Url, homepage = s.Homepage, tags = s.Tags, favorite = s.Favorite, added = s.AddedUtc, lastPlayed = s.LastPlayedUtc, plays = s.Plays,
    };

    private object RadioStations() => Radio.All().Select(StationForPage).ToList();

    private static List<string> TagList(JsonElement p) =>
        p.TryGetProperty("tags", out var t) && t.ValueKind == JsonValueKind.Array ? t.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).Take(20).ToList() : [];

    /// <summary>A .pls/.m3u address points to the stream: read it (small, http/https only) and take its first station.</summary>
    private static async Task<(string Url, string? Name)> ResolveStationAsync(string url)
    {
        var clean = RadioUrl.Clean(url);
        if (!RadioUrl.LooksLikePlaylist(clean)) return (clean, null);
        string text;
        try
        {
            using var resp = await RadioHttp.Value.GetAsync(clean, HttpCompletionOption.ResponseHeadersRead);
            resp.EnsureSuccessStatusCode();
            var type = resp.Content.Headers.ContentType?.MediaType ?? "";
            if (type.StartsWith("audio/", StringComparison.OrdinalIgnoreCase) && !type.Contains("mpegurl", StringComparison.OrdinalIgnoreCase) && !type.Contains("scpls", StringComparison.OrdinalIgnoreCase))
                return (clean, null); // named like a list, but it is the stream itself
            await using var s = await resp.Content.ReadAsStreamAsync();
            var buf = new byte[64 * 1024];
            var len = 0;
            int n;
            while (len < buf.Length && (n = await s.ReadAsync(buf.AsMemory(len))) > 0) len += n;
            text = Encoding.UTF8.GetString(buf, 0, len);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new BridgeError("The station's playlist can't be read: " + ex.Message);
        }
        if (RadioPlaylist.IsHls(text)) return (clean, null); // HLS: the playlist is the station (NoorMD follows its pieces)
        var first = RadioPlaylist.Parse(text).FirstOrDefault();
        if (first.Url == null) throw new BridgeError("No stream address was found in that playlist.");
        return (first.Url, first.Name);
    }

    private async Task<object?> DispatchRadioAsync(BridgeRequest req)
    {
        var p = req.Payload;
        try
        {
            switch (req.Type)
            {
                case "radio.list": return new { stations = RadioStations() };
                case "radio.add":
                {
                    var (url, listName) = await ResolveStationAsync(req.GetString("url", 2048) ?? "");
                    var (id, added) = Radio.Add(req.GetString("name", 200) ?? listName, url, req.GetString("homepage", 2048), TagList(p));
                    return new { id, added, stations = RadioStations() };
                }
                case "radio.update":
                    Radio.Update(Long(p, "id"), req.GetString("name", 200), req.GetString("url", 2048) ?? "", req.GetString("homepage", 2048), TagList(p));
                    return new { stations = RadioStations() };
                case "radio.delete":
                    Radio.Delete(Long(p, "id"));
                    return new { stations = RadioStations() };
                case "radio.favorite":
                    Radio.SetFavorite(Long(p, "id"), NoorMD.Core.Bridge.Json.IsTrue(p, "on"));
                    return new { stations = RadioStations() };
                case "radio.play":
                {
                    // A saved station by id, or one tried from the directory by its address.
                    var id = NoorMD.Core.Bridge.Json.OptLong(p, "id");
                    var station = id is { } sid ? Radio.Get(sid) ?? throw new BridgeError("That station is gone.") : null;
                    var (url, _) = await ResolveStationAsync(station?.Url ?? req.GetString("url", 2048) ?? "");
                    var (token, local) = Relay.Open(url);
                    if (station != null) Radio.MarkPlayed(station.Id);
                    Log.Info($"Radio: playing {(station?.Name ?? "a station from the directory")}");
                    return new { token, url = local };
                }
                case "radio.stop":
                    _radioRelay?.CloseAll();
                    return null;
                case "radio.import":
                {
                    var dlg = new OpenFileDialog { Title = "Import radio stations", Filter = "Station lists (*.m3u;*.m3u8;*.pls)|*.m3u;*.m3u8;*.pls|All files (*.*)|*.*", CheckFileExists = true };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    if (new FileInfo(dlg.FileName).Length > 2 * 1024 * 1024) throw new BridgeError("That file is too big for a list of stations.");
                    var (added, known) = Radio.Import(await File.ReadAllTextAsync(dlg.FileName));
                    return new { added, known, stations = RadioStations() };
                }
                case "radio.export":
                {
                    var all = Radio.All();
                    if (all.Count == 0) throw new BridgeError("There are no stations to export yet.");
                    var dlg = new SaveFileDialog { Title = "Export radio stations", Filter = "M3U8 playlist (*.m3u8)|*.m3u8", DefaultExt = ".m3u8", FileName = "Radio stations.m3u8", OverwritePrompt = true };
                    NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    await File.WriteAllTextAsync(dlg.FileName, RadioPlaylist.ToM3u(all), new UTF8Encoding(false));
                    return new { path = dlg.FileName, count = all.Count };
                }
                case "radio.search":
                {
                    var found = await RadioDirectory.SearchAsync(RadioHttp.Value, req.GetString("query", 200) ?? "");
                    var saved = Radio.All().Select(s => s.Url.ToLowerInvariant()).ToHashSet();
                    return found.Select(s => new { name = s.Name, url = s.Url, homepage = s.Homepage, tags = s.Tags, country = s.Country, codec = s.Codec, bitrate = s.Bitrate, hls = s.Hls, saved = saved.Contains(s.Url.ToLowerInvariant()) });
                }
                default: throw new BridgeError($"Unknown command \"{req.Type}\".");
            }
        }
        catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
        catch (InvalidOperationException ex) { throw new BridgeError(ex.Message); }
    }
}
