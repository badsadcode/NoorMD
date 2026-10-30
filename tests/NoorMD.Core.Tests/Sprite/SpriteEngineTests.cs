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

    [Fact]
    public void The_app_composes_a_frame_for_thumbnails_and_keeps_frame_sounds()
    {
        // Two layers: red at (0,0) under a half see-through blue layer in a hidden-free group; a reference layer left out.
        byte[] One(byte r, byte g, byte b) => [r, g, b, 255, 0, 0, 0, 0];
        var doc = new SpriteDoc
        {
            Width = 2, Height = 1, Frames = [new SpriteFrame { Sound = new SpriteSound { Path = @"C:\s\step.wav", Name = "step.wav" } }],
            Layers = [new SpriteLayer { Id = "ref", Name = "R", Reference = true }, new SpriteLayer { Id = "a", Name = "A" }, new SpriteLayer { Id = "g", Name = "G", Kind = "group", Opacity = 128 }, new SpriteLayer { Id = "b", Name = "B", Parent = "g" }],
            Cels =
            [
                new SpriteCel { Layer = "ref", Frame = 0, Width = 2, Height = 1 }.WithPixels([0, 255, 0, 255, 0, 255, 0, 255]),
                new SpriteCel { Layer = "a", Frame = 0, Width = 2, Height = 1 }.WithPixels(One(255, 0, 0)),
                new SpriteCel { Layer = "b", Frame = 0, Width = 2, Height = 1 }.WithPixels(One(0, 0, 255)),
            ],
        }.Checked();
        var px = SpriteRender.Frame(doc, 0);
        Assert.Equal(255, px[3]);
        Assert.InRange(px[0], 120, 135);   // red under half blue (the group's opacity)
        Assert.InRange(px[2], 120, 135);
        Assert.Equal(0, px[7]);            // the reference layer isn't there
        var (w, h, big) = SpriteRender.Fit(2, 1, px, 64);
        Assert.Equal((64, 32), (w, h));    // grown by a whole step (32×)
        Assert.Equal(px[0], big[0]);
        var path = Path.Combine(Path.GetTempPath(), $"noorsprite-{Guid.NewGuid():N}.noorsprite");
        try
        {
            SpriteFile.Save(path, doc);
            Assert.Equal((64, 32), SpritePng.Decode(SpriteRender.Thumbnail(path, 64)!) is var (tw, th, _) ? (tw, th) : (0, 0));
            Assert.Equal("step.wav", SpriteFile.Load(path).Frames[0].Sound!.Name);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void A_note_plays_a_sprite_as_a_gif_or_shows_one_frame()
    {
        var px = new byte[2 * 2 * 4]; px[3] = 255;
        var doc = new SpriteDoc
        {
            Width = 2, Height = 2, Layers = [new SpriteLayer { Id = "a", Name = "A" }], Frames = [new SpriteFrame { Duration = 100 }, new SpriteFrame { Duration = 200 }, new SpriteFrame()],
            Tags = [new SpriteTag { Name = "walk", From = 1, To = 2 }],
            Cels = [new SpriteCel { Layer = "a", Frame = 0, Width = 2, Height = 2 }.WithPixels(px)],
        }.Checked();
        var path = Path.Combine(Path.GetTempPath(), $"noorsprite-{Guid.NewGuid():N}.noorsprite");
        try
        {
            SpriteFile.Save(path, doc);
            var all = SpriteRender.ForNote(path, 64, null, null)!.Value;
            Assert.Equal("image/gif", all.ContentType);
            Assert.Equal("GIF89a", System.Text.Encoding.ASCII.GetString(all.Bytes, 0, 6));
            Assert.Equal(64, BitConverter.ToUInt16(all.Bytes, 6));                       // grown to fit
            var one = SpriteRender.ForNote(path, 64, null, 0)!.Value;
            Assert.Equal("image/png", one.ContentType);
            Assert.Equal(255, SpritePng.Decode(one.Bytes).Rgba[3]);
            Assert.Equal("image/gif", SpriteRender.ForNote(path, 64, "walk", null)!.Value.ContentType);
            Assert.Null(SpriteRender.ForNote(path + ".none", 64, null, null));
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Bones_and_poses_are_kept_as_the_page_sends_them()
    {
        var json = "{\"width\":4,\"height\":4,\"layers\":[{\"id\":\"a\",\"name\":\"Arm\",\"bone\":\"B1\"},{\"id\":\"b\",\"name\":\"Body\",\"bone\":\"nope\"}],"
            + "\"frames\":[{\"duration\":100},{\"duration\":100,\"pose\":{\"B1\":{\"a\":90,\"dx\":1,\"dy\":0},\"gone\":{\"a\":5}}}],"
            + "\"bones\":[{\"id\":\"B1\",\"name\":\"Arm\",\"x\":1,\"y\":1,\"tipX\":3,\"tipY\":1},{\"id\":\"B2\",\"name\":\"Hand\",\"parent\":\"B1\",\"x\":3,\"y\":1,\"tipX\":4,\"tipY\":1}],\"cels\":[]}";
        var doc = SpriteFile.FromBytes(SpriteFile.ToBytes(SpriteDoc.FromJson(json)));
        Assert.Equal(["B1", "B2"], doc.Bones.Select(b => b.Id));
        Assert.Equal("B1", doc.Bones[1].Parent);
        Assert.Equal("B1", doc.Layers[0].Bone);
        Assert.Null(doc.Layers[1].Bone);                      // a bone that isn't there
        Assert.Equal(90, doc.Frames[1].Pose!["B1"].A);
        Assert.False(doc.Frames[1].Pose!.ContainsKey("gone"));
    }

    [Fact]
    public void Normal_maps_sit_where_the_frames_do_and_unity_is_told_of_them()
    {
        var (sheet, frames) = Sheet();
        var normals = new List<SpriteImage> { new(8, 8, Enumerable.Repeat((byte)1, 256).ToArray(), 0), new(8, 8, Enumerable.Repeat((byte)2, 256).ToArray(), 0) };
        var n = SpriteExport.PlaceLike(sheet, frames, normals);
        Assert.Equal((16, 8), (n.Width, n.Height));
        Assert.Equal(1, n.Rgba[0]);
        Assert.Equal(2, n.Rgba[8 * 4]);                           // the second frame's place
        var meta = UnitySprite.Meta("hero", sheet, frames, [], 16, "hero_n");
        Assert.Contains($"secondaryTextures:\n    - name: _NormalMap\n      texture: {{fileID: 2800000, guid: {UnitySprite.Guid("hero_n")}, type: 3}}", meta);
        Assert.Contains("sRGBTexture: 0", UnitySprite.PlainMeta("hero_n"));
    }

    [Fact]
    public void A_bitmap_font_measures_its_letters_and_writes_bmfont()
    {
        // Cells 4 × 4: "A" drawn 2 wide at x 1–2, " " empty, "B" 4 wide.
        var px = new byte[12 * 4 * 4];
        foreach (var x in new[] { 1, 2, 8, 9, 10, 11 }) px[(1 * 12 + x) * 4 + 3] = 255;
        var font = new SpriteFont { Characters = "A B", CellWidth = 4, CellHeight = 4, Spacing = 1 };
        var g = BitmapFont.Glyphs(12, 4, px, font);
        Assert.Equal([(65, 1, 2, 3), (32, 4, 2, 3), (66, 8, 4, 5)], g.Select(x => (x.Code, x.X, x.Width, x.Advance)));
        var fnt = BitmapFont.Fnt("Pix", "pix.png", 12, 4, g, font);
        Assert.Contains("page id=0 file=\"pix.png\"", fnt);
        Assert.Contains("char id=66 x=8 y=0 width=4 height=4 xoffset=0 yoffset=0 xadvance=5", fnt);
        font.Proportional = false;
        Assert.All(BitmapFont.Glyphs(12, 4, px, font), x => Assert.Equal(4, x.Advance));
    }
}
