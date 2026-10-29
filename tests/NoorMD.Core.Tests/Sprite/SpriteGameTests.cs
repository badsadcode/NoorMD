using System.Text.Json;
using NoorMD.Core.Sprite;
using Xunit;

namespace NoorMD.Core.Tests.Sprite;

/// <summary>NoorSprite stage 3: slices, reference layers, packed sheets, JSON forms and Godot's SpriteFrames.</summary>
public class SpriteGameTests
{
    private static SpriteImage Frame(int w, int h, Func<int, int, bool> on, byte red, int duration) =>
        new(w, h, Enumerable.Range(0, w * h).SelectMany(i => on(i % w, i / w) ? new byte[] { red, 10, 20, 255 } : new byte[4]).ToArray(), duration);

    [Fact]
    public void Slices_and_reference_layers_are_kept_in_both_files()
    {
        var doc = SpriteTests.Sample();
        doc.Slices = [new SpriteSlice { Name = "button", X = 1, Y = 2, Width = 10, Height = 8, Nine = true, CenterX = 3, CenterY = 3, CenterWidth = 4, CenterHeight = 2, HasPivot = true, PivotX = 5, PivotY = 7, Color = "#ff0000ff" },
            new SpriteSlice { Name = "hitbox", X = 4, Y = 4, Width = 6, Height = 6 }];
        doc.Layers[0].Reference = true;
        doc.Checked();
        foreach (var back in new[] { SpriteFile.FromBytes(SpriteFile.ToBytes(doc)), AsepriteFile.Read(AsepriteFile.Write(doc)).Sprite })
        {
            Assert.Equal(["button", "hitbox"], back.Slices.Select(s => s.Name));
            var b = back.Slices[0];
            Assert.Equal((1, 2, 10, 8, true, 3, 3, 4, 2, true, 5, 7), (b.X, b.Y, b.Width, b.Height, b.Nine, b.CenterX, b.CenterY, b.CenterWidth, b.CenterHeight, b.HasPivot, b.PivotX, b.PivotY));
            Assert.False(back.Slices[1].Nine || back.Slices[1].HasPivot);
            Assert.True(back.Layers[0].Reference);
            Assert.False(back.Layers[1].Reference);
        }
        // A 9-slice centre is kept inside its slice.
        var odd = new SpriteSlice { Width = 4, Height = 4, Nine = true, CenterX = 9, CenterWidth = 9 }.Checked(16, 16);
        Assert.True(odd.CenterX + odd.CenterWidth <= odd.Width);
    }

    [Fact]
    public void A_packed_sheet_trims_frames_and_keeps_same_ones_once()
    {
        // Four 16 × 16 frames: a small square moving (frame 2 the same as frame 0), and one empty.
        var frames = new List<SpriteImage>
        {
            Frame(16, 16, (x, y) => x >= 2 && x < 6 && y >= 3 && y < 7, 200, 100),
            Frame(16, 16, (x, y) => x >= 8 && x < 14 && y >= 8 && y < 11, 150, 120),
            Frame(16, 16, (x, y) => x >= 2 && x < 6 && y >= 3 && y < 7, 200, 80),
            Frame(16, 16, (x, y) => false, 0, 60),
        };
        var (sheet, placed) = SpriteExport.Pack(frames, "packed", 1);
        Assert.Equal((4, 4, 2, 3, true), (placed[0].W, placed[0].H, placed[0].OffX, placed[0].OffY, placed[0].Trimmed));
        Assert.Equal((placed[0].X, placed[0].Y), (placed[2].X, placed[2].Y));          // the same picture, once
        Assert.Equal((6, 3, 8, 8), (placed[1].W, placed[1].H, placed[1].OffX, placed[1].OffY));
        Assert.Equal((1, 1), (placed[3].W, placed[3].H));
        Assert.True(sheet.Width * sheet.Height < 16 * 16, $"{sheet.Width} × {sheet.Height}");
        // The pixels are where the JSON says.
        Assert.Equal(200, sheet.Rgba[(placed[0].Y * sheet.Width + placed[0].X) * 4]);
        Assert.Equal(150, sheet.Rgba[(placed[1].Y * sheet.Width + placed[1].X + 5) * 4]);
        // JSON in both of Aseprite's forms, with trimming and slices.
        var slice = new SpriteSlice { Name = "body", X = 2, Y = 3, Width = 4, Height = 4, HasPivot = true, PivotX = 2, PivotY = 4 }.Checked(16, 16);
        var hash = JsonDocument.Parse(SpriteExport.Json("hero", sheet, placed, [], [new SpriteLayer { Id = "a", Name = "Body" }, new SpriteLayer { Id = "r", Name = "Ref", Reference = true }], [slice], 2)).RootElement;
        var f1 = hash.GetProperty("frames").GetProperty("hero 1.png");
        Assert.True(f1.GetProperty("trimmed").GetBoolean());
        Assert.Equal(8, f1.GetProperty("spriteSourceSize").GetProperty("x").GetInt32());
        Assert.Equal(16, f1.GetProperty("sourceSize").GetProperty("w").GetInt32());
        Assert.Equal(["Body"], hash.GetProperty("meta").GetProperty("layers").EnumerateArray().Select(l => l.GetProperty("name").GetString()));
        var key = hash.GetProperty("meta").GetProperty("slices")[0].GetProperty("keys")[0];
        Assert.Equal((4, 8), (key.GetProperty("bounds").GetProperty("x").GetInt32(), key.GetProperty("pivot").GetProperty("y").GetInt32())); // at 2×
        var array = JsonDocument.Parse(SpriteExport.Json("hero", sheet, placed, [], [], [], 1, "array")).RootElement.GetProperty("frames");
        Assert.Equal(4, array.GetArrayLength());
        Assert.Equal("hero 3.png", array[3].GetProperty("filename").GetString());
    }

    [Fact]
    public void Godot_sprite_frames_have_an_animation_per_tag_with_each_frames_duration()
    {
        var frames = Enumerable.Range(0, 5).Select(i => new SpriteExport.SheetFrame(i * 8, 0, 8, 8, 0, 0, 8, 8, 100 + i * 50, false)).ToList();
        frames[4] = frames[4] with { W = 4, H = 5, OffX = 2, OffY = 1, Trimmed = true };
        List<SpriteTag> tags = [new() { Name = "walk", From = 0, To = 2, Direction = "pingpong" }, new() { Name = "jump", From = 3, To = 4, Direction = "reverse" }, new() { Name = "walk", From = 1, To = 1 }];
        var anims = GodotSprite.Animations(5, tags);
        Assert.Equal(["walk", "jump", "walk 2"], anims.Select(a => a.Name));
        Assert.Equal([0, 1, 2, 1], anims[0].Frames);   // there and back, the ends once
        Assert.Equal([4, 3], anims[1].Frames);
        Assert.Equal(["default"], GodotSprite.Animations(3, []).Select(a => a.Name));
        var tres = GodotSprite.SpriteFrames("hero.png", frames, tags);
        Assert.StartsWith("[gd_resource type=\"SpriteFrames\" load_steps=7 format=3]", tres);
        Assert.Contains("[ext_resource type=\"Texture2D\" path=\"hero.png\" id=\"1_sheet\"]", tres);
        Assert.Contains("region = Rect2(16, 0, 8, 8)", tres);
        Assert.Contains("margin = Rect2(2, 1, 4, 3)", tres);                 // the trimmed frame put back in place
        Assert.Contains("\"duration\": 1.5,\n\"texture\": SubResource(\"AtlasTexture_1\")", tres);
        Assert.Contains("\"name\": &\"jump\"", tres);
        Assert.Contains("\"speed\": 10.0", tres);
        var scene = GodotSprite.Scene("Hero!", "hero.tres", "walk");
        Assert.Contains("[node name=\"Hero\" type=\"AnimatedSprite2D\"]", scene);
        Assert.Contains("texture_filter = 1", scene);
        Assert.Contains("autoplay = \"walk\"", scene);
    }
}
