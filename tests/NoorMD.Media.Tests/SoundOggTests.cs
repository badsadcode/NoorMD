using NoorMD.Media;
using NVorbis;
using Xunit;

namespace NoorMD.Media.Tests;

public class SoundOggTests
{
    private static (float[] L, float[] R, int Rate, VorbisReader Reader) Decode(byte[] ogg)
    {
        var reader = new VorbisReader(new MemoryStream(ogg), true);
        var all = new List<float>();
        var buf = new float[4096];
        int n;
        while ((n = reader.ReadSamples(buf, 0, buf.Length)) > 0) all.AddRange(buf.AsSpan(0, n).ToArray());
        var l = new float[all.Count / 2]; var r = new float[all.Count / 2];
        for (var i = 0; i < l.Length; i++) { l[i] = all[2 * i]; r[i] = all[2 * i + 1]; }
        return (l, r, reader.SampleRate, reader);
    }

    [Theory]
    [InlineData(48000, 0.3)]
    [InlineData(48000, 0.5)]
    [InlineData(44100, 0.9)]
    [InlineData(44100, 1.0)] // asked for more than 0.9: kept at 0.9, where it still lines up
    public void A_Loop_Comes_Back_Sample_For_Sample_In_Length_And_Place(int rate, double quality)
    {
        var song = SongTemplates.Make("arcade")!;
        song.LoopStart = 0; song.LoopEnd = 2;
        var render = SequencerEngine.Render(song, rate, loop: true);
        var ogg = SoundOgg.Encode(render, quality, "Arcade", loop: true);
        var (l, _, sr, reader) = Decode(ogg);
        Assert.Equal(rate, sr);
        // Its length, as the stream declares it (what players and engines use), is the render's exactly.
        Assert.Equal(render.Left.Length, reader.TotalSamples);
        Assert.InRange(l.Length, render.Left.Length, render.Left.Length + 1024);
        // Lossy, but in place: it matches the original best with no shift at all, and closely.
        double Corr(int shift)
        {
            double ab = 0, aa = 0, bb = 0;
            for (var i = 2048; i < render.Left.Length - 2048; i++) { double a = l[i + shift], b = render.Left[i]; ab += a * b; aa += a * a; bb += b * b; }
            return ab / Math.Sqrt(aa * bb);
        }
        var inPlace = Corr(0);
        Assert.True(inPlace > 0.9, $"correlation {inPlace:0.000}");
        foreach (var shift in new[] { -1024, -128, -1, 1, 128, 1024 }) Assert.True(Corr(shift) < inPlace, $"shift {shift}");
        Assert.Contains("LOOPSTART=0", reader.Tags.All.SelectMany(t => t.Value.Select(v => $"{t.Key}={v}")));
        Assert.Contains($"LOOPLENGTH={render.Left.Length}", reader.Tags.All.SelectMany(t => t.Value.Select(v => $"{t.Key}={v}")));
        Assert.Equal(ogg, SoundOgg.Encode(render, quality, "Arcade", loop: true)); // the same song makes the same file
        Assert.True(ogg.Length < render.Left.Length * 4 / 5); // much smaller than a 16-bit WAV
    }
}

public class ConnectedBenchTests
{
    [Fact]
    public void An_Exported_Ogg_Goes_Into_The_Music_Library_With_Its_Length_And_Title()
    {
        var dir = Path.Combine(Path.GetTempPath(), "noormd-ogg-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var song = SongTemplates.Make("adaptive")!;
            var render = SequencerEngine.Render(song, 48000, loop: true);
            var path = Path.Combine(dir, "Adaptive_adventure_loop.ogg");
            File.WriteAllBytes(path, SoundOgg.Encode(render, 0.5, "Adaptive adventure", loop: true));
            var lib = new MusicLibrary(Path.Combine(dir, "library.db"));
            var id = lib.AddFile(path);
            var row = lib.Get(id)!;
            Assert.Equal("Adaptive adventure", row.Title);
            Assert.InRange(row.Duration, render.Seconds - 0.05, render.Seconds + 0.05);
            Assert.Equal(id, lib.AddFile(path)); // added once
            var playlist = lib.CreatePlaylist("Made in NoorMD");
            lib.AddToPlaylist(playlist, [id]);
            Assert.Equal([id], lib.PlaylistTrackIds(playlist));
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); try { Directory.Delete(dir, true); } catch (IOException) { } }
    }
}
