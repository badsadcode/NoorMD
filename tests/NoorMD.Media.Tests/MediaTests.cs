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
