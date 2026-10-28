using System.IO.Compression;
using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

public class TextureTests
{
    /// <summary>A minimal PNG reader for the tests: checks every chunk's CRC, undoes the filters, returns the pixels.</summary>
    private static (int W, int H, int Type, int Depth, byte[] Px) ReadPng(byte[] png)
    {
        Assert.Equal(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }, png[..8]);
        int pos = 8, w = 0, h = 0, type = 0, depth = 0;
        var idat = new MemoryStream();
        while (pos < png.Length)
        {
            var len = (png[pos] << 24) | (png[pos + 1] << 16) | (png[pos + 2] << 8) | png[pos + 3];
            var kind = System.Text.Encoding.ASCII.GetString(png, pos + 4, 4);
            var data = png[(pos + 8)..(pos + 8 + len)];
            var crc = (uint)((png[pos + 8 + len] << 24) | (png[pos + 9 + len] << 16) | (png[pos + 10 + len] << 8) | png[pos + 11 + len]);
            Assert.Equal(Crc(png[(pos + 4)..(pos + 8 + len)]), crc);
            if (kind == "IHDR") { w = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]; h = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]; depth = data[8]; type = data[9]; }
            if (kind == "IDAT") idat.Write(data);
            pos += 12 + len;
        }
        var bpp = (type switch { 0 => 1, 2 => 3, 6 => 4, _ => 0 }) * depth / 8;
        var stride = w * bpp;
        using var z = new ZLibStream(new MemoryStream(idat.ToArray()), CompressionMode.Decompress);
        var raw = new MemoryStream(); z.CopyTo(raw);
        var r = raw.ToArray();
        Assert.Equal(h * (stride + 1), r.Length);
        var px = new byte[h * stride];
        for (var y = 0; y < h; y++)
        {
            var f = r[y * (stride + 1)];
            for (var i = 0; i < stride; i++)
            {
                var v = r[y * (stride + 1) + 1 + i];
                px[y * stride + i] = f switch { 0 => v, 2 => (byte)(v + (y > 0 ? px[(y - 1) * stride + i] : 0)), _ => throw new InvalidDataException("filter " + f) };
            }
        }
        return (w, h, type, depth, px);
    }

    private static uint Crc(byte[] b)
    {
        var c = 0xFFFFFFFFu;
        foreach (var x in b) { c ^= x; for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1; }
        return c ^ 0xFFFFFFFFu;
    }

    [Fact]
    public void Png_Files_Read_Back_Exactly()
    {
        var rng = new Random(3);
        var rgb = new byte[37 * 21 * 3]; rng.NextBytes(rgb);
        var a = ReadPng(PngWriter.Rgb(37, 21, rgb));
        Assert.Equal((37, 21, 2, 8), (a.W, a.H, a.Type, a.Depth));
        Assert.Equal(rgb, a.Px);
        var gray = new byte[16 * 9]; rng.NextBytes(gray);
        Assert.Equal(gray, ReadPng(PngWriter.Gray(16, 9, gray, fast: true)).Px);
        var rgba = new byte[5 * 5 * 4]; rng.NextBytes(rgba);
        Assert.Equal(rgba, ReadPng(PngWriter.Rgba(5, 5, rgba)).Px);
        var h16 = ReadPng(PngWriter.Gray16(2, 1, [0f, 1f]));
        Assert.Equal((0, 16), (h16.Type, h16.Depth));
        Assert.Equal(new byte[] { 0, 0, 255, 255 }, h16.Px);
    }

    [Fact]
    public void The_Same_Recipe_Gives_The_Same_Pixels_And_The_Seed_Changes_Them()
    {
        var a = TextureEngine.Render(TexturePresets.Make("stone-cobbles"), 128);
        var b = TextureEngine.Render(TexturePresets.Make("stone-cobbles"), 128);
        Assert.Equal(a.Albedo, b.Albedo);
        Assert.Equal(a.Height, b.Height);
        var r = TexturePresets.Make("stone-cobbles"); r.Seed = 2;
        Assert.NotEqual(a.Height, TextureEngine.Render(r, 128).Height);
    }

    [Fact]
    public void Every_Preset_Tiles_Without_A_Seam()
    {
        foreach (var p in TexturePresets.All)
        {
            var m = TextureEngine.Render(TexturePresets.Make(p.Id), 128);
            var n = m.Size;
            double Step(int x0, int y0, int x1, int y1) => Math.Abs(m.Height[y0 * n + x0] - m.Height[y1 * n + x1]);
            double insideX = 0, insideY = 0, acrossX = 0, acrossY = 0;
            for (var k = 0; k < n; k++)
            {
                acrossX += Step(n - 1, k, 0, k); acrossY += Step(k, n - 1, k, 0);
                for (var j = 1; j < n; j++) { insideX += Step(j - 1, k, j, k); insideY += Step(k, j - 1, k, j); }
            }
            insideX /= n * (n - 1); insideY /= n * (n - 1); acrossX /= n; acrossY /= n;
            // Across the edge, the height changes no more than it does between neighbours inside, in the same direction.
            Assert.True(acrossX < insideX * 2.5 + 1e-3, $"{p.Id}: left–right {acrossX:0.0000} vs {insideX:0.0000}");
            Assert.True(acrossY < insideY * 2.5 + 1e-3, $"{p.Id}: top–bottom {acrossY:0.0000} vs {insideY:0.0000}");
        }
    }

    [Fact]
    public void A_Material_Looks_The_Same_At_Any_Size()
    {
        var small = TextureEngine.Render(TexturePresets.Make("bricks-red"), 128);
        var big = TextureEngine.Render(TexturePresets.Make("bricks-red"), 256);
        double diff = 0;
        for (var y = 0; y < 128; y++)
            for (var x = 0; x < 128; x++)
            {
                var avg = (big.Height[2 * y * 256 + 2 * x] + big.Height[2 * y * 256 + 2 * x + 1] + big.Height[(2 * y + 1) * 256 + 2 * x] + big.Height[(2 * y + 1) * 256 + 2 * x + 1]) / 4;
                diff += Math.Abs(avg - small.Height[y * 128 + x]);
            }
        Assert.True(diff / (128 * 128) < 0.05, $"{diff / (128 * 128)}");
    }

    [Fact]
    public void Maps_Follow_The_Conventions()
    {
        // Flat: the normal points straight out, nothing is in a cavity, roughness and metallic are as set.
        var flat = new TextureRecipe { Surface = new TextureSurface { RoughnessLow = 0.5, RoughnessHigh = 0.5, RoughnessVariation = 0, Metallic = 1, ColorVariation = 0, Dirt = 0 } }.Clamped();
        var f = TextureEngine.Render(flat, 64);
        Assert.All(Enumerable.Range(0, 64 * 64), i => Assert.Equal((128, 128, 255), (f.Normal[i * 3], f.Normal[i * 3 + 1], f.Normal[i * 3 + 2])));
        Assert.All(f.Ao, v => Assert.Equal(255, v));
        Assert.All(f.Roughness, v => Assert.Equal(128, v));
        Assert.All(f.Metallic, v => Assert.Equal(255, v));
        // A slope rising to the right tilts the normal to the left (OpenGL: red low); DirectX flips green only.
        var bricks = TextureEngine.Render(new TextureRecipe { Layers = [new TextureLayer { Type = "bricks", ScaleX = 1, ScaleY = 1, Offset = 0, Mortar = 0.2, Bevel = 0.4, Variation = 0 }],
            Surface = new TextureSurface { NormalStrength = 12, AoRadius = 0.08 } }.Clamped(), 64); // deep relief: the mortar sits well below the brick
        var rising = 32 * 64 + 8; // left part of the brick, its bevel rising to the right
        Assert.True(bricks.Height[rising + 1] > bricks.Height[rising - 1]);
        Assert.True(bricks.Normal[rising * 3] < 120, $"{bricks.Normal[rising * 3]}");
        var gl = ReadPng(bricks.Png("normal")).Px; var dx = ReadPng(bricks.Png("normal", directX: true)).Px;
        for (var i = 0; i < gl.Length; i++) Assert.Equal(i % 3 == 1 ? 255 - gl[i] : gl[i], dx[i]);
        // Packed ORM: occlusion, roughness, metallic in R, G, B.
        var orm = ReadPng(bricks.Packed("ao", "roughness", "metallic")).Px;
        for (var i = 0; i < 64 * 64; i += 97) Assert.Equal((bricks.Ao[i], bricks.Roughness[i], bricks.Metallic[i], (byte)255), (orm[i * 4], orm[i * 4 + 1], orm[i * 4 + 2], orm[i * 4 + 3]));
        // The mortar next to the brick's walls is darker in AO than the brick's face.
        var nearWall = Enumerable.Range(0, 10).Min(x => bricks.Ao[32 * 64 + x]);
        Assert.True(nearWall < bricks.Ao[32 * 64 + 32] - 20, $"{nearWall} vs {bricks.Ao[32 * 64 + 32]}");
    }

    [Fact]
    public void Recipes_Are_Kept_Sensible()
    {
        var r = TextureRecipe.FromJson("""
            {"name":"  ","seed":-4,"layers":[{"type":"lava","scaleX":0,"scaleY":9999,"octaves":40,"blend":"glow","opacity":3},
              {"type":"weave","scaleX":31,"scaleY":7},{"type":"bricks","scaleX":4,"scaleY":5,"offset":0.5},{"id":"T1","type":"noise"}],
             "surface":{"ramp":[{"pos":0.9,"color":"red"},{"pos":0.1,"color":"#00FF00"}],"normalStrength":99}}
            """);
        Assert.Equal(("Untitled material", 0), (r.Name, r.Seed));
        Assert.Equal(("noise", 1, 256, 10, "normal", 1.0), (r.Layers[0].Type, r.Layers[0].ScaleX, r.Layers[0].ScaleY, r.Layers[0].Octaves, r.Layers[0].Blend, r.Layers[0].Opacity));
        Assert.Equal((32, 8), (r.Layers[1].ScaleX, r.Layers[1].ScaleY)); // weave: even, to tile
        Assert.Equal(6, r.Layers[2].ScaleY);                              // offset bricks: an even number of rows
        Assert.Equal(["T2", "T3", "T4", "T1"], r.Layers.Select(l => l.Id));
        Assert.Equal(["#00ff00", "#808080"], r.Surface.Ramp.Select(s => s.Color));
        Assert.Equal(20, r.Surface.NormalStrength);
        Assert.Equal(r.ToJson(), TextureRecipe.FromJson(r.ToJson()).ToJson());
    }
}

/// <summary>Timing runs on its own, after the other tests, so it measures the engine rather than a busy test machine.</summary>
[CollectionDefinition("Timing", DisableParallelization = true)]
public class TimingCollection;

[Collection("Timing")]
public class TexturePreviewSpeedTests
{
    [Fact]
    public void Previews_Render_Quickly()
    {
        TextureEngine.Render(TexturePresets.Make("gravel"), 64); // warm up
        var sw = System.Diagnostics.Stopwatch.StartNew();
        foreach (var p in TexturePresets.All) TextureEngine.Render(TexturePresets.Make(p.Id), 256);
        Assert.True(sw.ElapsedMilliseconds < 20000, $"{sw.ElapsedMilliseconds} ms for all presets at 256");
    }
}
