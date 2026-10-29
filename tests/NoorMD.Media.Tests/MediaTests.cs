using System.Diagnostics;
using System.Text;
using System.Text.Json;
using NoorMD.Media;
using Xunit;
using Xunit.Abstractions;

namespace NoorMD.Media.Tests;

public sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "noormd-media-" + Guid.NewGuid().ToString("N"));
    public TempDir() => Directory.CreateDirectory(Path);
    public string P(params string[] parts) => System.IO.Path.Combine([Path, .. parts]);
    public string Copy(string fixture, params string[] target)
    {
        var dest = P(target);
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(dest)!);
        File.Copy(System.IO.Path.Combine(AppContext.BaseDirectory, "Fixtures", fixture), dest);
        return dest;
    }
    public void Dispose()
    {
        try
        {
            foreach (var f in Directory.EnumerateFiles(Path, "*", SearchOption.AllDirectories)) File.SetAttributes(f, FileAttributes.Normal);
            Directory.Delete(Path, true);
        }
        catch { }
    }
}

/// <summary>Independent tag reader (ffprobe) for verification, when installed.</summary>
internal static class FfProbe
{
    public static string? Tag(string file, string tag)
    {
        try
        {
            var psi = new ProcessStartInfo("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file]) { RedirectStandardOutput = true, UseShellExecute = false };
            using var p = Process.Start(psi)!;
            var json = p.StandardOutput.ReadToEnd();
            p.WaitForExit(10_000);
            using var doc = JsonDocument.Parse(json);
            // Container tags (ID3, FLAC) are under "format"; Ogg Vorbis comments are per stream.
            var holders = new List<JsonElement> { doc.RootElement.GetProperty("format") };
            if (doc.RootElement.TryGetProperty("streams", out var streams)) holders.AddRange(streams.EnumerateArray());
            foreach (var h in holders)
                if (h.TryGetProperty("tags", out var tags))
                    foreach (var t in tags.EnumerateObject()) if (string.Equals(t.Name, tag, StringComparison.OrdinalIgnoreCase)) return t.Value.GetString();
            return null;
        }
        catch { return "<ffprobe unavailable>"; }
    }
}

public class TagTests
{
    [Fact]
    public void Reads_ExistingTags_And_DoesNotInventMissingOnes()
    {
        using var t = new TempDir();
        var tagged = TagIO.Read(t.Copy("tagged.mp3", "a.mp3"));
        Assert.Equal("Suno Track 0042", tagged.Title);
        Assert.Equal("Suno", tagged.Artist);
        Assert.Equal("Synthwave", tagged.Genre);
        Assert.InRange(tagged.DurationSeconds, 1.5, 2.5);
        var bare = TagIO.Read(t.Copy("tone.mp3", "b.mp3"));
        Assert.Null(bare.Title);
        Assert.Null(bare.Artist);
        Assert.Null(bare.Year);
        Assert.Null(bare.ReadError);
    }

    [Fact]
    public void Malformed_File_Reports_Error_Without_Throwing()
    {
        using var t = new TempDir();
        var tags = TagIO.Read(t.Copy("malformed.mp3", "bad.mp3"));
        Assert.NotNull(tags.ReadError);
        Assert.Null(tags.Title);
    }

    [Theory]
    [InlineData("tone.mp3")]
    [InlineData("tone.flac")]
    [InlineData("tone.ogg")]
    public void Writes_Polish_Title_And_Verifies(string fixture)
    {
        using var t = new TempDir();
        var f = t.Copy(fixture, "Utwór " + fixture);
        var after = TagIO.Write(f, new TagEdit { Title = "Żółta łódź o świcie", Artist = "Noor", Year = 2026 });
        Assert.Equal("Żółta łódź o świcie", after.Title);
        Assert.Equal("Noor", TagIO.Read(f).Artist);
        Assert.Equal(2026u, TagIO.Read(f).Year);
        var external = FfProbe.Tag(f, "title");
        if (external != "<ffprobe unavailable>") Assert.Equal("Żółta łódź o świcie", external);
    }

    [Fact]
    public void Null_Leaves_Unchanged_Empty_Clears()
    {
        using var t = new TempDir();
        var f = t.Copy("tagged.mp3", "x.mp3");
        TagIO.Write(f, new TagEdit { Title = "New" });
        var a = TagIO.Read(f);
        Assert.Equal("New", a.Title);
        Assert.Equal("Suno", a.Artist);       // untouched
        TagIO.Write(f, new TagEdit { Genre = "" });
        Assert.Null(TagIO.Read(f).Genre);      // cleared
        Assert.Equal("New", TagIO.Read(f).Title);
    }

    [Fact]
    public void ReadOnly_File_Is_Not_Modified()
    {
        using var t = new TempDir();
        var f = t.Copy("tone.mp3", "ro.mp3");
        var before = File.ReadAllBytes(f);
        File.SetAttributes(f, FileAttributes.ReadOnly);
        var ex = Assert.Throws<MetadataException>(() => TagIO.Write(f, new TagEdit { Title = "x" }));
        Assert.Contains("read-only", ex.Message);
        Assert.Equal(before, File.ReadAllBytes(f));
    }

    [Fact]
    public void Fingerprint_Is_Stable_For_Copies_And_Changes_With_Content()
    {
        using var t = new TempDir();
        var a = t.Copy("tone.mp3", "a.mp3");
        var b = t.Copy("tone.mp3", "sub", "b.mp3");
        var c = t.Copy("tone.flac", "c.flac");
        Assert.Equal(Fingerprint.Compute(a), Fingerprint.Compute(b));
        Assert.NotEqual(Fingerprint.Compute(a), Fingerprint.Compute(c));
    }

    [Theory]
    [InlineData("Żółw", "zolw")]
    [InlineData("ŁÓDŹ Ćma", "lodz cma")]
    [InlineData("Straße", "strasse")]
    public void Fold_Removes_Case_And_Diacritics(string input, string expected) => Assert.Equal(expected, TextFold.Fold(input));
}

public class RenameTests
{
    [Fact]
    public void Polish_Name_Keeps_Extension_And_Never_Overwrites()
    {
        using var t = new TempDir();
        var a = t.Copy("tone.mp3", "Suno 0001.mp3");
        var b = t.Copy("tagged.mp3", "Taken.mp3");
        var plan = SafeRename.Plan(a, "Żółta łódź");
        Assert.True(plan.Ok);
        Assert.EndsWith("Żółta łódź.mp3", plan.TargetPath);
        var collision = SafeRename.Plan(a, "Taken.mp3");
        Assert.False(collision.Ok);
        Assert.Contains("already exists", collision.Problems[0]);
        var bBefore = File.ReadAllBytes(b);
        var newPath = SafeRename.Execute(plan);
        Assert.True(File.Exists(newPath));
        Assert.False(File.Exists(a));
        Assert.Equal(bBefore, File.ReadAllBytes(b));
    }

    [Theory]
    [InlineData("bad:name")]
    [InlineData("what?")]
    [InlineData("CON")]
    [InlineData("trailing.")]
    [InlineData("   ")]
    public void Rejects_Invalid_Names(string name)
    {
        using var t = new TempDir();
        var a = t.Copy("tone.mp3", "a.mp3");
        Assert.False(SafeRename.Plan(a, name).Ok);
        Assert.True(File.Exists(a));
    }

    [Fact]
    public void Rejects_Too_Long_Names()
    {
        using var t = new TempDir();
        Assert.False(SafeRename.Plan(t.Copy("tone.mp3", "a.mp3"), new string('x', 300)).Ok);
    }

    [Fact]
    public void Case_Only_Rename_Works()
    {
        using var t = new TempDir();
        var a = t.Copy("tone.mp3", "track.mp3");
        var path = SafeRename.Execute(SafeRename.Plan(a, "Track"));
        Assert.Equal("Track.mp3", Path.GetFileName(Directory.GetFiles(t.Path).Single()));
        Assert.EndsWith("Track.mp3", path);
    }

    [Fact]
    public void Rename_Works_While_File_Is_Open_For_Playback()
    {
        using var t = new TempDir();
        var a = t.Copy("tone.mp3", "playing.mp3");
        using var stream = new FileStream(a, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete); // how NoorMD serves audio
        var path = SafeRename.Execute(SafeRename.Plan(a, "renamed while playing"));
        Assert.True(File.Exists(path));
    }

    [Fact]
    public void Suggests_Safe_Names_From_Tags() => Assert.Equal("Noor - Night- Drive", SafeRename.SuggestName("Night: Drive", "Noor"));
}

public class LibraryTests(ITestOutputHelper output)
{
    private static (TempDir dir, MusicLibrary lib, long folder) Setup()
    {
        var t = new TempDir();
        t.Copy("tagged.mp3", "music", "Suno", "tagged.mp3");
        t.Copy("tone.mp3", "music", "Suno", "Suno Track 0001.mp3");
        t.Copy("tone.flac", "music", "Albumy", "Żółw nocą.flac");
        t.Copy("tone.ogg", "music", "Albumy", "Głęboko", "deep.ogg");
        t.Copy("tone.wav", "music", "loop.wav");
        t.Copy("malformed.mp3", "music", "broken.mp3");
        File.WriteAllText(t.P("music", "notes.txt"), "not audio");
        var lib = new MusicLibrary(t.P("db", "library.db"));
        var folder = lib.AddFolder(t.P("music"));
        return (t, lib, folder);
    }

    [Fact]
    public void Scan_Indexes_Recursively_With_Polish_Paths_And_Is_Incremental()
    {
        var (t, lib, folder) = Setup();
        using var _ = t;
        var r = lib.ScanFolder(folder);
        Assert.Equal(6, r.Added);
        Assert.Equal(6, lib.Stats().Total);
        var broken = lib.Query(new LibraryQuery(Search: "broken")).Rows.Single();
        Assert.NotNull(broken.ReadError);
        Assert.Equal("broken", broken.DisplayTitle);
        var again = lib.ScanFolder(folder);
        Assert.Equal((0, 0, 0), (again.Added, again.Updated, again.Relinked));
        Assert.Single(lib.Query(new LibraryQuery(Search: "zolw noca")).Rows);
        Assert.Single(lib.Query(new LibraryQuery(Search: "GŁĘBOKO")).Rows);
    }

    [Fact]
    public void Moved_File_Is_Relinked_Keeping_Id_Triage_And_Playlists()
    {
        var (t, lib, folder) = Setup();
        using var _ = t;
        lib.ScanFolder(folder);
        var track = lib.Query(new LibraryQuery(Search: "Suno Track 0001")).Rows.Single();
        lib.SetTriage([track.Id], Triage.Favorite);
        var pl = lib.CreatePlaylist("Night");
        lib.SetPlaylistItems(pl, [track.Id]);

        Directory.CreateDirectory(t.P("music", "moved"));
        File.Move(track.Path, t.P("music", "moved", "renamed outside.mp3"));
        var r = lib.ScanFolder(folder);
        Assert.Equal(1, r.Relinked);
        var after = lib.Get(track.Id)!;
        Assert.EndsWith("renamed outside.mp3", after.Path);
        Assert.Equal(Triage.Favorite, after.Triage);
        Assert.False(after.Missing);
        Assert.Equal([track.Id], lib.PlaylistTrackIds(pl));
        Assert.Equal(6, lib.Stats().Total);
    }

    [Fact]
    public void Deleted_File_Is_Marked_Missing_Not_Removed_And_Unplugged_Folder_Changes_Nothing()
    {
        var (t, lib, folder) = Setup();
        using var _ = t;
        lib.ScanFolder(folder);
        File.Delete(t.P("music", "loop.wav"));
        var r = lib.ScanFolder(folder);
        Assert.Equal(1, r.MarkedMissing);
        Assert.Equal(6, lib.Stats().Total);
        Assert.Equal(1, lib.Stats().Missing);

        Directory.Move(t.P("music"), t.P("music-unplugged"));
        var u = lib.ScanFolder(folder);
        Assert.Equal("unavailable", u.Phase);
        Assert.Equal(1, lib.Stats().Missing);
    }

    [Fact]
    public void Query_Of_20000_Tracks_Is_Fast()
    {
        using var t = new TempDir();
        var lib = new MusicLibrary(t.P("big.db"));
        lib.InsertSyntheticForTests(20_000);
        lib.Query(new LibraryQuery()); // warm up
        var sw = Stopwatch.StartNew();
        var all = lib.Query(new LibraryQuery(Sort: "title", Offset: 15_000, Limit: 100));
        var search = lib.Query(new LibraryQuery(Search: "zolw", Sort: "duration", Descending: true));
        var triage = lib.Query(new LibraryQuery(Triage: Triage.Maybe, Sort: "folder"));
        sw.Stop();
        output.WriteLine($"3 queries over 20,000 tracks: {sw.ElapsedMilliseconds} ms");
        Assert.Equal(20_000, all.Total);
        Assert.Equal(100, all.Rows.Count);
        Assert.True(search.Total > 1000);
        Assert.Equal(5000, triage.Total);
        Assert.True(sw.ElapsedMilliseconds < 1500, $"took {sw.ElapsedMilliseconds} ms");
    }

    [Fact]
    public void Playlists_And_State_Persist()
    {
        var (t, lib, folder) = Setup();
        using var _ = t;
        lib.ScanFolder(folder);
        var ids = lib.Query(new LibraryQuery(Sort: "filename")).Rows.Select(r => r.Id).ToList();
        var pl = lib.CreatePlaylist("Writing music");
        lib.SetPlaylistItems(pl, ids.Take(3).Reverse());
        lib.RenamePlaylist(pl, "Pisanie ✍");
        lib.SetState("session", """{"queue":[1,2,3]}""");
        var reopened = new MusicLibrary(lib.DatabasePath);
        Assert.Equal("Pisanie ✍", reopened.Playlists().Single().Name);
        Assert.Equal(ids.Take(3).Reverse(), reopened.PlaylistTrackIds(pl));
        Assert.Equal(ids.Take(3).Reverse(), reopened.Query(new LibraryQuery(PlaylistId: pl, Sort: "playlist")).Rows.Select(r => r.Id));
        Assert.Contains("queue", reopened.GetState("session"));
    }
}

public class EditorTests
{
    private static (TempDir, MusicLibrary, TrackEditor, TrackRow) Setup(string fixture = "tagged.mp3", string name = "Suno 0042.mp3")
    {
        var t = new TempDir();
        t.Copy(fixture, "m", name);
        t.Copy("tone.mp3", "m", "Taken.mp3");
        var lib = new MusicLibrary(t.P("lib.db"));
        lib.ScanFolder(lib.AddFolder(t.P("m")));
        var row = lib.Query(new LibraryQuery(Search: System.IO.Path.GetFileNameWithoutExtension(name))).Rows.Single();
        return (t, lib, new TrackEditor(lib), row);
    }

    [Fact]
    public void Undo_Keeps_Untouched_Multi_Value_Tags_And_Refuses_After_Outside_Tag_Changes()
    {
        var (t, lib, ed, row) = Setup();
        using var _ = t;
        using (var f = TagLib.File.Create(row.Path)) { f.Tag.Genres = ["Rock", "Pop"]; f.Save(); }
        lib.Refresh(row.Id, row.Path);
        var res = ed.Apply(row.Id, new TagEdit { Title = "Nowy tytuł" }, null);
        Assert.True(res.Ok, string.Join(" ", res.Problems));
        var undo = ed.Undo(res.JournalId!.Value);
        Assert.True(undo.Ok, string.Join(" ", undo.Problems));
        using (var f = TagLib.File.Create(row.Path)) Assert.Equal(["Rock", "Pop"], f.Tag.Genres); // not collapsed to "Rock"

        var again = ed.Apply(row.Id, new TagEdit { Title = "Drugi" }, null);
        using (var f = TagLib.File.Create(again.Path)) { f.Tag.Comment = "changed in Mp3tag"; f.Save(); } // fits in the padding
        var refused = ed.Undo(again.JournalId!.Value);
        Assert.False(refused.Ok);
        Assert.Equal("changed in Mp3tag", TagIO.Read(again.Path).Comment);
    }

    [Fact]
    public void Renaming_Onto_A_File_Deleted_Outside_NoorMD_Works_And_Can_Be_Undone()
    {
        var (t, lib, ed, row) = Setup();
        using var _ = t;
        File.Delete(t.P("m", "Taken.mp3")); // deleted in Explorer, no rescan: its row still looks present
        var res = ed.Apply(row.Id, new TagEdit(), "Taken");
        Assert.True(res.Ok, string.Join(" ", res.Problems));
        Assert.Equal(row.Id, lib.Get(row.Id)!.Id);
        Assert.EndsWith("Taken.mp3", lib.Get(row.Id)!.Path);
        Assert.Single(lib.Query(new LibraryQuery()).Rows); // the stale row is gone
        var undo = ed.Undo(res.JournalId!.Value);
        Assert.True(undo.Ok, string.Join(" ", undo.Problems));
        Assert.True(File.Exists(row.Path));
    }

    [Fact]
    public void Edit_Title_And_Rename_Keeps_Id_Queue_References_And_Can_Be_Undone()
    {
        var (t, lib, ed, row) = Setup();
        using var _ = t;
        var pl = lib.CreatePlaylist("q");
        lib.SetPlaylistItems(pl, [row.Id, row.Id]); // duplicate allowed in playlists
        var res = ed.Apply(row.Id, new TagEdit { Title = "Nocna jazda" }, "Nocna jazda");
        Assert.True(res.Ok, string.Join(" ", res.Problems));
        Assert.True(res.TagsSaved && res.Renamed);
        Assert.EndsWith("Nocna jazda.mp3", res.Path);
        Assert.Equal(row.Id, res.Track!.Id);
        Assert.Equal("Nocna jazda", lib.Get(row.Id)!.Title);
        Assert.Equal([row.Id, row.Id], lib.PlaylistTrackIds(pl));
        Assert.Equal("Nocna jazda", TagIO.Read(res.Path).Title);

        var undo = ed.Undo(res.JournalId!.Value);
        Assert.True(undo.Ok, string.Join(" ", undo.Problems));
        Assert.True(File.Exists(row.Path));
        Assert.False(File.Exists(res.Path));
        Assert.Equal("Suno Track 0042", TagIO.Read(row.Path).Title);
        Assert.Equal(row.Path, lib.Get(row.Id)!.Path);
    }

    [Fact]
    public void Collision_Changes_Nothing_At_All()
    {
        var (t, lib, ed, row) = Setup();
        using var _ = t;
        var before = File.ReadAllBytes(row.Path);
        var res = ed.Apply(row.Id, new TagEdit { Title = "Should not be written" }, "Taken");
        Assert.False(res.Ok);
        Assert.False(res.TagsSaved);
        Assert.Equal(before, File.ReadAllBytes(row.Path));
        Assert.Equal("Suno Track 0042", lib.Get(row.Id)!.Title);
    }

    [Fact]
    public void Tags_Only_Or_Rename_Only()
    {
        var (t, lib, ed, row) = Setup();
        using var _ = t;
        var tagsOnly = ed.Apply(row.Id, new TagEdit { Genre = "Lo-fi" }, null);
        Assert.True(tagsOnly.TagsSaved && !tagsOnly.Renamed);
        Assert.Equal(row.Path, tagsOnly.Path);
        var renameOnly = ed.Apply(row.Id, null, "Only the name");
        Assert.True(renameOnly.Renamed && !renameOnly.TagsSaved);
        Assert.Equal("Lo-fi", TagIO.Read(renameOnly.Path).Genre);
    }

    [Fact]
    public void Undo_Refuses_When_File_Changed_Since()
    {
        var (t, lib, ed, row) = Setup();
        using var _ = t;
        var res = ed.Apply(row.Id, new TagEdit { Title = "First" }, null);
        File.AppendAllText(res.Path, "x"); // modified by another program
        var undo = ed.Undo(res.JournalId!.Value);
        Assert.False(undo.Ok);
        Assert.Contains("modified", undo.Problems[0]);
    }

    [Fact]
    public void ReadOnly_Track_Reports_Clearly()
    {
        var (t, lib, ed, row) = Setup();
        using var _ = t;
        File.SetAttributes(row.Path, FileAttributes.ReadOnly);
        var res = ed.Apply(row.Id, new TagEdit { Title = "x" }, "y");
        Assert.False(res.Ok);
        Assert.True(File.Exists(row.Path));
        Assert.Contains(res.Problems, p => p.Contains("read-only"));
    }

    [Fact]
    public void Missing_Track_Reports_Clearly()
    {
        var (t, lib, ed, row) = Setup();
        using var _ = t;
        File.Delete(row.Path);
        var res = ed.Apply(row.Id, new TagEdit { Title = "x" }, null);
        Assert.False(res.Ok);
        Assert.Contains("missing", res.Problems[0]);
    }
}

public class PlaylistFileAndRangeTests
{
    [Fact]
    public void M3u8_RoundTrip_With_Relative_Polish_Paths()
    {
        using var t = new TempDir();
        var a = t.Copy("tone.mp3", "music", "Żółw.mp3");
        var b = t.Copy("tone.flac", "music", "sub", "Łódź.flac");
        var list = t.P("music", "lista.m3u8");
        var text = M3u.Write(list, [new M3u.Entry(a, 2, "Żółw"), new M3u.Entry(b, 2, null)]);
        Assert.Contains("Żółw.mp3", text);
        Assert.DoesNotContain(t.Path, text); // relative
        Assert.Equal([Path.GetFullPath(a), Path.GetFullPath(b)], M3u.Read(list));
    }

    [Fact]
    public void M3u_Reads_Absolute_FileUris_And_Skips_Urls_And_Comments()
    {
        using var t = new TempDir();
        var a = t.Copy("tone.mp3", "x.mp3");
        var list = t.P("legacy.m3u");
        File.WriteAllText(list, $"#EXTM3U\n#EXTINF:2,x\n{a}\nhttps://example.com/stream.mp3\n{new Uri(a).AbsoluteUri}\n\n");
        Assert.Equal([a, a], M3u.Read(list));
    }

    [Theory]
    [InlineData(null, 100, null, null)]
    [InlineData("bytes=0-", 100, 0L, 99L)]
    [InlineData("bytes=10-19", 100, 10L, 19L)]
    [InlineData("bytes=90-500", 100, 90L, 99L)]
    [InlineData("bytes=-30", 100, 70L, 99L)]
    [InlineData("bytes=200-", 100, -1L, -1L)]
    [InlineData("bytes=50-10", 100, -1L, -1L)]
    [InlineData("items=0-1", 100, null, null)]
    public void Range_Parsing(string? header, long length, long? start, long? end)
    {
        var r = RangeRequest.Parse(header, length);
        Assert.Equal(start, r?.Start);
        Assert.Equal(end, r?.End);
    }
}

public class MediaResponseTests
{
    [Fact]
    public void Audio_in_memory_is_served_in_ranges_for_seeking()
    {
        var data = Enumerable.Range(0, 5000).Select(i => (byte)i).ToArray();
        var all = MediaResponse.FromBytes(data, null, "audio/wav");
        Assert.Equal(200, all.Status);
        Assert.Contains("Accept-Ranges: bytes", all.Headers);
        var part = MediaResponse.FromBytes(data, "bytes=1000-1999", "audio/wav");
        Assert.Equal(206, part.Status);
        Assert.Equal(data[1000..2000], part.Body);
        Assert.Contains("Content-Range: bytes 1000-1999/5000", part.Headers);
        Assert.Equal(416, MediaResponse.FromBytes(data, "bytes=6000-", "audio/wav").Status);
    }

    [Fact]
    public void Serves_Chunked_Ranges_And_Releases_The_File()
    {
        using var t = new TempDir();
        var f = t.P("big.mp3");
        var data = new byte[5 * 1024 * 1024 + 123];
        new Random(1).NextBytes(data);
        File.WriteAllBytes(f, data);

        var first = MediaResponse.Build(f, "bytes=0-", "audio/mpeg");
        Assert.Equal(206, first.Status);
        Assert.Equal(MediaResponse.MaxChunk, first.Body.Length);
        Assert.Contains($"Content-Range: bytes 0-{MediaResponse.MaxChunk - 1}/{data.Length}", first.Headers);
        Assert.Equal(data.AsSpan(0, 100).ToArray(), first.Body.AsSpan(0, 100).ToArray());

        var tail = MediaResponse.Build(f, $"bytes={data.Length - 10}-", "audio/mpeg");
        Assert.Equal(data.AsSpan(data.Length - 10).ToArray(), tail.Body);

        Assert.Equal(416, MediaResponse.Build(f, $"bytes={data.Length}-", "audio/mpeg").Status);
        Assert.Equal(404, MediaResponse.Build(t.P("nope.mp3"), null, "audio/mpeg").Status);

        // No handle is kept: the file can be renamed and rewritten right after serving.
        File.Move(f, t.P("renamed.mp3"));
        File.WriteAllBytes(t.P("renamed.mp3"), [1, 2, 3]);
    }
}

/// <summary>
/// Regression: the page sends nulls ("no filter"), and JsonElement.TryGetInt32 throws on null. On Windows this
/// made music.query fail (found by the CI self-test). These payloads are exactly what music.js sends.
/// </summary>
public class MusicRequestTests
{
    private static JsonElement J(string json) => JsonDocument.Parse(json).RootElement.Clone();

    [Fact]
    public void Query_Accepts_The_Pages_Default_Payload_With_Nulls()
    {
        var q = MusicRequests.Query(J("""{"search":"","triage":null,"missingOnly":false,"playlistId":null,"sort":"title","desc":false,"offset":0,"limit":200}"""));
        Assert.Null(q.Triage);
        Assert.Null(q.PlaylistId);
        Assert.Equal("title", q.Sort);
        Assert.Equal(200, q.Limit);
    }

    [Fact]
    public void Query_Reads_Filters_And_Clamps()
    {
        var q = MusicRequests.Query(J("""{"search":"żółw","triage":3,"playlistId":7,"sort":"duration","desc":true,"offset":-5,"limit":999999,"missingOnly":true}"""));
        Assert.Equal(Triage.Maybe, q.Triage);
        Assert.Equal(7, q.PlaylistId);
        Assert.True(q.Descending && q.MissingOnly);
        Assert.Equal(0, q.Offset);
        Assert.Equal(2000, q.Limit);
        Assert.Null(MusicRequests.Query(J("""{"triage":"1"}""")).Triage);   // wrong type is ignored, not thrown
        Assert.Null(MusicRequests.Query(J("""{"triage":9}""")).Triage);     // out of range
        Assert.Equal("title", MusicRequests.Query(J("{}")).Sort);
    }

    [Fact]
    public void Ids_Skips_NonNumbers_And_Tags_Distinguish_Clear_From_Unchanged()
    {
        Assert.Equal([1L, 3L], MusicRequests.Ids(J("""{"ids":[1,null,"2",3,{"x":1}]}""")));
        Assert.Empty(MusicRequests.Ids(J("""{"ids":null}""")));
        var tags = MusicRequests.Tags(J("""{"updateTags":true,"tags":{"title":"Nowy","year":"","trackNumber":5,"genre":null}}"""))!;
        Assert.Equal("Nowy", tags.Title);
        Assert.Equal(0u, tags.Year);           // "" = clear
        Assert.Equal(5u, tags.TrackNumber);
        Assert.Null(tags.Genre);               // null = leave unchanged
        Assert.Null(tags.Artist);              // absent = leave unchanged
        Assert.Null(MusicRequests.Tags(J("""{"updateTags":false,"tags":{"title":"x"}}""")));
        Assert.Throws<ArgumentException>(() => MusicRequests.RequireId(J("""{"id":null}""")));
        Assert.Equal(42, MusicRequests.RequireId(J("""{"id":42}""")));
    }
}

public class BatchOrganizerTests
{
    private static (TempDir, MusicLibrary, BatchOrganizer, List<TrackRow>) Setup(params string[] names)
    {
        var t = new TempDir();
        foreach (var n in names) t.Copy("tone.mp3", "m", n);
        var lib = new MusicLibrary(t.P("lib.db"));
        lib.ScanFolder(lib.AddFolder(t.P("m")));
        var rows = names.Select(n => lib.Query(new LibraryQuery(Search: System.IO.Path.GetFileNameWithoutExtension(n))).Rows.Single(r => r.FileName == n)).ToList();
        return (t, lib, new BatchOrganizer(lib), rows);
    }

    private static BatchSpec Rename(string template, Func<RenameRules, RenameRules>? more = null)
    {
        var r = new RenameRules { Enabled = true, Template = template };
        return new BatchSpec { Rename = more == null ? r : more(r) };
    }

    [Fact]
    public void Preview_Touches_Nothing_And_Uses_Counter_And_New_Tags()
    {
        var (t, lib, org, rows) = Setup("a.mp3", "b.mp3", "c.mp3");
        using var _ = t;
        var before = rows.Select(r => File.ReadAllBytes(r.Path)).ToList();
        var spec = Rename("{n} {Artist} - {OriginalName}") with { Tags = new Dictionary<string, BatchField> { ["artist"] = new(FieldMode.Set, "Noor") } };
        var p = org.Preview(rows.Select(r => r.Id).ToList(), spec);
        Assert.Equal(["01 Noor - a.mp3", "02 Noor - b.mp3", "03 Noor - c.mp3"], p.Items.Select(i => i.NewName));
        Assert.All(p.Items, i => Assert.Contains(i.TagChanges, c => c.Field == "artist" && c.New == "Noor"));
        Assert.Equal(3, p.WillChange);
        Assert.Equal(before, rows.Select(r => File.ReadAllBytes(r.Path)).ToList());
        Assert.True(File.Exists(rows[0].Path));
    }

    [Fact]
    public void Collisions_Inside_The_Batch_And_On_Disk_Are_Blocked()
    {
        var (t, lib, org, rows) = Setup("a.mp3", "b.mp3", "Taken.mp3");
        using var _ = t;
        var dup = org.Preview([rows[0].Id, rows[1].Id], Rename("Same"));
        Assert.All(dup.Items, i => Assert.Contains(i.Problems, x => x.Contains("would be named")));
        var disk = org.Preview([rows[0].Id], Rename("Taken"));
        Assert.Contains(disk.Items[0].Problems, x => x.Contains("already exists"));
        var res = org.Apply([rows[0].Id, rows[1].Id], Rename("Same"));
        Assert.Equal(2, res.Skipped);
        Assert.Null(res.BatchId);
        Assert.True(File.Exists(rows[0].Path) && File.Exists(rows[1].Path));
    }

    [Fact]
    public void Swap_And_Chain_Renames_Work_And_Undo_As_One_Batch()
    {
        var (t, lib, org, rows) = Setup("a.mp3", "b.mp3", "c.mp3");
        using var _ = t;
        // a→b, b→c, c→a (a rotation): every target is taken by another file of the batch. Names come from the title tag.
        foreach (var (row, title) in rows.Zip(["b", "c", "a"])) TagIO.Write(row.Path, new TagEdit { Title = title });
        foreach (var row in rows) lib.Refresh(row.Id, row.Path);
        var res = org.Apply(rows.Select(r => r.Id).ToList(), Rename("{Title}"));
        Assert.Equal(3, res.Done);
        Assert.NotNull(res.BatchId);
        // a.mp3 had the title "b", so that file is now b.mp3, and so on.
        Assert.Equal("b", TagIO.Read(t.P("m", "b.mp3")).Title);
        Assert.Equal("c", TagIO.Read(t.P("m", "c.mp3")).Title);
        Assert.Equal("a", TagIO.Read(t.P("m", "a.mp3")).Title);
        Assert.Equal(t.P("m", "b.mp3"), lib.Get(rows[0].Id)!.Path);
        Assert.Empty(Directory.GetFiles(t.P("m"), ".noormd-*"));

        var undo = org.Undo(res.BatchId!.Value);
        Assert.Equal(3, undo.Done);
        Assert.Equal("b", TagIO.Read(t.P("m", "a.mp3")).Title);
        Assert.Equal("a", TagIO.Read(t.P("m", "c.mp3")).Title);
        Assert.Equal(rows[0].Path, lib.Get(rows[0].Id)!.Path);
    }

    [Fact]
    public void Leave_Unchanged_Versus_Clear_And_Undo_Restores_Tags()
    {
        var (t, lib, org, rows) = Setup("a.mp3", "b.mp3");
        using var _ = t;
        foreach (var r in rows) { TagIO.Write(r.Path, new TagEdit { Genre = "Lo-fi", Album = "Old", Comment = "keep me" }); lib.Refresh(r.Id, r.Path); }
        var spec = new BatchSpec { Tags = new Dictionary<string, BatchField> { ["genre"] = new(FieldMode.Clear), ["album"] = new(FieldMode.Set, "Night Drive"), ["trackNumber"] = new(FieldMode.Set, "{n}"), ["comment"] = new(FieldMode.Keep) } };
        var res = org.Apply(rows.Select(r => r.Id).ToList(), spec);
        Assert.Equal(2, res.Done);
        var tags = TagIO.Read(rows[1].Path);
        Assert.Null(tags.Genre);
        Assert.Equal("Night Drive", tags.Album);
        Assert.Equal(2u, tags.TrackNumber);
        Assert.Equal("keep me", tags.Comment);
        Assert.Equal(rows[1].Path, lib.Get(rows[1].Id)!.Path);

        var undo = org.Undo(res.BatchId!.Value);
        Assert.Equal(2, undo.Done);
        tags = TagIO.Read(rows[1].Path);
        Assert.Equal("Lo-fi", tags.Genre);
        Assert.Equal("Old", tags.Album);
        Assert.Null(tags.TrackNumber);
    }

    [Fact]
    public void Illegal_Characters_Reserved_Names_And_Bad_Rules_Are_Explained()
    {
        var (t, lib, org, rows) = Setup("a.mp3");
        using var _ = t;
        var ids = new List<long> { rows[0].Id };
        Assert.Contains("allow", org.Preview(ids, Rename("What? Yes: no")).Items[0].Problems[0]);
        Assert.Equal("What- Yes- no.mp3", org.Preview(ids, Rename("What? Yes: no", r => r with { ReplaceIllegal = true })).Items[0].NewName);
        Assert.Contains("reserved", org.Preview(ids, Rename("CON")).Items[0].Problems[0]);
        Assert.Throws<ArgumentException>(() => org.Preview(ids, Rename("{Nope}")));
        Assert.Throws<ArgumentException>(() => org.Preview(ids, Rename("{OriginalName}", r => r with { Find = "(", Regex = true })));
        var trackNo = org.Preview(ids, new BatchSpec { Tags = new Dictionary<string, BatchField> { ["year"] = new(FieldMode.Set, "soon") } });
        Assert.Contains("whole number", trackNo.Items[0].Problems[0]);
        var longName = org.Preview(ids, Rename(new string('x', 250)));
        Assert.Contains("too long", longName.Items[0].Problems[0]);
    }

    [Fact]
    public void Case_Spaces_Prefix_Suffix_And_Empty_Placeholder_Warnings()
    {
        var (t, lib, org, rows) = Setup("suno_track  one.mp3");
        using var _ = t;
        var ids = new List<long> { rows[0].Id };
        var p = org.Preview(ids, Rename("{Artist} - {OriginalName}", r => r with { UnderscoresToSpaces = true, Case = "title", Prefix = "[Live] " , Suffix = " (v2)" }));
        Assert.Equal("[Live] Suno Track One (V2).mp3", p.Items[0].NewName);
        Assert.Contains(p.Items[0].Warnings, w => w.Contains("{Artist}"));
        Assert.Equal("Suno track one.mp3", org.Preview(ids, Rename("{OriginalName}", r => r with { UnderscoresToSpaces = true, Case = "sentence" })).Items[0].NewName);
        Assert.Equal("one", org.Preview(ids, Rename("{OriginalName}", r => r with { Find = @"^.*\s(\w+)$", Replace = "$1", Regex = true })).Items[0].NewName[..3]);
        Assert.Equal("Track one.mp3", org.Preview(ids, Rename("{OriginalName}", r => r with { Find = "suno_t", Replace = "T" })).Items[0].NewName);
    }

    [Fact]
    public void Case_Only_Rename_Works()
    {
        var (t, lib, org, rows) = Setup("night drive.mp3");
        using var _ = t;
        var res = org.Apply([rows[0].Id], Rename("{OriginalName}", r => r with { Case = "upper" }));
        Assert.Equal(1, res.Done);
        Assert.Equal("NIGHT DRIVE.mp3", System.IO.Path.GetFileName(lib.Get(rows[0].Id)!.Path));
    }

    [Fact]
    public void Undo_Skips_Files_Changed_Since_And_Undoes_The_Rest()
    {
        var (t, lib, org, rows) = Setup("a.mp3", "b.mp3");
        using var _ = t;
        var res = org.Apply(rows.Select(r => r.Id).ToList(), Rename("{OriginalName} new"));
        File.AppendAllText(t.P("m", "b new.mp3"), "changed");
        var undo = org.Undo(res.BatchId!.Value);
        Assert.Equal(1, undo.Done);
        Assert.Equal(1, undo.Skipped);
        Assert.True(File.Exists(rows[0].Path));
        Assert.True(File.Exists(t.P("m", "b new.mp3")));
    }

    [Fact]
    public void Schema_Upgrade_Keeps_Existing_Journal()
    {
        using var t = new TempDir();
        var db = t.P("lib.db");
        _ = new MusicLibrary(db);
        var again = new MusicLibrary(db); // reopening an upgraded database is a no-op
        Assert.Empty(again.Journal());
    }
}

public class MusicPolishTests
{
    private static (TempDir, MusicLibrary, List<TrackRow>) Setup(params string[] names)
    {
        var t = new TempDir();
        foreach (var n in names) t.Copy("tone.mp3", "m", n);
        var lib = new MusicLibrary(t.P("lib.db"));
        lib.ScanFolder(lib.AddFolder(t.P("m")));
        var rows = names.Select(n => lib.Query(new LibraryQuery(Limit: 2000)).Rows.Single(r => r.FileName == n)).ToList();
        return (t, lib, rows);
    }

    private static List<string> Names(MusicLibrary lib, SmartRules rules) =>
        lib.Query(new LibraryQuery(Smart: rules, Sort: "filename", Limit: 2000)).Rows.Select(r => r.FileName).ToList();

    [Fact]
    public void Smart_Rules_Match_Text_Numbers_Dates_Flags_And_Marks()
    {
        var (t, lib, rows) = Setup("a.mp3", "b.mp3", "c.mp3", "Żółw.mp3");
        using var _ = t;
        TagIO.Write(rows[0].Path, new TagEdit { Genre = "Synthwave", Year = 2024 }); lib.Refresh(rows[0].Id, rows[0].Path);
        TagIO.Write(rows[1].Path, new TagEdit { Genre = "Lo-fi Synth", Year = 2019 }); lib.Refresh(rows[1].Id, rows[1].Path);
        lib.SetTriage([rows[2].Id], Triage.Favorite);
        lib.MarkPlayed(rows[1].Id); lib.MarkPlayed(rows[1].Id); lib.MarkPlayed(rows[2].Id);

        Assert.Equal(["a.mp3", "b.mp3"], Names(lib, new(true, [new("genre", "contains", "SYNTH")])));
        Assert.Equal(["a.mp3"], Names(lib, new(true, [new("genre", "contains", "synth"), new("year", "ge", "2020")])));
        Assert.Equal(["a.mp3", "c.mp3"], Names(lib, new(false, [new("year", "ge", "2020"), new("triage", "is", "1")])));
        Assert.Equal(["a.mp3", "Żółw.mp3"], Names(lib, new(true, [new("lastPlayed", "never")])));
        Assert.Equal(["b.mp3", "c.mp3"], Names(lib, new(true, [new("lastPlayed", "withinDays", "1")])));
        Assert.Equal(["a.mp3", "Żółw.mp3"], Names(lib, new(true, [new("lastPlayed", "olderThanDays", "30")])));
        Assert.Equal(["Żółw.mp3"], Names(lib, new(true, [new("fileName", "contains", "zolw")])));
        Assert.Equal(["c.mp3", "Żółw.mp3"], Names(lib, new(true, [new("genre", "isEmpty")])));
        Assert.Equal(["b.mp3"], Names(lib, new(true, [new("plays", "gt", "0")], "plays", true, 1)));
        Assert.Equal(4, Names(lib, new(true, [new("added", "withinDays", "7")])).Count);
        Assert.Equal(["a.mp3", "b.mp3", "c.mp3", "Żółw.mp3"], Names(lib, new(true, [new("missing", "isFalse")])));
        Assert.Empty(Names(lib, new(true, [new("genre", "notEmpty"), new("title", "contains", "%")]))); // % is literal, not a wildcard
    }

    [Fact]
    public void Smart_Rules_Reject_Unknown_Fields_Ops_And_Bad_Values()
    {
        var (t, lib, _) = Setup("a.mp3");
        using var __ = t;
        Assert.Throws<ArgumentException>(() => SmartSql.Build(new(true, [new("path; DROP TABLE tracks", "is", "x")]), DateTime.UtcNow));
        Assert.Throws<ArgumentException>(() => SmartSql.Build(new(true, [new("year", "contains", "x")]), DateTime.UtcNow));
        Assert.Throws<ArgumentException>(() => SmartSql.Build(new(true, [new("year", "gt", "soon")]), DateTime.UtcNow));
        Assert.Throws<ArgumentException>(() => SmartSql.Build(new(true, [new("plays", "gt", "1")], "plays", true, 0), DateTime.UtcNow));
        Assert.Throws<ArgumentException>(() => lib.SaveSmart(null, "", new(true, [])));
        // Values are parameters, never SQL.
        Assert.Empty(Names(lib, new(true, [new("title", "is", "x' OR '1'='1")])));
    }

    [Fact]
    public void Smart_Collections_Are_Saved_Renamed_And_Deleted()
    {
        var (t, lib, _) = Setup("a.mp3");
        using var __ = t;
        var id = lib.SaveSmart(null, "Never played", new(true, [new("lastPlayed", "never")]));
        Assert.Equal("Never played", lib.Smart(id)!.Name);
        lib.SaveSmart(id, "Fresh", new(true, [new("added", "withinDays", "14")], "added", true, 50));
        var s = lib.Smart(id)!;
        Assert.Equal("Fresh", s.Name);
        Assert.Equal(50, s.Rules.Limit);
        Assert.Equal("withinDays", s.Rules.Rules[0].Op);
        lib.DeleteSmart(id);
        Assert.Empty(lib.SmartCollections());
    }

    [Fact]
    public void Loudness_Is_Stored_Without_Touching_The_File()
    {
        var (t, lib, rows) = Setup("a.mp3", "b.mp3");
        using var _ = t;
        var before = File.ReadAllBytes(rows[0].Path);
        Assert.Equal(2, lib.Unmeasured(null).Count);
        lib.SetLoudness(rows[0].Id, -12.5, 0.98);
        var r = lib.Get(rows[0].Id)!;
        Assert.Equal(-12.5, r.Loudness);
        Assert.Equal(0.98, r.Peak);
        Assert.Equal(before, File.ReadAllBytes(rows[0].Path));
        Assert.Equal([rows[1].Id], lib.Unmeasured(null));
        Assert.Equal([rows[1].Id], lib.Unmeasured([rows[0].Id, rows[1].Id]));
        Assert.Throws<ArgumentException>(() => lib.SetLoudness(rows[0].Id, double.NaN, 1));
        // A tag edit keeps the measurement (the audio didn't change).
        new TrackEditor(lib).Apply(rows[0].Id, new TagEdit { Title = "x" }, null);
        Assert.Equal(-12.5, lib.Get(rows[0].Id)!.Loudness);
    }

    [Fact]
    public void Folder_Artwork_Is_Found_And_Counts_As_Artwork()
    {
        using var t = new TempDir();
        t.Copy("tone.mp3", "m", "a.mp3");
        File.WriteAllBytes(t.P("m", "Folder.JPG"), [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
        File.WriteAllBytes(t.P("m", "notes.png"), [1]);
        Assert.Equal(t.P("m", "Folder.JPG"), FolderArt.Find(t.P("m")));
        File.WriteAllBytes(t.P("m", "cover.png"), [0x89, 0x50]);
        Directory.SetLastWriteTimeUtc(t.P("m"), DateTime.UtcNow.AddMinutes(1)); // the folder changed
        Assert.Equal(t.P("m", "cover.png"), FolderArt.Find(t.P("m")));
        Assert.Equal("image/png", FolderArt.Read(t.P("m"))!.Value.MimeType);
        var lib = new MusicLibrary(t.P("lib.db"));
        lib.ScanFolder(lib.AddFolder(t.P("m")));
        Assert.True(lib.Query(new LibraryQuery()).Rows.Single().HasArtwork);
        Assert.Null(FolderArt.Find(t.P("nope")));
    }

    [Fact]
    public void Version_1_Library_Upgrades_In_Place()
    {
        using var t = new TempDir();
        var db = t.P("old.db");
        using (var c = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={db};Pooling=False"))
        {
            c.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = """
                CREATE TABLE folders (id INTEGER PRIMARY KEY, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE, recursive INTEGER NOT NULL DEFAULT 1, last_scan TEXT);
                CREATE TABLE tracks (id INTEGER PRIMARY KEY, folder_id INTEGER, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE,
                  size INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL DEFAULT 0, fingerprint TEXT,
                  title TEXT, artist TEXT, album TEXT, album_artist TEXT, genre TEXT, year INTEGER, track_no INTEGER, comment TEXT,
                  duration REAL NOT NULL DEFAULT 0, has_art INTEGER NOT NULL DEFAULT 0, read_error TEXT,
                  triage INTEGER NOT NULL DEFAULT 0, missing INTEGER NOT NULL DEFAULT 0, added TEXT NOT NULL, play_count INTEGER NOT NULL DEFAULT 0, last_played TEXT,
                  sort_title TEXT NOT NULL DEFAULT '', sort_name TEXT NOT NULL DEFAULT '', sort_folder TEXT NOT NULL DEFAULT '', search TEXT NOT NULL DEFAULT '');
                CREATE TABLE playlists (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL);
                CREATE TABLE playlist_items (playlist_id INTEGER NOT NULL, position INTEGER NOT NULL, track_id INTEGER NOT NULL, PRIMARY KEY (playlist_id, position));
                CREATE TABLE journal (id INTEGER PRIMARY KEY, utc TEXT NOT NULL, track_id INTEGER NOT NULL, old_path TEXT NOT NULL, new_path TEXT NOT NULL,
                  old_tags TEXT, new_tags TEXT, new_fingerprint TEXT, status TEXT NOT NULL, note TEXT);
                CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                INSERT INTO tracks (id, path, path_key, added, title, triage) VALUES (7, 'C:\\m\\x.mp3', 'C:\\M\\X.MP3', '2026-01-01T00:00:00.0000000Z', 'Kept', 2);
                PRAGMA user_version = 1;
                """;
            cmd.ExecuteNonQuery();
        }
        var lib = new MusicLibrary(db);
        var row = lib.Get(7)!;
        Assert.Equal("Kept", row.Title);
        Assert.Equal(Triage.Keep, row.Triage);
        Assert.Null(row.Loudness);
        Assert.Empty(lib.SmartCollections());
        lib.SetLoudness(7, -14, 1);
        Assert.Equal(-14, new MusicLibrary(db).Get(7)!.Loudness);
    }
}

public class VideoTests
{
    [Theory]
    [InlineData("Show.S01E02.1080p.mkv", 1, 2)]
    [InlineData("show s2 e10 x264.mp4", 2, 10)]
    [InlineData("Show 1x03.webm", 1, 3)]
    [InlineData("Episode 7 - The Long Way.mp4", null, 7)]
    [InlineData("Wayfarer's Wake devlog - 04 - Boats.mp4", null, 4)]
    [InlineData("12 Final.mp4", null, 12)]
    [InlineData("Odcinek 5.mp4", null, 5)]
    [InlineData("Trailer 2024 1080p.mp4", null, null)]
    public void Episode_Numbers_Are_Parsed(string name, int? season, int? episode) => Assert.Equal((season, episode), EpisodeParser.Parse(name));

    [Fact]
    public void Natural_Order_Puts_2_Before_10() =>
        Assert.Equal(["Part 2", "Part 10"], new[] { "Part 10", "Part 2" }.OrderBy(EpisodeParser.NaturalKey, StringComparer.Ordinal));

    [Fact]
    public void Srt_And_Ass_Become_WebVtt()
    {
        var srt = "﻿1\r\n00:00:01,500 --> 00:00:03,000\r\n<font color=\"red\">Hello</font> <i>there</i>\r\n\r\n2\r\n00:01:02,05 --> 00:01:04,000\r\nLine one\r\nLine two\r\n";
        var vtt = SubtitleConverter.ToVtt(srt, ".srt");
        Assert.StartsWith("WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nHello <i>there</i>\n", vtt);
        Assert.Contains("00:01:02.050 --> 00:01:04.000\nLine one\nLine two", vtt);

        var ass = "[Script Info]\nTitle: x\n\n[V4+ Styles]\nFormat: Name, Fontname\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" +
                  "Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\an8\\b1}Top, with comma\\Nsecond line\n" +
                  "Comment: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,not shown\n";
        var v2 = SubtitleConverter.ToVtt(ass, ".ass");
        Assert.Equal("WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nTop, with comma\nsecond line\n\n", v2);
        Assert.StartsWith("WEBVTT", SubtitleConverter.ToVtt("WEBVTT\n\n00:00.000 --> 00:01.000\nx", ".vtt"));
    }

    [Fact]
    public void Sidecar_Subtitles_Are_Found_By_Name()
    {
        using var t = new TempDir();
        t.Copy("clip.webm", "s", "Show 1.webm");
        foreach (var n in new[] { "Show 1.srt", "Show 1.en.srt", "Show 1.English.forced.ass", "Show 10.srt", "Other.srt" }) File.WriteAllText(t.P("s", n), "x");
        var subs = SubtitleConverter.Find(t.P("s", "Show 1.webm")).Select(s => s.Label).ToList();
        Assert.Equal(["en (SRT)", "English.forced (ASS)", "Subtitles (SRT)"], subs);
    }

    private static (TempDir, VideoLibrary, long) Library()
    {
        var t = new TempDir();
        foreach (var n in new[] { "Episode 10.webm", "Episode 2.webm", "Episode 1.webm" }) t.Copy("clip.webm", "v", "My Show", n);
        t.Copy("clip.webm", "v", "Single.webm");
        File.WriteAllText(t.P("v", "notes.txt"), "not a video");
        var lib = new VideoLibrary(t.P("video.db"));
        var f = lib.AddFolder(t.P("v"));
        lib.Scan(f);
        return (t, lib, f);
    }

    [Fact]
    public void Scan_Groups_Series_In_Episode_Order_With_Durations()
    {
        var (t, lib, f) = Library();
        using var _ = t;
        var series = lib.Series();
        Assert.Equal(2, series.Count);
        var show = series.Single(s => s.Name == "My Show");
        Assert.Equal(["Episode 1", "Episode 2", "Episode 10"], lib.Episodes(show.Key).Select(e => e.Title));
        var ep = lib.Episodes(show.Key)[0];
        Assert.InRange(ep.Duration, 5.5, 6.5);
        Assert.Equal(160, ep.Width);
        Assert.Equal(1, lib.Folders().Single().Id == f ? 1 : 0);
        Assert.Equal(4, lib.Folders().Single().Count);
        // Rescan keeps ids; a deleted file is marked missing, not forgotten.
        var id = ep.Id;
        File.Delete(t.P("v", "My Show", "Episode 2.webm"));
        var (found, added, missing) = lib.Scan(f);
        Assert.Equal((3, 0, 1), (found, added, missing));
        Assert.Equal(id, lib.Episodes(show.Key)[0].Id);
        Assert.Equal(2, lib.Episodes(show.Key).Count);
    }

    [Fact]
    public void Resume_Watched_And_Next_Episode()
    {
        var (t, lib, _) = Library();
        using var __ = t;
        var key = lib.Series().Single(s => s.Name == "My Show").Key;
        var eps = lib.Episodes(key);
        Assert.Equal(eps[0].Id, VideoLibrary.ResumeIn(eps)!.Id);
        lib.SetPosition(eps[0].Id, 200, 1000);
        Assert.Equal(200, lib.Get(eps[0].Id)!.Position);
        Assert.Single(lib.ContinueWatching());
        lib.SetPosition(eps[0].Id, 950, 1000); // past 92 %: watched, resumes from the start next time
        var done = lib.Get(eps[0].Id)!;
        Assert.True(done.Watched);
        Assert.Equal(0, done.Position);
        Assert.Equal(eps[1].Id, VideoLibrary.ResumeIn(lib.Episodes(key))!.Id);
        Assert.Equal(eps[1].Id, lib.NextEpisode(eps[0].Id)!.Id);
        Assert.Null(lib.NextEpisode(eps[2].Id));
        lib.SetWatched([eps[0].Id], false);
        Assert.False(lib.Get(eps[0].Id)!.Watched);
    }

    [Fact]
    public void Library_Views_Filter_Sort_And_Search()
    {
        var (t, lib, _) = Library();
        using var __ = t;
        Assert.Equal(4, lib.Count());
        var all = lib.Query(new VideoQuery());
        Assert.Equal(["Episode 1", "Episode 2", "Episode 10", "Single"], all.Select(v => v.Title));
        var e2 = all[1];
        lib.SetPosition(all[0].Id, 950, 1000); // watched
        lib.SetPosition(e2.Id, 100, 1000);     // in progress
        Assert.Equal(["Episode 1"], lib.Query(new VideoQuery(Filter: "watched")).Select(v => v.Title));
        Assert.Equal(["Episode 2"], lib.Query(new VideoQuery(Filter: "inprogress")).Select(v => v.Title));
        Assert.Equal(3, lib.Query(new VideoQuery(Filter: "unwatched")).Count);
        Assert.Equal(3, lib.Query(new VideoQuery(SeriesKey: e2.SeriesKey)).Count);
        Assert.Equal(["Single"], lib.Query(new VideoQuery(Search: "single")).Select(v => v.Title));
        Assert.Equal("Episode 2", lib.Query(new VideoQuery(Sort: "recent"))[0].Title);
        Assert.Equal(["Single", "Episode 2", "Episode 10", "Episode 1"], lib.Query(new VideoQuery(Sort: "title", Descending: true)).Select(v => v.Title));
    }

    [Fact]
    public void Video_Playlists_Keep_Their_Order_And_Survive_Rescans()
    {
        var (t, lib, f) = Library();
        using var __ = t;
        var key = lib.Series().Single(s => s.Name == "My Show").Key;
        var eps = lib.Episodes(key).Select(e => e.Id).ToList();
        var id = lib.CreatePlaylist("My Show", eps);
        Assert.Equal(eps, lib.Query(new VideoQuery(PlaylistId: id, Sort: "playlist")).Select(v => v.Id));
        lib.SetPlaylistItems(id, [eps[2], eps[0]]);
        Assert.Equal([eps[2], eps[0]], lib.PlaylistItems(id));
        lib.AddToPlaylist(id, [eps[1]]);
        Assert.Equal(3, lib.Playlists().Single().Count);
        lib.RenamePlaylist(id, "Watch later");
        Assert.Equal("Watch later", lib.Playlists().Single().Name);
        Assert.Throws<ArgumentException>(() => lib.CreatePlaylist("  "));
        lib.Scan(f);
        Assert.Equal([eps[2], eps[0], eps[1]], lib.PlaylistItems(id));
        lib.DeletePlaylist(id);
        Assert.Empty(lib.Playlists());
        Assert.Throws<ArgumentException>(() => lib.SetPlaylistItems(id, eps));
    }

    [Fact]
    public void Timestamped_Notes_Are_Kept_In_Order_And_Export_As_Markdown()
    {
        var (t, lib, _) = Library();
        using var __ = t;
        var v = lib.Series().Single(s => s.Name == "My Show").Key is var k ? lib.Episodes(k)[0] : null;
        var b = lib.AddNote(v!.Id, 754.2, "Boss fight starts");
        lib.AddNote(v.Id, 3.9, "Intro");
        Assert.Throws<ArgumentException>(() => lib.AddNote(v.Id, 1, "  "));
        Assert.Equal(["Intro", "Boss fight starts"], lib.Notes(v.Id).Select(n => n.Text));
        lib.UpdateNote(b, "Boss fight (phase 1)", 750);
        Assert.Equal(750, lib.Notes(v.Id)[1].Time);
        Assert.Equal(2, lib.Get(v.Id)!.NoteCount);
        Assert.Equal("### Episode 1\n\n- **0:03** Intro\n- **12:30** Boss fight (phase 1)\n", lib.NotesMarkdown(v.Id));
        Assert.Equal("1:02:03", VideoLibrary.Stamp(3723.9));
        lib.DeleteNote(b);
        Assert.Single(lib.Notes(v.Id));
    }
}

public class GalleryTests
{
    private static (TempDir, GalleryLibrary, long) Library()
    {
        var t = new TempDir();
        t.Copy("photo-exif.jpg", "Pics", "Wakacje 2023", "Plaża.jpg");
        t.Copy("plain.png", "Pics", "Wakacje 2023", "Mapa.png");
        t.Copy("plain.png", "Pics", "Okładka.png");
        t.Copy("plain.png", "Pics", "notes.txt");
        var lib = new GalleryLibrary(t.P("gallery.db"));
        var id = lib.AddFolder(t.P("Pics"));
        return (t, lib, id);
    }

    [Fact]
    public void Scan_Finds_Pictures_With_Size_Date_Taken_And_Albums_By_Folder()
    {
        var (t, lib, folder) = Library();
        using var _ = t;
        Assert.Equal((3, 3, 0), lib.Scan(folder));
        var all = lib.Query(new GalleryQuery(Sort: "name", Descending: false));
        Assert.Equal(["Mapa", "Okładka", "Plaża"], all.Select(i => i.Name));
        var beach = all.Single(i => i.Name == "Plaża");
        Assert.Equal((64, 48), (beach.Width, beach.Height));
        Assert.Equal(new DateTime(2023, 7, 14, 18, 30, 5), beach.TakenUtc.ToLocalTime()); // EXIF date, not the file date
        Assert.Equal("Wakacje 2023", beach.Album);
        Assert.Equal(["Pics", "Wakacje 2023"], lib.Albums().Select(a => a.Name));
        Assert.Equal(2, lib.Albums().Single(a => a.Name == "Wakacje 2023").Count);
        Assert.Equal(["Plaża"], lib.Query(new GalleryQuery(Search: "plaza")).Select(i => i.Name)); // without Polish letters too
        Assert.Equal("Plaża", lib.Query(new GalleryQuery(Sort: "taken", Descending: false))[0].Name); // 2023 before today's files
    }

    [Fact]
    public void Favourites_And_Slideshows_Survive_A_Rescan_And_Missing_Files()
    {
        var (t, lib, folder) = Library();
        using var _ = t;
        lib.Scan(folder);
        var ids = lib.Query(new GalleryQuery(Sort: "name", Descending: false)).Select(i => i.Id).ToList();
        lib.SetFavorite([ids[2]], true);
        var show = lib.CreateSlideshow("  Lato ", [ids[2], 999, ids[0]], "{\"interval\":5}");
        Assert.Equal(["Plaża", "Mapa"], lib.Query(new GalleryQuery(SlideshowId: show)).Select(i => i.Name));
        lib.AddItems(show, [ids[0], ids[1]]);
        Assert.Equal(3, lib.GetSlideshow(show)!.Count);
        Assert.Equal("Lato", lib.GetSlideshow(show)!.Name);
        Assert.Equal("{\"interval\":5}", lib.GetSlideshow(show)!.Settings);
        File.Delete(t.P("Pics", "Wakacje 2023", "Mapa.png"));
        Assert.Equal((2, 0, 1), lib.Scan(folder));
        Assert.Equal(["Plaża", "Okładka"], lib.Query(new GalleryQuery(SlideshowId: show)).Select(i => i.Name)); // a missing picture is skipped
        Assert.Equal(["Plaża"], lib.Query(new GalleryQuery(Filter: "favorites")).Select(i => i.Name));
        lib.UpdateSlideshow(show, null, "not json");
        Assert.Equal("{}", lib.GetSlideshow(show)!.Settings);
        Assert.ThrowsAny<ArgumentException>(() => lib.CreateSlideshow(" ", [], "{}"));
        lib.RemoveFolder(folder);
        Assert.Equal(0, lib.Count());
        Assert.Equal(0, lib.GetSlideshow(show)!.Count);
    }

    [Fact]
    public void Organizer_Renames_Numbers_Moves_And_Undoes_Without_Overwriting()
    {
        var (t, lib, folder) = Library();
        using var _ = t;
        lib.Scan(folder);
        var org = new GalleryOrganizer(lib);
        var byName = () => lib.Query(new GalleryQuery(Sort: "name", Descending: false)).ToDictionary(i => i.Name);
        var beach = byName()["Plaża"];
        lib.SetFavorite([beach.Id], true);
        var show = lib.CreateSlideshow("Lato", [beach.Id], "{}");

        org.Rename(beach.Id, "Zachód słońca");
        Assert.True(File.Exists(t.P("Pics", "Wakacje 2023", "Zachód słońca.jpg")));
        var moved = lib.Get(beach.Id)!;
        Assert.Equal("Zachód słońca", moved.Name);
        Assert.True(moved.Favorite); // favourite and slideshow place kept
        Assert.Equal([beach.Id], lib.Query(new GalleryQuery(SlideshowId: show)).Select(i => i.Id));
        File.WriteAllText(t.P("Pics", "Wakacje 2023", "Zajęte.jpg"), "taken");
        Assert.ThrowsAny<ArgumentException>(() => org.Rename(beach.Id, "Zajęte")); // never overwrites
        Assert.Equal("taken", File.ReadAllText(t.P("Pics", "Wakacje 2023", "Zajęte.jpg")));
        org.Undo();
        Assert.True(File.Exists(t.P("Pics", "Wakacje 2023", "Plaża.jpg")));

        // A series in the given order; swapping names between pictures works (two phases).
        var ids = new[] { byName()["Okładka"].Id };
        var album = org.CreateAlbum(t.P("Pics"), "Nowy album");
        org.Move(ids, album);
        Assert.True(File.Exists(t.P("Pics", "Nowy album", "Okładka.png")));
        Assert.Equal("Nowy album", lib.Get(ids[0])!.Album);
        File.WriteAllText(t.P("Pics", "Nowy album", "Mapa.png"), "taken");
        var mapa = byName()["Mapa"].Id;
        Assert.ThrowsAny<ArgumentException>(() => org.Move([mapa], album)); // never overwrites
        Assert.Equal("taken", File.ReadAllText(t.P("Pics", "Nowy album", "Mapa.png")));
        Assert.ThrowsAny<ArgumentException>(() => org.Move([mapa], t.Path)); // outside the Gallery folders

        var series = org.RenameSeries([mapa], "Wakacje");
        Assert.EndsWith("Wakacje 01.png", series[0].To);
        Assert.ThrowsAny<ArgumentException>(() => org.CreateAlbum(t.P("Pics"), "Nowy album"));
        Assert.ThrowsAny<ArgumentException>(() => org.CreateAlbum(t.P("Pics"), "../uciekam"));
    }

    [Fact]
    public void Overlapping_Folders_Share_Pictures_Instead_Of_Failing()
    {
        var (t, lib, child) = Library();
        using var _ = t;
        lib.Scan(child);
        var parent = lib.AddFolder(t.Path); // the folder above, added later
        var r = lib.Scan(parent);
        Assert.Equal(0, r.Added); // nothing doubled, nothing failed
        Assert.Equal(3, lib.Count());
    }
}

public class OverlapTests
{
    [Fact]
    public void Music_And_Video_Folders_That_Overlap_Scan_Without_Errors()
    {
        using var t = new TempDir();
        t.Copy("tone.mp3", "Music", "Rock", "a.mp3");
        t.Copy("clip.webm", "Video", "Show", "e01.webm");
        var music = new MusicLibrary(t.P("m.db"));
        music.ScanFolder(music.AddFolder(t.P("Music", "Rock")));
        var all = music.ScanFolder(music.AddFolder(t.P("Music")));
        Assert.Equal(0, all.Errors);
        Assert.Single(music.Query(new LibraryQuery()).Rows);
        var video = new VideoLibrary(t.P("v.db"));
        video.Scan(video.AddFolder(t.P("Video", "Show")));
        var r = video.Scan(video.AddFolder(t.P("Video")));
        Assert.Equal(0, r.Added);
        Assert.Equal(1, video.Count());
    }
}

public class GalleryManagerTests
{
    /// <summary>A minimal Photoshop file: header (2000×1000), no colour data, one image resource 1036 holding a JPEG.</summary>
    private static byte[] FakePsd(byte[] jpeg)
    {
        var ms = new MemoryStream();
        void BE(uint v, int n) { for (var i = n - 1; i >= 0; i--) ms.WriteByte((byte)(v >> (8 * i))); }
        ms.Write("8BPS"u8); BE(1, 2); ms.Write(new byte[6]); BE(3, 2); BE(1000, 4); BE(2000, 4); BE(8, 2); BE(3, 2);
        BE(0, 4); // colour mode data
        var res = new MemoryStream();
        void RBE(uint v, int n) { for (var i = n - 1; i >= 0; i--) res.WriteByte((byte)(v >> (8 * i))); }
        res.Write("8BIM"u8); RBE(1036, 2); res.WriteByte(0); res.WriteByte(0); // empty name, padded
        RBE((uint)(28 + jpeg.Length), 4); res.Write(new byte[28]); res.Write(jpeg);
        if (jpeg.Length % 2 == 1) res.WriteByte(0);
        BE((uint)res.Length, 4); ms.Write(res.ToArray());
        BE(0, 4); // layers
        return ms.ToArray();
    }

    [Fact]
    public void Psd_Files_Are_Listed_With_Size_And_Their_Embedded_Preview()
    {
        using var t = new TempDir();
        var jpeg = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "photo-exif.jpg"));
        Directory.CreateDirectory(t.P("Art"));
        File.WriteAllBytes(t.P("Art", "Okładka.psd"), FakePsd(jpeg));
        t.Copy("plain.png", "Art", "Szkic.png");
        File.WriteAllText(t.P("Art", "Projekt.afphoto"), "not really");
        var lib = new GalleryLibrary(t.P("g.db"));
        lib.Scan(lib.AddFolder(t.P("Art")));
        var psd = lib.Query(new GalleryQuery(Format: "PSD")).Single();
        Assert.Equal((2000, 1000), (psd.Width, psd.Height));
        Assert.Equal(jpeg, PsdPreview.Jpeg(psd.Path));
        Assert.Null(PsdPreview.Jpeg(t.P("Art", "Szkic.png")));
        Assert.Equal(["AFPHOTO", "PNG", "PSD"], lib.Query(new GalleryQuery(Sort: "type", Descending: false)).Select(i => i.Format));
        Assert.Equal(3, lib.Formats().Sum(f => f.Count));
        Assert.Single(lib.Query(new GalleryQuery(Search: "psd")));
        Assert.False(ImageFormats.IsWeb(psd.Path));
    }

    [Fact]
    public void Albums_Can_Be_Renamed_And_Pictures_Copied_Or_Moved_Anywhere()
    {
        using var t = new TempDir();
        t.Copy("photo-exif.jpg", "Pics", "Lato", "a.jpg");
        t.Copy("plain.png", "Pics", "Lato", "b.png");
        var lib = new GalleryLibrary(t.P("g.db"));
        lib.Scan(lib.AddFolder(t.P("Pics")));
        var org = new GalleryOrganizer(lib);
        var a = lib.Query(new GalleryQuery(Search: "a")).Single(i => i.Name == "a");
        var show = lib.CreateSlideshow("S", [a.Id], "{}");
        org.RenameAlbum(t.P("Pics", "Lato"), "Lato 2024");
        Assert.True(Directory.Exists(t.P("Pics", "Lato 2024")));
        Assert.Equal("Lato 2024", lib.Get(a.Id)!.Album);
        Assert.Equal([a.Id], lib.Query(new GalleryQuery(SlideshowId: show)).Select(i => i.Id));
        org.Undo();
        Assert.True(Directory.Exists(t.P("Pics", "Lato")));
        Assert.Equal("Lato", lib.Get(a.Id)!.Album);

        Directory.CreateDirectory(t.P("Elsewhere"));
        var copies = org.Copy([a.Id], t.P("Elsewhere"));
        Assert.True(File.Exists(t.P("Elsewhere", "a.jpg")) && File.Exists(t.P("Pics", "Lato", "a.jpg")));
        Assert.ThrowsAny<ArgumentException>(() => org.Copy([a.Id], t.P("Elsewhere"))); // never overwrites
        var b = lib.Query(new GalleryQuery()).Single(i => i.Name == "b");
        Assert.ThrowsAny<ArgumentException>(() => org.Move([b.Id], t.P("Elsewhere"))); // albums only, unless chosen anywhere
        org.Move([b.Id], t.P("Elsewhere"), anywhere: true);
        Assert.True(File.Exists(t.P("Elsewhere", "b.png")));
        Assert.Null(lib.Get(b.Id)); // it left the Gallery
        org.Undo();
        Assert.True(File.Exists(t.P("Pics", "Lato", "b.png")));
    }

    [Fact]
    public void Exact_Duplicates_Are_Found_And_Look_Alikes_By_Hash()
    {
        using var t = new TempDir();
        t.Copy("photo-exif.jpg", "P", "a.jpg");
        t.Copy("photo-exif.jpg", "P", "kopia", "a (copy).jpg");
        t.Copy("plain.png", "P", "c.png");
        var lib = new GalleryLibrary(t.P("g.db"));
        lib.Scan(lib.AddFolder(t.P("P")));
        var groups = GalleryDuplicates.Exact(lib.Query(new GalleryQuery()));
        Assert.Single(groups);
        Assert.Equal(["a", "a (copy)"], groups[0].Select(i => i.Name).OrderBy(x => x));

        var grey = new byte[72];
        for (var i = 0; i < 72; i++) grey[i] = (byte)(i * 3 % 251);
        var h1 = GalleryDuplicates.DHash(grey);
        grey[5] ^= 0xFF; // a small change
        var h2 = GalleryDuplicates.DHash(grey);
        Assert.InRange(GalleryDuplicates.Distance(h1, h2), 0, 3);
        var imgs = lib.Query(new GalleryQuery()).ToList();
        var similar = GalleryDuplicates.Similar([(imgs[0], h1), (imgs[1], h2), (imgs[2], ~h1)]);
        Assert.Single(similar);
        Assert.Equal(2, similar[0].Count);
    }

    [Fact]
    public void Pictures_Are_Packed_Into_A_Zip_With_Unique_Names()
    {
        using var t = new TempDir();
        var a = t.Copy("photo-exif.jpg", "x", "IMG.jpg");
        var b = t.Copy("photo-exif.jpg", "y", "IMG.jpg");
        var c = t.Copy("plain.png", "y", "Mapa.png");
        var zip = t.P("out", "Wakacje.zip");
        Directory.CreateDirectory(t.P("out"));
        Assert.Equal(3, GalleryZip.Create([a, b, c], zip));
        using var z = System.IO.Compression.ZipFile.OpenRead(zip);
        Assert.Equal(["IMG (2).jpg", "IMG.jpg", "Mapa.png"], z.Entries.Select(e => e.FullName).OrderBy(x => x, StringComparer.Ordinal));
        Assert.False(File.Exists(zip + ".noormd-tmp"));
    }
}

public class GalleryOrganizingTests
{
    [Fact]
    public void Stars_Labels_Tags_And_Months_Filter_The_Gallery()
    {
        using var t = new TempDir();
        t.Copy("photo-exif.jpg", "P", "plaza.jpg");
        t.Copy("plain.png", "P", "mapa.png");
        t.Copy("plain.png", "P", "szkic.png");
        var lib = new GalleryLibrary(t.P("g.db"));
        lib.Scan(lib.AddFolder(t.P("P")));
        var all = lib.Query(new GalleryQuery(Sort: "name", Descending: false));
        var (mapa, plaza, szkic) = (all[0], all[1], all[2]);
        lib.SetRating([plaza.Id], 5);
        lib.SetRating([mapa.Id, szkic.Id], 3);
        lib.SetRating([szkic.Id], 9); // clamped to 5
        lib.SetLabel([mapa.Id], "Green");
        Assert.ThrowsAny<ArgumentException>(() => lib.SetLabel([mapa.Id], "pink"));
        lib.AddTags([plaza.Id, mapa.Id], ["#Thornwake", "referencja"]);
        lib.AddTags([szkic.Id], ["thornwake"]); // same tag, written the first way
        Assert.Equal([("referencja", 2), ("Thornwake", 3)], lib.Tags());
        Assert.Equal(["plaza", "szkic"], lib.Query(new GalleryQuery(MinRating: 5, Sort: "name", Descending: false)).Select(i => i.Name));
        Assert.Equal(["mapa"], lib.Query(new GalleryQuery(Label: "green")).Select(i => i.Name));
        Assert.Equal(["mapa", "plaza"], lib.Query(new GalleryQuery(Tag: "REFERENCJA", Sort: "name", Descending: false)).Select(i => i.Name));
        Assert.Equal(2, lib.Query(new GalleryQuery(Search: "referencja")).Count); // tags are searchable
        Assert.Equal("mapa", lib.Query(new GalleryQuery(Sort: "rating")).Last().Name); // 3 stars after two with 5
        var got = lib.Get(mapa.Id)!;
        Assert.Equal((3, "green"), (got.Rating, got.Label));
        Assert.Equal(["referencja", "Thornwake"], got.Tags);
        lib.RemoveTag([mapa.Id], "thornwake");
        Assert.Equal(["referencja"], lib.Get(mapa.Id)!.Tags);
        Assert.Contains(lib.Months(), m => m.Month == "2023-07" && m.Count == 1); // the EXIF date
        Assert.Equal(["plaza"], lib.Query(new GalleryQuery(Month: "2023")).Select(i => i.Name));
        // An older library (before stars and tags) opens and gets the new columns.
        Assert.Equal(5, new GalleryLibrary(t.P("g.db")).Get(plaza.Id)!.Rating);
    }

    [Fact]
    public void Turning_Writes_A_Short_Orientation_In_Place_And_Fixes_Old_Long_Ones_And_Xmp()
    {
        using var t = new TempDir();
        var f = t.Copy("photo-exif.jpg", "a.jpg");
        var before = File.ReadAllBytes(f);
        Assert.Equal(6, PictureRotate.Jpeg(f, clockwise: true));
        var after = File.ReadAllBytes(f);
        Assert.Equal((6, 3), (JpegOrientation.Find(after)!.Value.Value, JpegOrientation.Find(after)!.Value.Type)); // a SHORT, as browsers need
        Assert.Equal(6, PictureRotate.Orientation(f));
        Assert.False(File.Exists(f + ".noormd-turn.jpg"));
        // Only the orientation entry changed (when the photo already had one): same length, a few bytes apart.
        Assert.Equal(3, PictureRotate.Jpeg(f, clockwise: true));
        var third = File.ReadAllBytes(f);
        Assert.Equal(after.Length, third.Length);
        Assert.True(after.Zip(third).Count(x => x.First != x.Second) <= 2);
        // An entry written as a LONG (as TagLib does) is read, and made a SHORT on the next turn.
        var e = JpegOrientation.Find(third)!.Value;
        third[e.Entry + (e.Big ? 3 : 2)] = 4; // type LONG
        if (e.Big) { third[e.Entry + 8] = 0; third[e.Entry + 9] = 0; third[e.Entry + 10] = 0; third[e.Entry + 11] = 3; } else { third[e.Entry + 8] = 3; third[e.Entry + 9] = 0; third[e.Entry + 10] = 0; third[e.Entry + 11] = 0; }
        File.WriteAllBytes(f, third);
        Assert.Equal(3, PictureRotate.Orientation(f));
        Assert.Equal(8, PictureRotate.Jpeg(f, clockwise: true));
        Assert.Equal((8, 3), (JpegOrientation.Find(File.ReadAllBytes(f))!.Value.Value, JpegOrientation.Find(File.ReadAllBytes(f))!.Value.Type));
        // XMP's tiff:Orientation follows (one digit for one digit).
        var xmp = Encoding.ASCII.GetBytes("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:Description tiff:Orientation=\"8\"/></x:xmpmeta>");
        var withXmp = new List<byte>(File.ReadAllBytes(f)[..2]) { 0xFF, 0xE1, (byte)((xmp.Length + 2) >> 8), (byte)((xmp.Length + 2) & 0xFF) };
        withXmp.AddRange(xmp);
        withXmp.AddRange(File.ReadAllBytes(f)[2..]);
        File.WriteAllBytes(f, withXmp.ToArray());
        Assert.Equal(1, PictureRotate.Jpeg(f, clockwise: true));
        Assert.Contains("tiff:Orientation=\"1\"", Encoding.ASCII.GetString(File.ReadAllBytes(f)));
        Assert.NotEqual(before, File.ReadAllBytes(f));
    }

    [Fact]
    public void Refreshing_Keeps_The_Date_Of_A_Picture_Without_One_And_Removed_Pictures_Leave_No_Tags()
    {
        using var t = new TempDir();
        t.Copy("plain.png", "P", "mapa.png");
        var lib = new GalleryLibrary(t.P("g.db"));
        var folder = lib.AddFolder(t.P("P"));
        lib.Scan(folder);
        var img = lib.Query(new GalleryQuery()).Single();
        File.SetLastWriteTimeUtc(img.Path, DateTime.UtcNow.AddDays(3)); // as turning it does
        Assert.Equal(img.TakenUtc, lib.Refresh(img.Id)!.TakenUtc);
        lib.AddTags([img.Id], ["stary"]);
        lib.RemoveFolder(folder);
        t.Copy("plain.png", "Q", "nowy.png");
        lib.Scan(lib.AddFolder(t.P("Q")));
        Assert.Empty(lib.Query(new GalleryQuery()).Single().Tags!); // not the removed picture's tag, even with its id
        Assert.Empty(lib.Tags());
    }

    [Fact]
    public void Converting_Picks_Formats_Sizes_And_Free_Names()
    {
        Assert.Equal(".jpg", PictureConvert.Extension(@"C:\a\x.JPEG", "keep"));
        Assert.Equal(".png", PictureConvert.Extension("x.webp", "keep")); // may be see-through
        Assert.Equal(".jpg", PictureConvert.Extension("x.heic", "keep"));
        Assert.Equal(".tif", PictureConvert.Extension("x.tiff", "keep"));
        Assert.Equal(".png", PictureConvert.Extension("x.jpg", "png"));
        Assert.Throws<ArgumentException>(() => PictureConvert.Extension("x.jpg", "psd"));
        Assert.Equal((1920, 1440), PictureConvert.Fit(4000, 3000, 1920));
        Assert.Equal((1080, 1920), PictureConvert.Fit(3000, 5333, 1920));
        Assert.Equal((800, 600), PictureConvert.Fit(800, 600, 1920)); // never made bigger
        Assert.Equal((800, 600), PictureConvert.Fit(800, 600, 0));
        var o = PictureConvert.Clean(new ConvertOptions("jpg", 5, 150, " -web?. "));
        Assert.Equal((16, 100, " -web"), (o.MaxSide, o.Quality, o.Suffix));
        Assert.Throws<ArgumentException>(() => PictureConvert.Clean(new ConvertOptions("gif")));
        using var t = new TempDir();
        File.WriteAllText(t.P("plaża.jpg"), "x");
        var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Assert.Equal(t.P("plaża (2).jpg"), PictureConvert.FreePath(t.Path, "plaża", ".jpg", taken));
        Assert.Equal(t.P("plaża (3).jpg"), PictureConvert.FreePath(t.Path, "plaża", ".jpg", taken)); // not the one just given out
        Assert.Equal(t.P("mapa.png"), PictureConvert.FreePath(t.Path, "mapa", ".png", taken));
    }

    [Fact]
    public void Jpeg_Photos_Turn_By_Their_Orientation_Without_Touching_The_Picture()
    {
        using var t = new TempDir();
        var f = t.Copy("photo-exif.jpg", "a.jpg");
        Assert.Equal(1, PictureRotate.Orientation(f));
        Assert.Equal(6, PictureRotate.Jpeg(f, clockwise: true));
        Assert.Equal(6, PictureRotate.Orientation(f));
        Assert.Equal(3, PictureRotate.Jpeg(f, clockwise: true));
        Assert.Equal(6, PictureRotate.Jpeg(f, clockwise: false));
        Assert.Equal(1, PictureRotate.Jpeg(f, clockwise: false));
        Assert.Equal(new DateTime(2023, 7, 14, 18, 30, 5), GalleryLibrary.ReadInfo(f, DateTime.UtcNow).TakenUtc.ToLocalTime()); // other EXIF kept
        Assert.False(PictureRotate.CanRotateLosslessly("x.png"));
        // The Gallery reads the size again after a turn: width and height swap.
        var lib = new GalleryLibrary(t.P("g.db"));
        lib.Scan(lib.AddFolder(Path.GetDirectoryName(f)!));
        var img = lib.Query(new GalleryQuery()).Single();
        PictureRotate.Jpeg(f, clockwise: true);
        var turned = lib.Refresh(img.Id)!;
        Assert.Equal((img.Height, img.Width), (turned.Width, turned.Height));
    }
}

