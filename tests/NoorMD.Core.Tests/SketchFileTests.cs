using System.IO.Compression;
using NoorMD.Core.Sketch;
using Xunit;

namespace NoorMD.Core.Tests;

public class SketchFileTests
{
    // 2×2 RGBA PNG.
    private static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwnwEIGP4zMDAwAAAp9gP9k+8chQAAAABJRU5ErkJggg==");

    [Fact]
    public void Save_And_Load_Return_The_Exact_Image_Bytes()
    {
        using var t = new TempDir();
        var path = t.File("idea.noorsketch");
        SketchFile.Save(path, Png, "transparent");
        var (png, m) = SketchFile.Load(path);
        Assert.Equal(Png, png);
        Assert.Equal((2, 2, "transparent", 1), (m.Width, m.Height, m.Background, m.Version));
        // A plain ZIP anyone can inspect.
        using var zip = ZipFile.OpenRead(path);
        Assert.Equal(["image.png", "manifest.json"], zip.Entries.Select(e => e.FullName).OrderBy(x => x));
    }

    [Fact]
    public void Rejects_Other_Files_Newer_Formats_And_Mismatched_Images()
    {
        using var t = new TempDir();
        var notZip = t.File("a.noorsketch");
        File.WriteAllText(notZip, "hello");
        Assert.ThrowsAny<InvalidDataException>(() => SketchFile.Load(notZip));

        var newer = t.File("b.noorsketch");
        using (var zip = ZipFile.Open(newer, ZipArchiveMode.Create))
        {
            using (var w = new StreamWriter(zip.CreateEntry("manifest.json").Open())) w.Write("""{"format":"noorsketch","version":99,"width":2,"height":2,"background":"white","modifiedUtc":"2026-01-01T00:00:00Z","app":"x"}""");
            using (var s = zip.CreateEntry("image.png").Open()) s.Write(Png);
        }
        Assert.Contains("newer", Assert.Throws<InvalidDataException>(() => SketchFile.Load(newer)).Message);

        var mismatch = t.File("c.noorsketch");
        using (var zip = ZipFile.Open(mismatch, ZipArchiveMode.Create))
        {
            using (var w = new StreamWriter(zip.CreateEntry("manifest.json").Open())) w.Write("""{"format":"noorsketch","version":1,"width":5,"height":2,"background":"white","modifiedUtc":"2026-01-01T00:00:00Z","app":"x"}""");
            using (var s = zip.CreateEntry("image.png").Open()) s.Write(Png);
        }
        Assert.ThrowsAny<InvalidDataException>(() => SketchFile.Load(mismatch));
        Assert.ThrowsAny<InvalidDataException>(() => SketchFile.Save(t.File("d.noorsketch"), [1, 2, 3], "white"));
    }

    [Theory]
    [InlineData(1280, 720, true)]
    [InlineData(4096, 4096, true)]
    [InlineData(8192, 2048, true)]
    [InlineData(8193, 10, false)]
    [InlineData(5000, 5000, false)]
    [InlineData(0, 10, false)]
    public void Canvas_Size_Limits(int w, int h, bool ok) => Assert.Equal(ok, SketchFile.SizeProblem(w, h) == null);
}
