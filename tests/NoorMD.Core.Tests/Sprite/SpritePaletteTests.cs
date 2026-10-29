using System.Text;
using NoorMD.Core.Sprite;
using Xunit;

namespace NoorMD.Core.Tests.Sprite;

/// <summary>NoorSprite stage 2 in the app: palette files and linked cels.</summary>
public class SpritePaletteTests
{
    [Fact]
    public void Palettes_are_read_and_written_in_the_usual_formats()
    {
        var gpl = "GIMP Palette\nName: Test\nColumns: 4\n#\n  0   0   0\tBlack\n255 0 77 Red\n 41 173 255\n";
        Assert.Equal(["#000000ff", "#ff004dff", "#29adffff"], SpritePalette.Read(Encoding.UTF8.GetBytes(gpl), ".gpl"));
        var jasc = "JASC-PAL\r\n0100\r\n2\r\n255 255 255\r\n10 20 30\r\n";
        Assert.Equal(["#ffffffff", "#0a141eff"], SpritePalette.Read(Encoding.UTF8.GetBytes(jasc), ".pal"));
        Assert.Equal(["#1a1c2cff", "#5d275d80"], SpritePalette.Read(Encoding.UTF8.GetBytes("1a1c2c\n#5d275d80\n\n"), ".hex"));
        // A Microsoft RIFF palette.
        var riff = new List<byte>(); riff.AddRange("RIFF"u8.ToArray()); riff.AddRange(BitConverter.GetBytes(4 + 8 + 4 + 8)); riff.AddRange("PAL "u8.ToArray());
        riff.AddRange("data"u8.ToArray()); riff.AddRange(BitConverter.GetBytes(4 + 8)); riff.AddRange([0, 3, 2, 0, 1, 2, 3, 0, 250, 251, 252, 0]);
        Assert.Equal(["#010203ff", "#fafbfcff"], SpritePalette.Read(riff.ToArray(), ".pal"));
        Assert.Throws<InvalidDataException>(() => SpritePalette.Read("hello there"u8.ToArray(), ".txt"));
        // Written and read back.
        List<string> pal = ["#000000ff", "#ff004dff", "#29adffff"];
        foreach (var ext in new[] { ".gpl", ".pal", ".hex" }) Assert.Equal(pal, SpritePalette.Read(SpritePalette.Write(pal, ext), ext));
        Assert.StartsWith("GIMP Palette\nName: Mine", Encoding.UTF8.GetString(SpritePalette.Write(pal, ".gpl", "Mine")));
    }

    [Fact]
    public void Linked_cels_are_kept_in_both_files()
    {
        var doc = SpriteTests.Sample();
        // The hero's frames 1 and 2 linked (the same picture).
        var c1 = doc.Cel("hero", 1)!; var c2 = doc.Cel("hero", 2)!;
        c1.Link = "walk1"; c2.Link = "walk1"; c2.X = c1.X; c2.Y = c1.Y; c2.Opacity = c1.Opacity; c2.WithPixels((byte[])c1.Pixels().Clone());
        Assert.Equal("walk1", SpriteFile.FromBytes(SpriteFile.ToBytes(doc)).Cel("hero", 2)!.Link);
        var file = AsepriteFile.Write(doc);
        var (back, _) = AsepriteFile.Read(file);
        var b1 = back.Cel(back.Layers[1].Id, 1)!; var b2 = back.Cel(back.Layers[1].Id, 2)!;
        Assert.NotNull(b1.Link);
        Assert.Equal(b1.Link, b2.Link);
        Assert.Equal(b1.Pixels(), b2.Pixels());
        Assert.Null(back.Cel(back.Layers[1].Id, 0)!.Link);
        Assert.True(file.Length < AsepriteFile.Write(SpriteTests.Sample()).Length + 64); // the linked frame isn't stored twice
        Assert.Null(new SpriteDoc { Layers = [new SpriteLayer { Id = "a" }], Frames = [new SpriteFrame()], Cels = [new SpriteCel { Layer = "a", Width = 1, Height = 1, Link = "../bad" }] }.Checked().Cels[0].Link);
    }
}
