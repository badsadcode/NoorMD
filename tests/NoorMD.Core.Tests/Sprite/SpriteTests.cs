using System.Buffers.Binary;
using NoorMD.Core.Sprite;
using Xunit;

namespace NoorMD.Core.Tests.Sprite;

/// <summary>NoorSprite's files: .noorsprite, PNG, .aseprite, sprite sheets and GIF.</summary>
public class SpriteTests
{
    private static byte[] Pixels(int w, int h, Func<int, int, (byte R, byte G, byte B, byte A)> at)
    {
        var px = new byte[w * h * 4];
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var (r, g, b, a) = at(x, y); px[(y * w + x) * 4] = r; px[(y * w + x) * 4 + 1] = g; px[(y * w + x) * 4 + 2] = b; px[(y * w + x) * 4 + 3] = a; }
        return px;
    }

    /// <summary>A 16 × 12 sprite: two layers, three frames, a tag, a palette; a half-clear pixel to keep exact.</summary>
    internal static SpriteDoc Sample()
    {
        var doc = new SpriteDoc
        {
            Width = 16, Height = 12, Palette = ["#000000ff", "#ff004dff", "#29adffff", "#ffffff80"],
            Layers = [new SpriteLayer { Id = "bg", Name = "Ground" }, new SpriteLayer { Id = "hero", Name = "Hero", Opacity = 200, Blend = "multiply", Locked = true }],
            Frames = [new SpriteFrame { Duration = 100 }, new SpriteFrame { Duration = 150 }, new SpriteFrame { Duration = 80 }],
            Tags = [new SpriteTag { Name = "walk", From = 0, To = 2, Direction = "pingpong", Color = "#ff004dff" }],
            GridWidth = 8, GridHeight = 8,
        };
        doc.Cels.Add(new SpriteCel { Layer = "bg", Frame = 0, Width = 16, Height = 12 }.WithPixels(Pixels(16, 12, (x, y) => ((byte)(x * 16), (byte)(y * 20), 30, 255))));
        for (var f = 0; f < 3; f++)
            doc.Cels.Add(new SpriteCel { Layer = "hero", Frame = f, X = 2 + f, Y = 3, Width = 4, Height = 5, Opacity = 255 - f * 10 }.WithPixels(Pixels(4, 5, (x, y) => ((byte)(200 + f), 10, (byte)(x * 60), (byte)(x == 1 && y == 1 ? 128 : 255)))));
        return doc.Checked();
    }

    [Fact]
    public void A_noorsprite_file_reopens_the_same_pixel_for_pixel()
    {
        var doc = Sample();
        var back = SpriteFile.FromBytes(SpriteFile.ToBytes(doc));
        Assert.Equal((16, 12, 2, 3, 4), (back.Width, back.Height, back.Layers.Count, back.Frames.Count, back.Cels.Count));
        Assert.Equal(["Ground", "Hero"], back.Layers.Select(l => l.Name));
        Assert.Equal(("multiply", 200, true), (back.Layers[1].Blend, back.Layers[1].Opacity, back.Layers[1].Locked));
        Assert.Equal([100, 150, 80], back.Frames.Select(f => f.Duration));
        Assert.Equal(("walk", "pingpong", 2), (back.Tags[0].Name, back.Tags[0].Direction, back.Tags[0].To));
        foreach (var c in doc.Cels)
        {
            var b = back.Cel(c.Layer, c.Frame)!;
            Assert.Equal((c.X, c.Y, c.Width, c.Height, c.Opacity), (b.X, b.Y, b.Width, b.Height, b.Opacity));
            Assert.Equal(c.Pixels(), b.Pixels());
        }
        Assert.Throws<System.IO.InvalidDataException>(() => SpriteFile.FromBytes([1, 2, 3]));
    }

    [Fact]
    public void Snapshots_and_a_shared_palette_are_kept_in_the_file()
    {
        var doc = Sample();
        var then = Sample();
        then.Width = 8; then.Cels = [then.Cels[0]]; then.Cels[0].Width = 8; then.Cels[0].WithPixels(new byte[8 * 12 * 4]);
        then.Snapshots = [new SpriteSnapshot { Name = "nested", Sprite = Sample() }]; // a snapshot holds no snapshots of its own
        doc.Snapshots = [new SpriteSnapshot { Name = "  before the new hair ", SavedUtc = "2026-10-30T10:00:00Z", Sprite = then }, new SpriteSnapshot { Name = "", Sprite = Sample() }];
        doc.PaletteLink = @"C:\Game\shared.gpl";
        var back = SpriteFile.FromBytes(SpriteFile.ToBytes(doc));
        Assert.Equal(["before the new hair", "Snapshot"], back.Snapshots.Select(x => x.Name));
        Assert.Equal("2026-10-30T10:00:00Z", back.Snapshots[0].SavedUtc);
        Assert.Equal(8, back.Snapshots[0].Sprite!.Width);
        Assert.Empty(back.Snapshots[0].Sprite!.Snapshots);
        Assert.Equal(doc.Snapshots[1].Sprite!.Cels[1].Pixels(), back.Snapshots[1].Sprite!.Cels[1].Pixels());
        Assert.Equal(@"C:\Game\shared.gpl", back.PaletteLink);
        // The page's form carries them whole.
        var wire = SpriteDoc.FromJson(back.ToJson());
        Assert.Equal(2, wire.Snapshots.Count);
        Assert.Equal(16, wire.Snapshots[1].Sprite!.Width);
    }

    [Fact]
    public void Sprites_that_dont_hold_together_are_refused_or_mended()
    {
        Assert.Throws<System.IO.InvalidDataException>(() => new SpriteDoc { Width = 0, Layers = [new SpriteLayer { Id = "a" }], Frames = [new SpriteFrame()] }.Checked());
        Assert.Throws<System.IO.InvalidDataException>(() => new SpriteDoc { Layers = [new SpriteLayer { Id = "../x" }], Frames = [new SpriteFrame()] }.Checked());
        Assert.Throws<System.IO.InvalidDataException>(() => new SpriteDoc { Layers = [new SpriteLayer { Id = "a" }, new SpriteLayer { Id = "a" }], Frames = [new SpriteFrame()] }.Checked());
        var doc = new SpriteDoc
        {
            Layers = [new SpriteLayer { Id = "a", Blend = "lens-flare", Opacity = 900 }], Frames = [new SpriteFrame { Duration = 0 }],
            Cels = [new SpriteCel { Layer = "nope", Frame = 0, Width = 1, Height = 1 }, new SpriteCel { Layer = "a", Frame = 5, Width = 1, Height = 1 }],
            Tags = [new SpriteTag { From = 3, To = 1, Direction = "sideways" }], Palette = ["#zzz", "#11223344"],
        }.Checked();
        Assert.Equal(("normal", 255, 1), (doc.Layers[0].Blend, doc.Layers[0].Opacity, doc.Frames[0].Duration));
        Assert.Empty(doc.Cels);
        Assert.Equal((0, 0, "forward"), (doc.Tags[0].From, doc.Tags[0].To, doc.Tags[0].Direction));
        Assert.Equal(["#11223344"], doc.Palette);
        Assert.Throws<System.IO.InvalidDataException>(() => new SpriteDoc { Layers = [new SpriteLayer { Id = "a" }], Frames = [new SpriteFrame()], Cels = [new SpriteCel { Layer = "a", Width = 2, Height = 2, Data = Convert.ToBase64String(new byte[3]) }] }.Checked());
    }

    [Fact]
    public void Png_round_trips_exactly_and_reads_other_kinds()
    {
        var px = Pixels(7, 5, (x, y) => ((byte)(x * 30), (byte)(y * 50), (byte)(x * y), (byte)(x == 3 ? 7 : 255)));
        var (w, h, back) = SpritePng.Decode(SpritePng.Encode(7, 5, px));
        Assert.Equal((7, 5), (w, h));
        Assert.Equal(px, back);
        // An RGB PNG (as a photo editor writes one) reads as opaque.
        var rgb = HandPng(2, 1, 2, [255, 0, 0, 0, 0, 255]);
        Assert.Equal(new byte[] { 255, 0, 0, 255, 0, 0, 255, 255 }, SpritePng.Decode(rgb).Rgba);
        Assert.Throws<System.IO.InvalidDataException>(() => SpritePng.Decode([1, 2, 3]));
    }

    /// <summary>A minimal PNG of another colour type (filter 0, one IDAT; CRCs aren't checked when read).</summary>
    private static byte[] HandPng(int w, int h, int type, byte[] data)
    {
        var ms = new MemoryStream();
        ms.Write([137, 80, 78, 71, 13, 10, 26, 10]);
        void Chunk(string t, byte[] d) { var l = new byte[4]; BinaryPrimitives.WriteInt32BigEndian(l, d.Length); ms.Write(l); ms.Write(System.Text.Encoding.ASCII.GetBytes(t)); ms.Write(d); ms.Write(new byte[4]); }
        var ihdr = new byte[13]; BinaryPrimitives.WriteInt32BigEndian(ihdr, w); BinaryPrimitives.WriteInt32BigEndian(ihdr.AsSpan(4), h); ihdr[8] = 8; ihdr[9] = (byte)type;
        Chunk("IHDR", ihdr);
        var raw = new MemoryStream();
        using (var z = new System.IO.Compression.ZLibStream(raw, System.IO.Compression.CompressionLevel.Optimal, true))
        {
            var stride = data.Length / h;
            for (var y = 0; y < h; y++) { z.WriteByte(0); z.Write(data, y * stride, stride); }
        }
        Chunk("IDAT", raw.ToArray()); Chunk("IEND", []);
        return ms.ToArray();
    }

    [Fact]
    public void Aseprite_files_written_are_read_back_whole()
    {
        var doc = Sample();
        var file = AsepriteFile.Write(doc);
        Assert.Equal(file.Length, (int)BinaryPrimitives.ReadUInt32LittleEndian(file));
        Assert.Equal(0xA5E0, BinaryPrimitives.ReadUInt16LittleEndian(file.AsSpan(4)));
        Assert.Equal(3, BinaryPrimitives.ReadUInt16LittleEndian(file.AsSpan(6)));
        var (back, notes) = AsepriteFile.Read(file);
        Assert.Empty(notes);
        Assert.Equal(["Ground", "Hero"], back.Layers.Select(l => l.Name));
        Assert.Equal(("multiply", 200, true), (back.Layers[1].Blend, back.Layers[1].Opacity, back.Layers[1].Locked));
        Assert.Equal([100, 150, 80], back.Frames.Select(f => f.Duration));
        Assert.Equal(("walk", 0, 2, "pingpong", "#ff004dff"), (back.Tags[0].Name, back.Tags[0].From, back.Tags[0].To, back.Tags[0].Direction, back.Tags[0].Color));
        Assert.Equal(doc.Palette, back.Palette);
        Assert.Equal((8, 8), (back.GridWidth, back.GridHeight));
        Assert.Equal(4, back.Cels.Count);
        for (var f = 0; f < 3; f++)
        {
            var (a, b) = (doc.Cel("hero", f)!, back.Cel(back.Layers[1].Id, f)!);
            Assert.Equal((a.X, a.Y, a.Width, a.Height, a.Opacity), (b.X, b.Y, b.Width, b.Height, b.Opacity));
            Assert.Equal(a.Pixels(), b.Pixels());
        }
        Assert.Throws<System.IO.InvalidDataException>(() => AsepriteFile.Read(new byte[200]));
    }

    [Fact]
    public void An_indexed_aseprite_file_with_a_group_and_a_linked_cel_is_read_with_its_colours()
    {
        // Built by hand from the specification: 2×2, indexed, palette (transparent 0, red, blue); a group, then a
        // layer in it; frame 0 a raw cel, frame 1 linked to it.
        var chunks0 = new List<(ushort, byte[])>
        {
            (0x2019, Palette3()), (0x2004, Layer(1, 0, "Group")), (0x2004, Layer(0, 1, "Paint")),
            (0x2005, [.. Cel(1, 0, 0, 0), .. W(2), .. W(2), 1, 2, 0, 1]),
        };
        var chunks1 = new List<(ushort, byte[])> { (0x2005, [.. Cel(1, 0, 0, 1), .. W(0)]) };
        var file = Ase(2, 2, 8, [(100, chunks0), (60, chunks1)]);
        var (doc, notes) = AsepriteFile.Read(file);
        Assert.Equal(["Group", "Paint"], doc.Layers.Select(l => l.Name));
        Assert.Equal(("group", doc.Layers[0].Id), (doc.Layers[0].Kind, doc.Layers[1].Parent));
        Assert.Empty(notes);
        Assert.Equal("indexed", doc.ColorMode);
        var c0 = doc.Cel(doc.Layers[1].Id, 0)!;
        Assert.Equal(new byte[] { 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 255, 0, 0, 255 }, c0.Pixels());
        Assert.Equal(c0.Pixels(), doc.Cel(doc.Layers[1].Id, 1)!.Pixels());
        // Written back, the group and what is in it stay so.
        var back = AsepriteFile.Read(AsepriteFile.Write(doc)).Sprite;
        Assert.Equal(["Group", "Paint"], back.Layers.Select(l => l.Name));
        Assert.Equal(back.Layers[0].Id, back.Layers[1].Parent);
        Assert.Equal(c0.Pixels(), back.Cel(back.Layers[1].Id, 0)!.Pixels());
        Assert.Equal([100, 60], doc.Frames.Select(f => f.Duration));
    }

    private static byte[] W(int v) => [(byte)v, (byte)(v >> 8)];
    private static byte[] Layer(int type, int level, string name) => [3, 0, .. W(type), .. W(level), 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, .. W(name.Length), .. System.Text.Encoding.UTF8.GetBytes(name)];
    private static byte[] Cel(int layer, int x, int y, int type) => [.. W(layer), .. W(x), .. W(y), 255, .. W(type), 0, 0, 0, 0, 0, 0, 0];
    private static byte[] Palette3() => [3, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 255, 255];
    private static byte[] Ase(int w, int h, int depth, List<(int Duration, List<(ushort Type, byte[] Data)> Chunks)> frames)
    {
        var ms = new MemoryStream();
        var header = new byte[128];
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(4), 0xA5E0);
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(6), (ushort)frames.Count);
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(8), (ushort)w); BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(10), (ushort)h);
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(12), (ushort)depth);
        BinaryPrimitives.WriteUInt32LittleEndian(header.AsSpan(14), 1);
        ms.Write(header);
        foreach (var (duration, chunks) in frames)
        {
            var body = new MemoryStream();
            foreach (var (t, d) in chunks) { var hd = new byte[6]; BinaryPrimitives.WriteUInt32LittleEndian(hd, (uint)(d.Length + 6)); BinaryPrimitives.WriteUInt16LittleEndian(hd.AsSpan(4), t); body.Write(hd); body.Write(d); }
            var fh = new byte[16];
            BinaryPrimitives.WriteUInt32LittleEndian(fh, (uint)(body.Length + 16)); BinaryPrimitives.WriteUInt16LittleEndian(fh.AsSpan(4), 0xF1FA);
            BinaryPrimitives.WriteUInt16LittleEndian(fh.AsSpan(6), (ushort)chunks.Count); BinaryPrimitives.WriteUInt16LittleEndian(fh.AsSpan(8), (ushort)duration);
            ms.Write(fh); ms.Write(body.ToArray());
        }
        var bytes = ms.ToArray();
        BinaryPrimitives.WriteUInt32LittleEndian(bytes, (uint)bytes.Length);
        return bytes;
    }

    [Fact]
    public void Frames_go_into_a_sheet_with_a_json_engines_read_and_scale_crisply()
    {
        var frames = Enumerable.Range(0, 5).Select(i => new SpriteImage(3, 2, Pixels(3, 2, (x, y) => ((byte)(i * 40), (byte)x, (byte)y, 255)), 100 + i)).ToList();
        var (sheet, json) = SpriteExport.Sheet(frames, "grid", 1, "hero", [new SpriteTag { Name = "run", From = 1, To = 3 }], [new SpriteLayer { Id = "a", Name = "Body" }]);
        Assert.Equal((3 * 3 + 2, 2 * 2 + 1), (sheet.Width, sheet.Height)); // 3 columns, 2 rows, 1 px apart
        var root = System.Text.Json.JsonDocument.Parse(json).RootElement;
        var f4 = root.GetProperty("frames").GetProperty("hero 4.png");
        Assert.Equal((4, 3, 104), (f4.GetProperty("frame").GetProperty("x").GetInt32(), f4.GetProperty("frame").GetProperty("y").GetInt32(), f4.GetProperty("duration").GetInt32()));
        Assert.Equal("run", root.GetProperty("meta").GetProperty("frameTags")[0].GetProperty("name").GetString());
        Assert.Equal(160, sheet.Rgba[((3) * sheet.Width + 4) * 4]); // frame 4's first pixel, red = 4 × 40
        var row = SpriteExport.Sheet(frames, "row", 0, "hero", [], []).Sheet;
        Assert.Equal((15, 2), (row.Width, row.Height));
        var big = SpriteExport.Scale(frames[1], 3);
        Assert.Equal((9, 6), (big.Width, big.Height));
        Assert.Equal(big.Rgba.AsSpan(0, 4).ToArray(), big.Rgba.AsSpan(2 * 4, 4).ToArray()); // a 3×3 block of one colour
        Assert.Equal(frames[1].Rgba.AsSpan(4, 4).ToArray(), big.Rgba.AsSpan(3 * 4, 4).ToArray());
    }

    [Fact]
    public void A_gif_plays_each_frame_with_its_delay_transparency_and_looping()
    {
        var frames = new[]
        {
            new SpriteImage(4, 3, Pixels(4, 3, (x, y) => x == 0 ? ((byte)0, (byte)0, (byte)0, (byte)0) : ((byte)255, (byte)(x * 60), (byte)0, (byte)255)), 120),
            new SpriteImage(4, 3, Pixels(4, 3, (x, y) => ((byte)0, (byte)(y * 80), (byte)255, (byte)255)), 50),
        };
        var gif = GifWriter.Write(frames);
        Assert.Equal("GIF89a", System.Text.Encoding.ASCII.GetString(gif, 0, 6));
        Assert.Equal((4, 3), (gif[6] | gif[7] << 8, gif[8] | gif[9] << 8));
        Assert.Contains("NETSCAPE2.0", System.Text.Encoding.ASCII.GetString(gif));
        Assert.Equal(0x3B, gif[^1]);
        var decoded = DecodeGif(gif);
        Assert.Equal(2, decoded.Count);
        Assert.Equal((12, true), (decoded[0].Delay, decoded[0].Transparent >= 0));
        Assert.Equal(decoded[0].Transparent, decoded[0].Indices[0]);         // the clear column
        var red = decoded[0].Palette[decoded[0].Indices[1]];
        Assert.Equal((255, 60, 0), red);
        Assert.Equal((5, -1), (decoded[1].Delay, decoded[1].Transparent));
        Assert.Equal((0, 160, 255), decoded[1].Palette[decoded[1].Indices[2 * 4]]);
        // Many colours (a gradient of 4096): reduced to 256, every pixel near its own.
        var many = new SpriteImage(64, 64, Pixels(64, 64, (x, y) => ((byte)(x * 4), (byte)(y * 4), (byte)((x + y) * 2), 255)), 100);
        var m = DecodeGif(GifWriter.Write([many]))[0];
        Assert.True(m.Palette.Count <= 256);
        var worst = Enumerable.Range(0, 64 * 64).Max(i => { var (r, g, b) = m.Palette[m.Indices[i]]; return Math.Abs(r - many.Rgba[i * 4]) + Math.Abs(g - many.Rgba[i * 4 + 1]) + Math.Abs(b - many.Rgba[i * 4 + 2]); });
        Assert.True(worst < 80, $"worst {worst}");
    }

    /// <summary>A small GIF decoder for the test (as browsers read them): each image's palette, indices, delay, transparency.</summary>
    private static List<(List<(int, int, int)> Palette, byte[] Indices, int Delay, int Transparent)> DecodeGif(byte[] g)
    {
        var o = new List<(List<(int, int, int)>, byte[], int, int)>();
        var p = 13; int delay = 0, transparent = -1;
        while (p < g.Length)
        {
            var b = g[p++];
            if (b == 0x3B) break;
            if (b == 0x21)
            {
                var label = g[p++];
                if (label == 0xF9) { delay = g[p + 2] | g[p + 3] << 8; transparent = (g[p + 1] & 1) != 0 ? g[p + 4] : -1; }
                while (g[p] != 0) p += g[p] + 1;
                p++;
                continue;
            }
            int w = g[p + 4] | g[p + 5] << 8, h = g[p + 6] | g[p + 7] << 8, flags = g[p + 8];
            p += 9;
            var size = 1 << ((flags & 7) + 1);
            var pal = Enumerable.Range(0, size).Select(i => ((int)g[p + i * 3], (int)g[p + i * 3 + 1], (int)g[p + i * 3 + 2])).ToList();
            p += size * 3;
            int min = g[p++];
            var data = new List<byte>();
            while (g[p] != 0) { data.AddRange(g.AsSpan(p + 1, g[p]).ToArray()); p += g[p] + 1; }
            p++;
            o.Add((pal, Lzw(data.ToArray(), min, w * h), delay, transparent));
        }
        return o;
    }

    private static byte[] Lzw(byte[] data, int min, int count)
    {
        int clear = 1 << min, end = clear + 1, width = min + 1, next = end + 1, bitPos = 0;
        var dict = new List<byte[]>();
        void Reset() { dict.Clear(); for (var i = 0; i < clear; i++) dict.Add([(byte)i]); dict.Add([]); dict.Add([]); width = min + 1; next = end + 1; }
        Reset();
        var output = new List<byte>(); byte[]? prev = null;
        while (output.Count < count && bitPos + width <= data.Length * 8)
        {
            var code = 0;
            for (var k = 0; k < width; k++) if ((data[(bitPos + k) >> 3] >> ((bitPos + k) & 7) & 1) != 0) code |= 1 << k;
            bitPos += width;
            if (code == clear) { Reset(); prev = null; continue; }
            if (code == end) break;
            byte[] entry = code < dict.Count ? dict[code] : [.. prev!, prev![0]];
            output.AddRange(entry);
            if (prev != null && dict.Count < 4096) { dict.Add([.. prev, entry[0]]); }
            if (dict.Count >= (1 << width) && width < 12) width++;
            prev = entry;
        }
        return output.ToArray();
    }
}
