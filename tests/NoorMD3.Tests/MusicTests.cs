using Music.Core;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Music.Bench;
using Noor.Contracts;
using Xunit;

namespace NoorMD3.Tests;

public sealed class MusicTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "noormd3-music-" + Guid.NewGuid().ToString("N"));
    public MusicTests() => Directory.CreateDirectory(_dir);
    public void Dispose() { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); try { Directory.Delete(_dir, true); } catch (IOException) { } }

    sealed class Host(string data) : IBenchHost
    {
        public readonly Queue<string?> Folders = new();
        public readonly List<string> Posted = [];
        public void Post(string name, object? payload = null) { lock (Posted) Posted.Add(name); }
        public string DataFolder { get { Directory.CreateDirectory(data); return data; } }
        public void Log(string message) { }
        public Task<string?> PickFolderAsync(string title) => Task.FromResult(Folders.Count > 0 ? Folders.Dequeue() : null);
        public readonly Queue<string?> SaveAs = new();
        public readonly Queue<string> Open = new();
        public Task<string?> PickSaveFileAsync(string title, string suggestedName, IReadOnlyList<FileFilter> filters) => Task.FromResult(SaveAs.Count > 0 ? SaveAs.Dequeue() : null);
        public Task<IReadOnlyList<string>> PickFilesAsync(string title, IReadOnlyList<FileFilter> filters, bool multiple = false) =>
            Task.FromResult<IReadOnlyList<string>>(Open.Count > 0 ? [Open.Dequeue()] : []);
    }

    static JsonElement J(object o) => JsonSerializer.SerializeToElement(o);

    /// <summary>A short, real WAV file (silence; 8 kHz mono, 16-bit).</summary>
    static void Wav(string path, double seconds)
    {
        int rate = 8000, n = (int)(rate * seconds);
        using var w = new BinaryWriter(File.Create(path));
        w.Write(Encoding.ASCII.GetBytes("RIFF")); w.Write(36 + n * 2); w.Write(Encoding.ASCII.GetBytes("WAVEfmt "));
        w.Write(16); w.Write((short)1); w.Write((short)1); w.Write(rate); w.Write(rate * 2); w.Write((short)2); w.Write((short)16);
        w.Write(Encoding.ASCII.GetBytes("data")); w.Write(n * 2);
        for (int i = 0; i < n; i++) w.Write((short)0);
    }

    async Task<(MusicBench Bench, Host Host)> Library()
    {
        var music = Path.Combine(_dir, "Music", "Ada");
        Directory.CreateDirectory(music);
        Wav(Path.Combine(music, "Engines.wav"), 1.5);
        Wav(Path.Combine(music, "Poetry.wav"), 2);
        Wav(Path.Combine(_dir, "Music", "Waltz.wav"), 1);
        File.WriteAllText(Path.Combine(_dir, "Music", "notes.txt"), "not music");
        var host = new Host(Path.Combine(_dir, "data"));
        var bench = new MusicBench();
        host.Folders.Enqueue(Path.Combine(_dir, "Music"));
        var added = await bench.HandleAsync("music.addFolder", J(new { }), host, default);
        Assert.NotNull(added);
        for (int i = 0; i < 200; i++)
        {
            var s = await bench.HandleAsync("music.status", J(new { }), host, default);
            if (!(bool)s!["scanning"]! && (int)s["stats"]!["total"]! == 3) break;
            await Task.Delay(50);
        }
        return (bench, host);
    }

    [Fact]
    public async Task A_folder_becomes_a_library_to_search_sort_and_mark()
    {
        var (bench, host) = await Library();
        var status = await bench.HandleAsync("music.status", J(new { }), host, default);
        Assert.Equal(3, (int)status!["stats"]!["total"]!);
        Assert.Single(status["folders"]!.AsArray());
        Assert.Contains("changed", host.Posted);

        var all = await bench.HandleAsync("music.query", J(new { sort = "title", offset = 0, limit = 50 }), host, default);
        Assert.Equal(["Engines", "Poetry", "Waltz"], all!["rows"]!.AsArray().Select(r => (string)r!["displayTitle"]!));
        Assert.True((double)all["rows"]![0]!["duration"]! > 1.4);
        var found = await bench.HandleAsync("music.query", J(new { search = "poet", offset = 0, limit = 50 }), host, default);
        Assert.Equal("Poetry", (string)found!["rows"]![0]!["displayTitle"]!);

        var id = (long)all["rows"]![1]!["id"]!;
        var stats = await bench.HandleAsync("music.setTriage", J(new { ids = new[] { id }, value = 1 }), host, default);
        Assert.Equal(1, (int)stats!["favorite"]!);
        var favs = await bench.HandleAsync("music.query", J(new { triage = 1, offset = 0, limit = 50 }), host, default);
        Assert.Equal(id, (long)favs!["rows"]![0]!["id"]!);
        var ids = await bench.HandleAsync("music.ids", J(new { sort = "duration", desc = true }), host, default);
        Assert.Equal(id, (long)ids!.AsArray()[0]!);   // the longest first
    }

    [Fact]
    public async Task Broken_files_dont_stop_the_scan_and_are_reported()
    {
        // Junk in every shape a music folder can hold: whatever any one of them throws, the rest are still found.
        var music = Path.Combine(_dir, "Mixed");
        Directory.CreateDirectory(Path.Combine(music, "deep", "deeper"));
        var rnd = new Random(7);
        byte[] Junk(int n) { var b = new byte[n]; rnd.NextBytes(b); return b; }
        File.WriteAllBytes(Path.Combine(music, "a-empty.mp3"), []);
        File.WriteAllBytes(Path.Combine(music, "b-noise.flac"), Junk(5000));
        File.WriteAllBytes(Path.Combine(music, "c-fake.ogg"), Encoding.ASCII.GetBytes("OggS").Concat(Junk(300)).ToArray());
        File.WriteAllBytes(Path.Combine(music, "d-id3only.mp3"), Encoding.ASCII.GetBytes("ID3\u0004\0\0\u007f\u007f\u007f\u007f").Concat(Junk(40)).ToArray());
        File.WriteAllBytes(Path.Combine(music, "e-cut.m4a"), [0, 0, 0, 0x20, (byte)'f', (byte)'t', (byte)'y', (byte)'p', (byte)'M', (byte)'4', (byte)'A']);
        var head = new byte[44]; Encoding.ASCII.GetBytes("RIFF").CopyTo(head, 0); Encoding.ASCII.GetBytes("WAVE").CopyTo(head, 8);
        File.WriteAllBytes(Path.Combine(music, "f-header.wav"), head);
        for (int i = 0; i < 30; i++) Wav(Path.Combine(music, i % 3 == 0 ? "deep" : i % 3 == 1 ? Path.Combine("deep", "deeper") : "", $"Good {i:00}.wav"), 0.2);

        var host = new Host(Path.Combine(_dir, "data"));
        var bench = new MusicBench();
        host.Folders.Enqueue(music);
        await bench.HandleAsync("music.addFolder", J(new { }), host, default);
        JsonNode? s = null;
        for (int i = 0; i < 300; i++)
        {
            s = await bench.HandleAsync("music.status", J(new { }), host, default);
            if (!(bool)s!["scanning"]! && s["lastScan"] is not null) break;
            await Task.Delay(50);
        }
        Assert.Equal("done", (string)s!["lastScan"]!["phase"]!);
        var found = await bench.HandleAsync("music.query", J(new { search = "Good", offset = 0, limit = 100 }), host, default);
        Assert.Equal(30, (int)found!["total"]!);   // every good file, however deep, wherever the junk sorts
        var total = (int)s["stats"]!["total"]!;
        var errors = (int)s["lastScan"]!["errors"]!;
        Assert.Equal(36, total + errors);          // each junk file is either indexed (tagless) or counted as unreadable
        if (errors > 0) Assert.False(string.IsNullOrEmpty((string?)s["lastScan"]!["message"]));
        Assert.Contains("scan", host.Posted);
    }

    [Fact]
    public async Task Tags_names_batches_smart_collections_and_playlist_files()
    {
        var (bench, host) = await Library();
        async Task<JsonNode?> H(string cmd, object args) => await bench.HandleAsync(cmd, J(args), host, default);
        var rows = (await H("music.query", new { sort = "title", offset = 0, limit = 50 }))!["rows"]!.AsArray();
        var waltz = (long)rows.First(r => (string)r!["displayTitle"]! == "Waltz")!["id"]!;

        // Edit: new tags and a new name, then undo it all.
        Assert.Empty((await H("music.edit.validate", new { id = waltz, fileName = "Blue Danube.wav" }))!.AsArray());
        Assert.NotEmpty((await H("music.edit.validate", new { id = waltz, fileName = "Engines.wav/../x.wav" }))!.AsArray());
        var ed = await H("music.edit.apply", new { id = waltz, updateTags = true, tags = new { title = "The Blue Danube", artist = "Strauss" }, rename = true, fileName = "Blue Danube.wav" });
        Assert.True((bool)ed!["ok"]!, ed.ToJsonString());
        Assert.True(File.Exists(Path.Combine(_dir, "Music", "Blue Danube.wav")) && !File.Exists(Path.Combine(_dir, "Music", "Waltz.wav")));
        var t = await H("music.track", new { id = waltz });
        Assert.Equal("The Blue Danube", (string)t!["tags"]!["title"]!);
        Assert.Equal("Strauss", (string)t["tags"]!["artist"]!);
        var st = await H("music.status", new { });
        Assert.Equal("Blue Danube.wav", (string)st!["undo"]!["newName"]!);
        var un = await H("music.undo", new { });
        Assert.True((bool)un!["ok"]!, un.ToJsonString());
        Assert.True(File.Exists(Path.Combine(_dir, "Music", "Waltz.wav")));
        Assert.Null((string?)(await H("music.track", new { id = waltz }))!["tags"]!["artist"]);
        await Assert.ThrowsAsync<BenchException>(() => H("music.undo", new { }));   // nothing left to undo

        // Batch: preview, apply (prefix + an artist for all), undo.
        var all = rows.Select(r => (long)r!["id"]!).ToArray();
        var spec = new { tags = new { artist = new { mode = "set", value = "Ada" } }, rename = new { enabled = true, template = "{OriginalName}", prefix = "x " } };
        var pv = await H("music.batch.preview", new { ids = all, spec });
        Assert.Equal(3, (int)pv!["willChange"]!);
        Assert.Contains(pv["items"]!.AsArray(), i => ((string)i!["newName"]!).StartsWith("x "));
        var ap = await H("music.batch.apply", new { ids = all, spec });
        Assert.Equal(3, (int)ap!["done"]!);
        Assert.True(File.Exists(Path.Combine(_dir, "Music", "x Waltz.wav")));
        var bu = await H("music.batch.undo", new { batchId = (long)ap["batchId"]! });
        Assert.Equal(3, (int)bu!["done"]!);
        Assert.True(File.Exists(Path.Combine(_dir, "Music", "Waltz.wav")) && File.Exists(Path.Combine(_dir, "Music", "Ada", "Poetry.wav")));

        // Smart collections: count, save, query by them, delete.
        var rules = new { matchAll = true, rules = new object[] { new { field = "duration", op = "gt", value = 1.2 } } };
        Assert.Equal(2, (int)(await H("music.smart.count", new { rules }))!);
        var saved = await H("music.smart.save", new { name = "Longer ones", rules });
        var sid = (long)saved!["id"]!;
        Assert.Equal(2, (int)saved["smart"]![0]!["count"]!);
        Assert.Equal(2, (int)(await H("music.query", new { smartId = sid, offset = 0, limit = 50 }))!["total"]!);
        await Assert.ThrowsAsync<BenchException>(() => H("music.smart.save", new { name = "", rules }));
        Assert.Empty((await H("music.smart.delete", new { id = sid }))!.AsArray());

        // Playlists out to .m3u8 and back in; cover art: none here, said plainly.
        var pl = (long)(await H("music.playlist.create", new { name = "Mix", ids = all }))!["id"]!;
        var m3u = Path.Combine(_dir, "mix.m3u8");
        host.SaveAs.Enqueue(m3u);
        Assert.Equal(3, (int)(await H("music.playlist.export", new { id = pl }))!["count"]!);
        Assert.Contains("Waltz.wav", File.ReadAllText(m3u));
        host.Open.Enqueue(m3u);
        var im = await H("music.playlist.import", new { });
        Assert.Equal(3, (int)im!["added"]!);
        Assert.Equal(0, (int)im["missing"]!);
        Assert.True((bool)(await H("music.playlist.import", new { }))!["cancelled"]!);   // the dialog was closed
        await Assert.ThrowsAsync<BenchException>(() => H("music.art.save", new { id = waltz }));
    }

    [Fact]
    public async Task Several_artists_survive_an_edit_and_its_undo()
    {
        var (bench, host) = await Library();
        async Task<JsonNode?> H(string cmd, object args) => await bench.HandleAsync(cmd, J(args), host, default);
        var rows = (await H("music.query", new { sort = "title", offset = 0, limit = 50 }))!["rows"]!.AsArray();
        var id = (long)rows.First(r => (string)r!["displayTitle"]! == "Engines")!["id"]!;
        var file = Path.Combine(_dir, "Music", "Ada", "Engines.wav");
        TagIO.Write(file, new TagEdit { Artist = "Ada Lovelace; Charles Babbage", Genre = "Ambient; Industrial" });
        var read = TagIO.Read(file);
        Assert.Equal("Ada Lovelace; Charles Babbage", read.Artist);   // both, not just the first
        Assert.Equal("Ambient; Industrial", read.Genre);

        var ed = await H("music.edit.apply", new { id, updateTags = true, tags = new { artist = "Somebody Else" } });
        Assert.True((bool)ed!["ok"]!, ed.ToJsonString());
        Assert.Equal("Somebody Else", TagIO.Read(file).Artist);
        var un = await H("music.undo", new { });
        Assert.True((bool)un!["ok"]!, un.ToJsonString());
        Assert.Equal("Ada Lovelace; Charles Babbage", TagIO.Read(file).Artist);   // the undo puts back both
        Assert.Equal("Ambient; Industrial", TagIO.Read(file).Genre);
    }

    [Fact]
    public async Task Playlists_the_session_and_loudness_are_kept()
    {
        var (bench, host) = await Library();
        var ids = (await bench.HandleAsync("music.ids", J(new { sort = "title" }), host, default))!.AsArray().Select(x => (long)x!).ToList();
        var pl = await bench.HandleAsync("music.playlist.create", J(new { name = "Evening", ids = new[] { ids[2], ids[0] } }), host, default);
        var plId = (long)pl!["id"]!;
        await bench.HandleAsync("music.playlist.add", J(new { id = plId, ids = new[] { ids[1] } }), host, default);
        var inOrder = await bench.HandleAsync("music.ids", J(new { playlistId = plId, sort = "playlist" }), host, default);
        Assert.Equal([ids[2], ids[0], ids[1]], inOrder!.AsArray().Select(x => (long)x!));
        await bench.HandleAsync("music.playlist.rename", J(new { id = plId, name = "Late evening" }), host, default);
        Assert.Equal("Late evening", (string)(await bench.HandleAsync("music.playlists", J(new { }), host, default))!.AsArray()[0]!["name"]!);
        await Assert.ThrowsAsync<BenchException>(() => bench.HandleAsync("music.playlist.rename", J(new { id = plId, name = " " }), host, default));

        await bench.HandleAsync("music.session.save", J(new { session = new { v = 1, ids, order = new[] { 0, 1, 2 }, pos = 1, volume = 0.5 } }), host, default);
        var session = await bench.HandleAsync("music.session.get", J(new { }), host, default);
        Assert.Equal(1, (int)session!["pos"]!);
        Assert.Equal(0.5, (double)session["volume"]!);

        Assert.Equal(3, (await bench.HandleAsync("music.loudness.unmeasured", J(new { }), host, default))!.AsArray().Count);
        await bench.HandleAsync("music.loudness.set", J(new { id = ids[0], lufs = -12.5, peak = 0.9 }), host, default);
        Assert.Equal(2, (await bench.HandleAsync("music.loudness.unmeasured", J(new { }), host, default))!.AsArray().Count);
        var row = (await bench.HandleAsync("music.tracks", J(new { ids = new[] { ids[0] } }), host, default))!.AsArray()[0]!;
        Assert.Equal(-12.5, (double)row["loudness"]!);
    }

    [Fact]
    public async Task The_player_gets_the_audio_with_ranges_and_nothing_else()
    {
        var (bench, host) = await Library();
        var id = (long)(await bench.HandleAsync("music.ids", J(new { sort = "title" }), host, default))!.AsArray()[0]!;
        var whole = bench.ServeMedia($"track/{id}", null)!;
        Assert.Equal(200, whole.Status);
        Assert.Contains("Content-Type: audio/", whole.Headers);
        Assert.Contains("Accept-Ranges: bytes", whole.Headers);
        var part = bench.ServeMedia($"track/{id}", "bytes=0-99")!;
        Assert.Equal(206, part.Status);
        Assert.Equal(100, ((MemoryStream)part.Body!).Length);
        Assert.Contains("Content-Range: bytes 0-99/", part.Headers);
        Assert.Null(bench.ServeMedia("track/999999", null));          // not in the library
        Assert.Null(bench.ServeMedia("track/../../secret", null));    // never a path
        Assert.Null(bench.ServeMedia($"art/{id}", null));             // no artwork: nothing
    }

    [Fact]
    public async Task Review_fixes_in_the_music_core()
    {
        // A Range header that makes no sense means "the whole file" (not an error).
        Assert.Null(Music.Core.RangeRequest.Parse("bytes=abc", 100));
        Assert.Null(Music.Core.RangeRequest.Parse("bytes=5-2", 100));
        Assert.Equal((90L, 99L), Music.Core.RangeRequest.Parse("bytes=-10", 100));
        Assert.Equal((-1L, -1L), Music.Core.RangeRequest.Parse("bytes=200-", 100));
        // Tidying names: only separators left side by side by empty placeholders.
        Assert.Equal("...And Justice for All", Music.Core.BatchOrganizer.Tidy("...And Justice for All"));
        Assert.Equal("Live at Wembley... 1986", Music.Core.BatchOrganizer.Tidy("Live at Wembley... 1986"));
        Assert.Equal("Artist - Title", Music.Core.BatchOrganizer.Tidy("Artist -  - Title"));
        Assert.Equal("Title", Music.Core.BatchOrganizer.Tidy(" - Title"));
        // A playlist entry starting with # isn't read back as a comment; plain paths aren't URL-decoded.
        var dir = Path.Combine(_dir, "pl"); Directory.CreateDirectory(dir);
        var hit = Path.Combine(dir, "#1 Hit.wav"); Wav(hit, 0.2);
        var m3u = Path.Combine(dir, "list.m3u8");
        Music.Core.M3u.Write(m3u, [new Music.Core.M3u.Entry(hit, 0.2, "Hit")]);
        Assert.Equal([Path.GetFullPath(hit)], Music.Core.M3u.Read(m3u));
        File.WriteAllText(m3u, Path.Combine(dir, "100% a%20b.wav") + "\n");
        Assert.Equal([Path.Combine(dir, "100% a%20b.wav")], Music.Core.M3u.Read(m3u));

        // Removing a folder inside another library folder: its tracks stay (with their marks).
        var (bench, host) = await Library();
        var sub = (await bench.HandleAsync("music.status", J(new { }), host, default))!["folders"]![0]!["path"]!.ToString();
        host.Folders.Enqueue(Path.Combine(sub, "Ada"));
        var inner = (long)(await bench.HandleAsync("music.addFolder", J(new { }), host, default))!["folderId"]!;
        for (int i = 0; i < 100 && (bool)(await bench.HandleAsync("music.status", J(new { }), host, default))!["scanning"]!; i++) await Task.Delay(50);
        var ada = (await bench.HandleAsync("music.ids", J(new { search = "engines" }), host, default))!.AsArray().Select(x => (long)x!).Single();
        await bench.HandleAsync("music.setTriage", J(new { ids = new[] { ada }, value = 1 }), host, default);
        var after = await bench.HandleAsync("music.removeFolder", J(new { id = inner }), host, default);
        Assert.Equal(3, (int)after!["stats"]!["total"]!);
        Assert.Equal(1, (int)after["stats"]!["favorite"]!);
    }
}
