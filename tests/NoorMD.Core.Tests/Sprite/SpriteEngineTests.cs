using System.Text.Json;
using NoorMD.Core.Sprite;
using Xunit;

namespace NoorMD.Core.Tests.Sprite;

/// <summary>NoorSprite's sheets for Unity (.meta and .anim) and Unreal Paper2D (JSON).</summary>
public class SpriteEngineTests
{
    private static (SpriteImage Sheet, List<SpriteExport.SheetFrame> Frames) Sheet()
    {
        // Two 8 × 8 frames in a row, 100 and 250 ms.
        var frames = new List<SpriteImage> { new(8, 8, Filled(8, 8), 100), new(8, 8, Filled(8, 8), 250) };
        return SpriteExport.Pack(frames, "row", 0);
    }

    private static byte[] Filled(int w, int h) { var px = new byte[w * h * 4]; for (var i = 3; i < px.Length; i += 4) px[i] = 255; return px; }

    [Fact]
    public void Unity_gets_its_sprites_measured_from_the_bottom_with_pivot_and_border()
    {
        var (sheet, frames) = Sheet();
        var slices = new List<SpriteSlice> { new() { Name = "body", X = 0, Y = 0, Width = 8, Height = 8, Nine = true, CenterX = 2, CenterY = 1, CenterWidth = 4, CenterHeight = 5, HasPivot = true, PivotX = 4, PivotY = 8 } };
        var meta = UnitySprite.Meta("hero", sheet, frames, slices, 16);
        Assert.StartsWith("fileFormatVersion: 2\nguid: " + UnitySprite.Guid("hero"), meta);
        Assert.Contains("spriteMode: 2", meta);
        Assert.Contains("filterMode: 0", meta);
        Assert.Contains("      name: hero_1\n      rect:\n        serializedVersion: 2\n        x: 8\n        y: 0\n        width: 8\n        height: 8\n", meta);
        Assert.Contains("pivot: {x: 0.5, y: 0}", meta);                   // the pivot at the bottom middle
        Assert.Contains("border: {x: 2, y: 2, z: 2, w: 1}", meta);         // left, bottom, right, top
        Assert.Contains($"internalID: {UnitySprite.InternalId("hero", 1)}", meta);
        Assert.Equal(UnitySprite.Guid("hero"), UnitySprite.Guid("hero"));
    }

    [Fact]
    public void A_unity_clip_swaps_the_sprites_for_their_times()
    {
        var (_, frames) = Sheet();
        var anim = UnitySprite.Anim("walk", "hero", [0, 1], frames, true);
        Assert.Contains("m_Name: walk", anim);
        Assert.Contains($"    - time: 0\n      value: {{fileID: {UnitySprite.InternalId("hero", 0)}, guid: {UnitySprite.Guid("hero")}, type: 3}}", anim);
        Assert.Contains($"    - time: 0.1\n      value: {{fileID: {UnitySprite.InternalId("hero", 1)}", anim);
        Assert.Contains("m_StopTime: 0.35", anim);
        Assert.Contains("attribute: m_Sprite", anim);
        Assert.Contains("m_LoopTime: 1", anim);
    }

    [Fact]
    public void Paper2d_gets_texturepackers_form_with_a_pivot()
    {
        var (sheet, frames) = Sheet();
        var json = JsonDocument.Parse(Paper2D.Json("hero", "hero.png", sheet, frames, [new SpriteSlice { HasPivot = true, PivotX = 4, PivotY = 8 }])).RootElement;
        var f1 = json.GetProperty("frames").GetProperty("hero_1.png");
        Assert.Equal(8, f1.GetProperty("frame").GetProperty("x").GetInt32());
        Assert.Equal(0.5, f1.GetProperty("pivot").GetProperty("x").GetDouble());
        Assert.Equal(1.0, f1.GetProperty("pivot").GetProperty("y").GetDouble());
        Assert.Equal("paper2d", json.GetProperty("meta").GetProperty("target").GetString());
        Assert.Equal("hero.png", json.GetProperty("meta").GetProperty("image").GetString());
        Assert.Equal(16, json.GetProperty("meta").GetProperty("size").GetProperty("w").GetInt32());
    }

    [Fact]
    public void A_slice_that_moves_keeps_its_keys_in_every_file()
    {
        var px = new byte[4 * 4 * 4]; px[3] = 255;
        var doc = new SpriteDoc
        {
            Width = 4, Height = 4, Layers = [new SpriteLayer { Id = "a", Name = "A" }], Frames = [new SpriteFrame(), new SpriteFrame(), new SpriteFrame()],
            Cels = [new SpriteCel { Layer = "a", Frame = 0, Width = 4, Height = 4 }.WithPixels(px)],
            Slices = [new SpriteSlice { Name = "hit", X = 0, Y = 0, Width = 2, Height = 2, HasPivot = true, PivotX = 1, PivotY = 1, Keys = [new() { Frame = 0, X = 0, Y = 0, Width = 2, Height = 2 }, new() { Frame = 2, X = 2, Y = 1, Width = 1, Height = 3 }] }],
        }.Checked();
        Assert.Equal((0, 0, 2, 2), doc.Slices[0].At(1));
        Assert.Equal((2, 1, 1, 3), doc.Slices[0].At(2));
        var ase = AsepriteFile.Read(AsepriteFile.Write(doc)).Sprite.Slices[0];
        Assert.Equal((2, 1, 1, 3), ase.At(2));
        Assert.Equal((1, 1), (ase.PivotX, ase.PivotY));
        Assert.Equal((2, 1, 1, 3), SpriteFile.FromBytes(SpriteFile.ToBytes(doc)).Slices[0].At(2));
        var json = JsonDocument.Parse(SpriteExport.Sheet([new SpriteImage(4, 4, px, 100)], "row", 0, "s", [], doc.Layers, 2, doc.Slices).Json).RootElement;
        var keys = json.GetProperty("meta").GetProperty("slices")[0].GetProperty("keys");
        Assert.Equal(2, keys.GetArrayLength());
        Assert.Equal(2, keys[1].GetProperty("frame").GetInt32());
        Assert.Equal(4, keys[1].GetProperty("bounds").GetProperty("x").GetInt32()); // at the export's scale
    }
}
