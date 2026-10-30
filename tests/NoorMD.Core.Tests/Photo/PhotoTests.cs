using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using NoorMD.Core.Photo;
using NoorMD.Core.Sprite;
using Xunit;

namespace NoorMD.Core.Tests.Photo;

/// <summary>NoorPhoto's files: the page's photo JSON, .noorphoto and Photoshop PSD.</summary>
public class PhotoTests
{
    private static byte[] Pixels(int w, int h, Func<int, int, (byte R, byte G, byte B, byte A)> at)
    {
        var px = new byte[w * h * 4];
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var (r, g, b, a) = at(x, y); px[(y * w + x) * 4] = r; px[(y * w + x) * 4 + 1] = g; px[(y * w + x) * 4 + 2] = b; px[(y * w + x) * 4 + 3] = a; }
        return px;
    }

    private static string Png(int w, int h, Func<int, int, (byte, byte, byte, byte)> at) => Convert.ToBase64String(SpritePng.Encode(w, h, Pixels(w, h, at)));
    private static byte[] Decoded(string png) => SpritePng.Decode(Convert.FromBase64String(png)).Rgba;
    private static JsonElement Json(string s) => JsonDocument.Parse(s).RootElement.Clone();

    /// <summary>
    /// A 40 × 30 photo: a background; a multiply layer partly off the canvas with a (turned off) mask; a hidden, locked,
    /// clipped linear-dodge layer; a folded group holding a layer, a group within it, and another layer; a fill layer;
    /// an adjustment layer; two guides. Half-clear pixels (with colour under them) are there to be kept exactly.
    /// </summary>
    internal static PhotoDoc Sample() => new PhotoDoc
    {
        Width = 40, Height = 30,
        Guides = [new PhotoGuide { Axis = "x", At = 100.5 }, new PhotoGuide { Axis = "y", At = 12 }],
        Layers =
        [
            new PhotoLayer { Id = "bg", Name = "Background", Width = 40, Height = 30, Png = Png(40, 30, (x, y) => ((byte)(x * 6), (byte)(y * 8), 90, 255)) },
            new PhotoLayer
            {
                Id = "shade", Name = "Shade ☀", Blend = "multiply", Opacity = 0.6, X = -5, Y = 10, Width = 20, Height = 10,
                Png = Png(20, 10, (x, y) => (200, (byte)(x * 10), (byte)(y * 20), (byte)(x == 3 ? 0 : x == 4 ? 128 : 255))),
                Mask = new PhotoMask { X = 0, Y = 10, Width = 10, Height = 10, Enabled = false, Background = 255, Png = Png(10, 10, (x, y) => ((byte)(x * 25), (byte)(x * 25), (byte)(x * 25), 255)) },
                Filters = Json("""[{"type":"blur","radius":2.5}]"""),
            },
            new PhotoLayer { Id = "glow", Name = "Glow", Blend = "linear-dodge", Opacity = 0.2, Clip = true, Visible = false, Locked = true, X = 5, Y = 5, Width = 6, Height = 4, Png = Png(6, 4, (x, y) => (255, 255, (byte)(x * 40), 200)) },
            new PhotoLayer { Id = "a", Name = "Inside A", Parent = "g1", Blend = "screen", X = 30, Y = 20, Width = 8, Height = 8, Png = Png(8, 8, (x, y) => (10, 20, 30, (byte)(x * 30))) },
            new PhotoLayer { Id = "c", Name = "Deep", Parent = "g2", Blend = "pin-light", X = 1, Y = 1, Width = 3, Height = 3, Png = Png(3, 3, (x, y) => (1, 2, 3, 4)) },
            new PhotoLayer { Id = "g2", Name = "Inner", Kind = "group", Parent = "g1", Blend = "hard-mix" },
            new PhotoLayer { Id = "b", Name = "Inside B", Parent = "g1", Blend = "darker-color", Opacity = 0.4, X = 2, Y = 2, Width = 5, Height = 5, Png = Png(5, 5, (x, y) => (0, 0, 0, 255)) },
            new PhotoLayer { Id = "g1", Name = "Folder", Kind = "group", Collapsed = true, Opacity = 0.8 },
            new PhotoLayer { Id = "f", Name = "Fill", Kind = "fill", Fill = Json("""{"type":"solid","color":"#336699"}"""), Width = 40, Height = 30, Png = Png(40, 30, (x, y) => (0x33, 0x66, 0x99, 255)), Opacity = 0.2 },
            new PhotoLayer { Id = "adj", Name = "Levels", Kind = "adjust", Adjust = Json("""{"type":"levels","black":10,"white":240}""") },
        ],
    }.Checked();

    // ------------------------------------------------------------ the page's JSON

    [Fact]
    public void The_pages_json_comes_back_the_same_with_its_own_settings_untouched()
    {
        const string fill = """{"type":"gradient","stops":[{"at":0,"color":"#000"},{"at":1,"color":"#fff"}],"angle":45.5,"x":null}""";
        const string text = """{"text":"Hello\nworld","font":"Noto Sans","size":32,"runs":[{"from":0,"to":5,"bold":true}]}""";
        var json = $$$"""
            {"version":1,"width":1200,"height":800,"guides":[{"axis":"x","at":100.5}],
             "layers":[
               {"id":"l1","name":"Background","kind":"fill","parent":null,"visible":true,"locked":false,"opacity":1.0,"blend":"normal","clip":false,
                "x":0,"y":0,"width":1200,"height":800,"png":null,"mask":null,"collapsed":false,"fill":{{{fill}}},"adjust":null,"text":null,"filters":null},
               {"id":"t","name":"Title","kind":"text","x":10.6,"y":-4,"width":0,"height":0,"text":{{{text}}},"filters":[{"kind":"blur","r":1}],"mask":{"x":1,"y":2,"width":0,"height":0,"png":null,"enabled":true,"background":255}},
               {"id":"a","name":"Curves","kind":"adjust","adjust":{"points":[[0,0],[255,255]]},"blend":"vivid-light"}
             ],
             "composite":null}
            """;
        var doc = PhotoDoc.FromJson(json);
        var back = PhotoDoc.FromJson(doc.ToJson());
        Assert.Equal((1200, 800, 3), (back.Width, back.Height, back.Layers.Count));
        Assert.Equal(("x", 100.5), (back.Guides![0].Axis, back.Guides[0].At));
        Assert.Equal(JsonDocument.Parse(fill).RootElement.GetRawText(), back.Layers[0].Fill!.Value.GetRawText());
        Assert.Equal(JsonDocument.Parse(text).RootElement.GetRawText(), back.Layers[1].Text!.Value.GetRawText());
        Assert.Equal("""[{"kind":"blur","r":1}]""", back.Layers[1].Filters!.Value.GetRawText());
        Assert.Equal("""{"points":[[0,0],[255,255]]}""", back.Layers[2].Adjust!.Value.GetRawText());
        Assert.Null(back.Layers[0].Adjust);
        Assert.Equal((11, -4), (back.Layers[1].X, back.Layers[1].Y)); // whole numbers sent as 10.6 are rounded
        Assert.Equal((255, true), (back.Layers[1].Mask!.Background, back.Layers[1].Mask!.Enabled));
        Assert.Equal(["fill", "text", "adjust"], back.Layers.Select(l => l.Kind));
        Assert.Equal("vivid-light", back.Layers[2].Blend);
        Assert.DoesNotContain("\"image\"", back.ToJson());
    }

    [Fact]
    public void Photos_that_dont_hold_together_are_refused_or_mended()
    {
        static PhotoDoc One(PhotoLayer l, int w = 10) => new() { Width = w, Height = 10, Layers = [l] };
        Assert.Throws<InvalidDataException>(() => One(new PhotoLayer { Id = "a" }, 0).Checked());
        Assert.Throws<InvalidDataException>(() => One(new PhotoLayer { Id = "a" }, PhotoDoc.MaxSide + 1).Checked());
        Assert.Throws<InvalidDataException>(() => One(new PhotoLayer { Id = "" }).Checked());
        Assert.Throws<InvalidDataException>(() => One(new PhotoLayer { Id = new string('x', 65) }).Checked());
        Assert.Throws<InvalidDataException>(() => One(new PhotoLayer { Id = "a", Width = PhotoDoc.MaxLayerSide + 1 }).Checked());
        Assert.Throws<InvalidDataException>(() => new PhotoDoc { Layers = [new PhotoLayer { Id = "a" }, new PhotoLayer { Id = "a" }] }.Checked());
        Assert.Throws<InvalidDataException>(() => new PhotoDoc { Layers = Enumerable.Range(0, 501).Select(i => new PhotoLayer { Id = "l" + i }).ToList() }.Checked());
        Assert.Throws<InvalidDataException>(() => PhotoDoc.FromJson("{\"width\":\"wide\"}"));

        var doc = new PhotoDoc
        {
            Layers =
            [
                new PhotoLayer { Id = "p", Parent = "g1", Blend = "sparkle", Opacity = 3, Kind = "shape", X = 99999, Y = -99999, Name = "  " },
                new PhotoLayer { Id = "g1", Kind = "group", Parent = "g2" },
                new PhotoLayer { Id = "g2", Kind = "group", Parent = "g1" },
                new PhotoLayer { Id = "q", Parent = "p", Opacity = double.NaN },
                new PhotoLayer { Id = "self", Kind = "group", Parent = "self" },
            ],
        }.Checked();
        var p = doc.Layers[0];
        Assert.Equal(("normal", 1.0, "pixel", 32768, -32768, "Layer"), (p.Blend, p.Opacity, p.Kind, p.X, p.Y, p.Name));
        Assert.Equal("g1", p.Parent);
        Assert.True(doc.Layers[1].Parent == null || doc.Layers[2].Parent == null); // the circle is broken
        Assert.False(doc.Layers[1].Parent == "g2" && doc.Layers[2].Parent == "g1");
        Assert.Null(doc.Layers[3].Parent); // a pixel layer isn't a group
        Assert.Equal(1.0, doc.Layers[3].Opacity);
        Assert.Null(doc.Layers[4].Parent);
    }

    // ------------------------------------------------------------ .noorphoto

    [Fact]
    public void A_noorphoto_file_reopens_the_same_pixel_for_pixel()
    {
        var doc = Sample();
        doc.Composite = Png(40, 30, (x, y) => (1, 2, 3, (byte)(x + y)));
        var bytes = PhotoFile.ToBytes(doc);
        using (var zip = new ZipArchive(new MemoryStream(bytes)))
        {
            Assert.Contains(zip.Entries, e => e.FullName == "preview.png");
            Assert.Contains(zip.Entries, e => e.FullName == "masks/1.png");
            Assert.Contains(zip.Entries, e => e.FullName == "layers/0.png");
            using var r = new StreamReader(zip.GetEntry("photo.json")!.Open());
            var json = r.ReadToEnd();
            Assert.DoesNotContain("\"png\"", json);
            Assert.Contains("\"image\":\"layers/1.png\"", json);
            Assert.Contains("\"image\":\"masks/1.png\"", json);
        }
        var back = PhotoFile.FromBytes(bytes);
        Assert.Equal(doc.Composite, back.Composite);
        Assert.Equal(doc.Layers.Count, back.Layers.Count);
        for (var i = 0; i < doc.Layers.Count; i++)
        {
            PhotoLayer a = doc.Layers[i], b = back.Layers[i];
            Assert.Equal((a.Id, a.Name, a.Kind, a.Parent, a.Visible, a.Locked, a.Opacity, a.Blend, a.Clip, a.X, a.Y, a.Width, a.Height, a.Collapsed),
                (b.Id, b.Name, b.Kind, b.Parent, b.Visible, b.Locked, b.Opacity, b.Blend, b.Clip, b.X, b.Y, b.Width, b.Height, b.Collapsed));
            Assert.Null(b.Image);
            if (a.Png != null) Assert.Equal(Decoded(a.Png), Decoded(b.Png!));
            else Assert.Null(b.Png);
            Assert.Equal(a.Fill?.GetRawText(), b.Fill?.GetRawText());
            Assert.Equal(a.Adjust?.GetRawText(), b.Adjust?.GetRawText());
            Assert.Equal(a.Filters?.GetRawText(), b.Filters?.GetRawText());
            if (a.Mask == null) { Assert.Null(b.Mask); continue; }
            Assert.Equal((a.Mask.X, a.Mask.Y, a.Mask.Width, a.Mask.Height, a.Mask.Enabled, a.Mask.Background), (b.Mask!.X, b.Mask.Y, b.Mask.Width, b.Mask.Height, b.Mask.Enabled, b.Mask.Background));
            Assert.Equal(Decoded(a.Mask.Png!), Decoded(b.Mask.Png!));
        }
        Assert.Equal(2, back.Guides!.Count);

        var path = Path.Combine(Path.GetTempPath(), $"noorphoto-{Guid.NewGuid():N}{PhotoFile.Extension}");
        try { PhotoFile.Save(path, doc); Assert.Equal(doc.Layers[0].Png, PhotoFile.Load(path).Layers[0].Png); }
        finally { File.Delete(path); }
    }

    private static byte[] Zip(params (string Name, string Text)[] entries)
    {
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            foreach (var (name, text) in entries) { using var s = zip.CreateEntry(name).Open(); s.Write(Encoding.UTF8.GetBytes(text)); }
        return ms.ToArray();
    }

    [Fact]
    public void Files_that_arent_noorphoto_photos_are_refused()
    {
        Assert.Throws<InvalidDataException>(() => PhotoFile.FromBytes([1, 2, 3]));
        Assert.Throws<InvalidDataException>(() => PhotoFile.FromBytes(Zip(("hello.txt", "hi"))));
        const string ok = """{"width":10,"height":10,"layers":[{"id":"a","width":2,"height":2,"image":"layers/0.png"}]}""";
        Assert.Throws<InvalidDataException>(() => PhotoFile.FromBytes(Zip(("photo.json", ok)))); // its picture is missing
        Assert.Throws<InvalidDataException>(() => PhotoFile.FromBytes(Zip(("photo.json", ok), ("layers/0.png", "not a png"))));
        Assert.Throws<InvalidDataException>(() => PhotoFile.FromBytes(Zip(("photo.json", ok), ("../../evil.png", "x"))));
        Assert.Throws<InvalidDataException>(() => PhotoFile.FromBytes(Zip(("photo.json", ok.Replace("layers/0.png", "../layers/0.png")))));
        Assert.Throws<InvalidDataException>(() => PhotoFile.FromBytes(Zip(("photo.json", "{ not json"))));
        // A picture of the wrong size.
        var bytes = Zip(("photo.json", ok));
        using var ms = new MemoryStream(); ms.Write(bytes);
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Update, leaveOpen: true)) { using var s = zip.CreateEntry("layers/0.png").Open(); s.Write(SpritePng.Encode(3, 2, new byte[24])); }
        Assert.Throws<InvalidDataException>(() => PhotoFile.FromBytes(ms.ToArray()));
    }

    // ------------------------------------------------------------ PSD

    [Fact]
    public void A_psd_keeps_layers_groups_masks_and_blends_exactly()
    {
        var doc = Sample();
        var psd = PsdFile.Write(doc, out var notes);
        Assert.Equal("8BPS", Encoding.ASCII.GetString(psd, 0, 4));
        Assert.Contains("Adjustment layers aren't in the PSD as layers; the flattened picture has them.", notes);
        Assert.Contains("Fill layers are saved as pictures in the PSD.", notes);
        Assert.Contains("Live filters are saved applied, as part of the layers' pictures.", notes);

        var (back, readNotes) = PsdFile.Read(psd);
        Assert.Empty(readNotes);
        Assert.Equal((40, 30), (back.Width, back.Height));
        Assert.Equal([("x", 100.5), ("y", 12.0)], back.Guides!.Select(g => (g.Axis, g.At)));
        var want = doc.Layers.Where(l => l.Kind != "adjust").ToList();
        Assert.Equal(want.Select(l => l.Name), back.Layers.Select(l => l.Name));
        string? NameOf(PhotoDoc d, string? id) => id == null ? null : d.Layers.First(l => l.Id == id).Name;
        for (var i = 0; i < want.Count; i++)
        {
            PhotoLayer a = want[i], b = back.Layers[i];
            Assert.Equal(a.Kind == "fill" ? "pixel" : a.Kind, b.Kind);
            Assert.Equal(NameOf(doc, a.Parent), NameOf(back, b.Parent));
            Assert.Equal((a.Visible, a.Locked, a.Blend, a.Clip, a.Collapsed), (b.Visible, b.Locked, b.Blend, b.Clip, b.Collapsed));
            Assert.Equal(a.Opacity, b.Opacity, 3);
            if (a.Kind == "group") { Assert.Null(b.Png); continue; }
            Assert.Equal((a.X, a.Y, a.Width, a.Height), (b.X, b.Y, b.Width, b.Height));
            Assert.Equal(Decoded(a.Png!), Decoded(b.Png!));
            if (a.Mask == null) { Assert.Null(b.Mask); continue; }
            Assert.Equal((a.Mask.X, a.Mask.Y, a.Mask.Width, a.Mask.Height, a.Mask.Enabled, a.Mask.Background), (b.Mask!.X, b.Mask.Y, b.Mask.Width, b.Mask.Height, b.Mask.Enabled, b.Mask.Background));
            Assert.Equal(Decoded(a.Mask.Png!), Decoded(b.Mask.Png!));
        }
        // Groups come back in the same shape: what is in a group just below it, the group's entry on top.
        Assert.Equal(["Inside A", "Deep", "Inner", "Inside B", "Folder"], back.Layers.Skip(3).Take(5).Select(l => l.Name));

        // The merged picture: the flattened photo over white (here worked out by the writer, as the page sent none).
        var (cw, ch, merged) = SpritePng.Decode(Convert.FromBase64String(back.Composite!));
        Assert.Equal((40, 30), (cw, ch));
        Assert.All(Enumerable.Range(0, cw * ch), i => Assert.Equal(255, merged[i * 4 + 3]));
        var fill = 0.2; // the fill layer over the background at (20, 2): nothing else is there
        Assert.InRange(merged[(2 * 40 + 20) * 4], (int)(20 * 6 * (1 - fill) + 0x33 * fill) - 1, (int)(20 * 6 * (1 - fill) + 0x33 * fill) + 1);

        // The page's composite is used when there is one: half-clear black over white is mid grey.
        doc.Composite = Png(40, 30, (x, y) => (0, 0, 0, 128));
        var (withPage, _) = PsdFile.Read(PsdFile.Write(doc, out _));
        Assert.Equal(127, SpritePng.Decode(Convert.FromBase64String(withPage.Composite!)).Rgba[0]);
    }

    [Fact]
    public void Damaged_and_unsupported_psd_files_are_refused_clearly()
    {
        var psd = PsdFile.Write(Sample(), out _);
        foreach (var cut in new[] { 0, 10, 30, 60, 200, psd.Length / 2, psd.Length - 10 })
            Assert.Throws<InvalidDataException>(() => PsdFile.Read(psd[..cut]));
        var psb = (byte[])psd.Clone(); psb[5] = 2;
        Assert.Equal("Large documents (PSB) can't be opened yet.", Assert.Throws<InvalidDataException>(() => PsdFile.Read(psb)).Message);
        var cmyk = (byte[])psd.Clone(); cmyk[25] = 4;
        Assert.Contains("CMYK", Assert.Throws<InvalidDataException>(() => PsdFile.Read(cmyk)).Message);
        var deep = (byte[])psd.Clone(); deep[23] = 32;
        Assert.Throws<InvalidDataException>(() => PsdFile.Read(deep));
        // A layer count far larger than the file could hold.
        var lies = (byte[])psd.Clone();
        var at = 26 + 4 + 4 + (int)BinaryPrimitives.ReadUInt32BigEndian(lies.AsSpan(30)) + 4 + 4;
        BinaryPrimitives.WriteInt16BigEndian(lies.AsSpan(at), 30000);
        Assert.Throws<InvalidDataException>(() => PsdFile.Read(lies));
    }

    /// <summary>A big-endian byte builder for making small PSD files by hand.</summary>
    private sealed class Be
    {
        public readonly List<byte> B = [];
        public Be U8(int v) { B.Add((byte)v); return this; }
        public Be U16(int v) { B.Add((byte)(v >> 8)); B.Add((byte)v); return this; }
        public Be U32(long v) { for (var s = 24; s >= 0; s -= 8) B.Add((byte)(v >> s)); return this; }
        public Be Ascii(string s) { B.AddRange(Encoding.ASCII.GetBytes(s)); return this; }
        public Be Raw(IEnumerable<byte> b) { B.AddRange(b); return this; }
        public byte[] ToArray() => B.ToArray();
    }

    private static Be Header(int channels, int w, int h, int depth, int mode) =>
        new Be().Ascii("8BPS").U16(1).U32(0).U16(0).U16(channels).U32(h).U32(w).U16(depth).U16(mode).U32(0).U32(0);

    [Fact]
    public void A_psd_with_only_a_merged_picture_comes_in_as_one_background_layer()
    {
        // 16-bit grayscale, 3 × 2, no layers, raw merged data.
        var values = new[] { 0, 65535, 32768, 257, 1000, 65000 };
        var b = Header(1, 3, 2, 16, 1).U32(0).U16(0);
        foreach (var v in values) b.U16(v);
        var (doc, notes) = PsdFile.Read(b.ToArray());
        Assert.Single(doc.Layers);
        var bg = doc.Layers[0];
        Assert.Equal(("Background", "pixel", 0, 0, 3, 2), (bg.Name, bg.Kind, bg.X, bg.Y, bg.Width, bg.Height));
        var px = Decoded(bg.Png!);
        Assert.Equal(values.Select(v => (byte)((v * 255 + 32767) / 65535)), Enumerable.Range(0, 6).Select(i => px[i * 4]));
        Assert.All(Enumerable.Range(0, 6), i => Assert.Equal((px[i * 4], px[i * 4], 255), (px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3])));
        Assert.Contains("The picture had 16 bits per channel; it comes in with 8.", notes);
        Assert.Contains("The grey picture comes in as colour (RGB).", notes);
        Assert.Equal(bg.Png, doc.Composite);
    }

    [Fact]
    public void A_16_bit_psd_keeps_its_layers_in_lr16_and_zip_with_prediction_is_read()
    {
        // 2 × 1 RGB, 16 bits; one layer "Ink" in an Lr16 block, its channels ZIP-compressed with prediction.
        static byte[] Predicted(params int[] v)
        {
            var row = new byte[v.Length * 2];
            for (var i = 0; i < v.Length; i++) BinaryPrimitives.WriteUInt16BigEndian(row.AsSpan(i * 2), (ushort)(v[i] - (i > 0 ? v[i - 1] : 0)));
            using var ms = new MemoryStream();
            using (var z = new ZLibStream(ms, CompressionLevel.Optimal, leaveOpen: true)) z.Write(row);
            return [0, 3, .. ms.ToArray()];
        }
        var chans = new (int Id, byte[] Data)[] { (-1, Predicted(65535, 0)), (0, Predicted(65535, 32896)), (1, Predicted(0, 65535)), (2, Predicted(514, 514)) };
        var li = new Be().U16(1).U32(0).U32(0).U32(1).U32(2).U16(chans.Length);
        foreach (var (id, data) in chans) li.U16(id).U32(data.Length);
        li.Ascii("8BIM").Ascii("mul ").U8(255).U8(0).U8(0x08).U8(0);
        var name = new Be().U8(3).Ascii("Ink"); // 4 bytes: no padding
        li.U32(4 + 4 + name.B.Count).U32(0).U32(0).Raw(name.B);
        foreach (var (_, data) in chans) li.Raw(data);
        while (li.B.Count % 4 != 0) li.U8(0);
        var lm = new Be().U32(0).U32(0).Ascii("8BIM").Ascii("Lr16").U32(li.B.Count).Raw(li.B);
        var b = Header(3, 2, 1, 16, 3).U32(lm.B.Count).Raw(lm.B).U16(0);
        for (var i = 0; i < 6; i++) b.U16(65535);
        var (doc, notes) = PsdFile.Read(b.ToArray());
        var l = Assert.Single(doc.Layers);
        Assert.Equal(("Ink", "multiply", 2, 1), (l.Name, l.Blend, l.Width, l.Height));
        Assert.Equal([255, 0, 2, 255, 128, 255, 2, 0], Decoded(l.Png!));
        Assert.Contains("The picture had 16 bits per channel; it comes in with 8.", notes);
    }
}
