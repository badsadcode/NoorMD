using NoorMD.Core.Sprite;
using Xunit;

namespace NoorMD.Core.Tests.Sprite;

/// <summary>NoorSprite's indexed colour mode in files: .aseprite at 8 bits, palette PNGs, colour cycling kept.</summary>
public class SpriteIndexedTests
{
    private static SpriteDoc Sample(string mode)
    {
        // 3 × 1: red, clear, blue — red and blue in the palette (with an opaque black first, as many palettes have).
        var px = new byte[] { 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255 };
        return new SpriteDoc
        {
            Width = 3, Height = 1, ColorMode = mode, Palette = ["#000000ff", "#ff0000ff", "#0000ffff"],
            Cycle = new SpriteCycle { From = 1, To = 2, Fps = 6 },
            Layers = [new SpriteLayer { Id = "a", Name = "A" }], Frames = [new SpriteFrame()],
            Cels = [new SpriteCel { Layer = "a", Frame = 0, Width = 3, Height = 1 }.WithPixels(px)],
        }.Checked();
    }

    [Fact]
    public void An_indexed_sprite_goes_to_aseprite_at_8_bits_and_comes_back_the_same()
    {
        var bytes = AsepriteFile.Write(Sample("indexed"));
        Assert.Equal(8, BitConverter.ToUInt16(bytes, 12));
        Assert.Equal(3, bytes[28]); // a clear entry added after the three colours
        var back = AsepriteFile.Read(bytes).Sprite;
        Assert.Equal("indexed", back.ColorMode);
        Assert.Equal(new byte[] { 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255 }, back.Cels[0].Pixels());
        Assert.Equal("#000000ff", back.Palette[0]);
    }

    [Fact]
    public void A_pixel_off_the_palette_writes_rgba_instead()
    {
        var doc = Sample("indexed");
        doc.Palette = ["#ff0000ff"];
        Assert.Equal(32, BitConverter.ToUInt16(AsepriteFile.Write(doc), 12));
        Assert.Equal(32, BitConverter.ToUInt16(AsepriteFile.Write(Sample("rgba")), 12));
    }

    [Fact]
    public void A_palette_png_is_exact_and_falls_back_when_it_must()
    {
        var doc = Sample("indexed");
        var px = doc.Cels[0].Pixels();
        var png = SpritePng.EncodeIndexed(3, 1, px, doc.Palette)!;
        Assert.Equal(3, png[25]); // colour type 3: a palette
        Assert.Equal(px, SpritePng.Decode(png).Rgba);
        Assert.Null(SpritePng.EncodeIndexed(3, 1, px, ["#ff0000ff"]));
        Assert.Equal(6, SpritePng.EncodeBest(3, 1, px, ["#ff0000ff"])[25]);
    }

    [Fact]
    public void Colour_cycling_is_kept_in_the_noorsprite_file()
    {
        var back = SpriteFile.FromBytes(SpriteFile.ToBytes(Sample("indexed")));
        Assert.Equal("indexed", back.ColorMode);
        Assert.Equal((1, 2, 6), (back.Cycle!.From, back.Cycle.To, back.Cycle.Fps));
    }
}
