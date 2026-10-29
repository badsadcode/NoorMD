using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace NoorMD.Core.Sprite;

/// <summary>
/// Aseprite's .aseprite / .ase files, read and written from its published file specification (no Aseprite or
/// LibreSprite code). Reading takes RGBA, greyscale and indexed sprites (turned into RGBA), image layers (groups and
/// tilemaps are passed over, their names noted), raw, linked and compressed cels, frame durations, tags and the
/// palette. Writing makes an RGBA sprite with compressed cels, the palette, layers and tags.
/// </summary>
public static class AsepriteFile
{
    private const ushort HeaderMagic = 0xA5E0, FrameMagic = 0xF1FA;
    private const ushort ChunkOldPalette = 0x0004, ChunkLayer = 0x2004, ChunkCel = 0x2005, ChunkColorProfile = 0x2007, ChunkTags = 0x2018, ChunkPalette = 0x2019, ChunkSlice = 0x2022;

    private static readonly string[] BlendNames = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity", "add", "subtract", "divide"];

    /// <summary>What was read, and what of the file NoorSprite left out (as sentences for the person).</summary>
    public sealed record Result(SpriteDoc Sprite, IReadOnlyList<string> Notes);

    public static Result Read(byte[] file)
    {
        var notes = new List<string>();
        if (file.Length < 128 || BinaryPrimitives.ReadUInt16LittleEndian(file.AsSpan(4)) != HeaderMagic) throw new InvalidDataException("This is not an Aseprite file.");
        int frames = U16(file, 6), width = U16(file, 8), height = U16(file, 10), depth = U16(file, 12);
        var headerFlags = U32(file, 14);
        int transparentIndex = file[28], gridW = U16(file, 40), gridH = U16(file, 42);
        if (depth is not (32 or 16 or 8)) throw new InvalidDataException($"An Aseprite colour depth NoorSprite doesn't know ({depth} bits).");
        if (frames < 1 || width < 1 || height < 1 || width > SpriteDoc.MaxSide || height > SpriteDoc.MaxSide || frames > SpriteDoc.MaxFrames)
            throw new InvalidDataException("That sprite is too large (NoorSprite takes up to 2048 × 2048 and 1024 frames).");
        var doc = new SpriteDoc { Width = width, Height = height, GridWidth = gridW > 0 ? gridW : 16, GridHeight = gridH > 0 ? gridH : 16 };
        var palette = new List<(byte R, byte G, byte B, byte A)>();
        // Layers as the file lists them; null for the ones passed over (groups, tilemaps).
        var layers = new List<SpriteLayer?>();
        var skipped = new List<string>();
        var p = 128;
        for (var f = 0; f < frames; f++)
        {
            if (p + 16 > file.Length) throw new InvalidDataException("The file is cut short.");
            var frameBytes = (int)U32(file, p);
            if (U16(file, p + 4) != FrameMagic || frameBytes < 16 || p + frameBytes > file.Length) throw new InvalidDataException("A broken frame in the file.");
            int oldChunks = U16(file, p + 6), duration = U16(file, p + 8);
            var newChunks = (int)U32(file, p + 12);
            var chunks = newChunks != 0 ? newChunks : oldChunks;
            doc.Frames.Add(new SpriteFrame { Duration = duration > 0 ? duration : 100 });
            var c = p + 16;
            for (var k = 0; k < chunks && c + 6 <= p + frameBytes; k++)
            {
                var size = (int)U32(file, c);
                var type = U16(file, c + 4);
                if (size < 6 || c + size > p + frameBytes) throw new InvalidDataException("A broken chunk in the file.");
                var d = file.AsSpan(c + 6, size - 6);
                switch (type)
                {
                    case ChunkLayer:
                    {
                        int flags = U16(d, 0), kind = U16(d, 2), blend = U16(d, 10), opacity = d[12];
                        var (name, after) = Str(d, 16);
                        if (kind != 0) { layers.Add(null); skipped.Add($"{(kind == 1 ? "group" : "tilemap")} “{name}”"); break; }
                        var layer = new SpriteLayer
                        {
                            Id = $"L{layers.Count + 1}", Name = name, Visible = (flags & 1) != 0, Locked = (flags & 2) == 0, Reference = (flags & 64) != 0,
                            Opacity = (headerFlags & 1) != 0 ? opacity : 255,
                            Blend = blend < BlendNames.Length && SpriteLayer.Blends.Contains(BlendNames[blend]) ? BlendNames[blend] : "normal",
                        };
                        if (blend < BlendNames.Length && !SpriteLayer.Blends.Contains(BlendNames[blend])) notes.Add($"Layer “{name}” blends as {BlendNames[blend]}, which NoorSprite shows as normal.");
                        layers.Add(layer); doc.Layers.Add(layer);
                        _ = after;
                        break;
                    }
                    case ChunkCel:
                    {
                        int li = U16(d, 0), x = (short)U16(d, 2), y = (short)U16(d, 4), opacity = d[6], celType = U16(d, 7);
                        if (li >= layers.Count || layers[li] == null) break;
                        var layer = layers[li]!;
                        SpriteCel? cel = null;
                        if (celType == 1)
                        {
                            // Linked: the same picture as on another frame (copied: NoorSprite doesn't link yet).
                            var from = U16(d, 16);
                            var src = doc.Cel(layer.Id, from);
                            if (src != null)
                            {
                                src.Link ??= $"k{layer.Id}x{from}";
                                cel = new SpriteCel { Layer = layer.Id, Frame = f, X = src.X, Y = src.Y, Width = src.Width, Height = src.Height, Opacity = opacity, Link = src.Link }.WithPixels((byte[])src.Pixels().Clone());
                            }
                        }
                        else if (celType is 0 or 2)
                        {
                            int w = U16(d, 16), h = U16(d, 18);
                            if (w < 1 || h < 1 || w > SpriteDoc.MaxSide || h > SpriteDoc.MaxSide) throw new InvalidDataException("A cel of an impossible size.");
                            var bpp = depth / 8;
                            var raw = celType == 0 ? d[20..].ToArray() : Inflate(d[20..], w * h * bpp);
                            if (raw.Length < w * h * bpp) throw new InvalidDataException("A cel's pixels are cut short.");
                            cel = new SpriteCel { Layer = layer.Id, Frame = f, X = x, Y = y, Width = w, Height = h, Opacity = opacity }.WithPixels(ToRgba(raw, w * h, depth, palette, transparentIndex));
                        }
                        if (cel != null) { doc.Cels.RemoveAll(e => e.Layer == cel.Layer && e.Frame == f); doc.Cels.Add(cel); }
                        break;
                    }
                    case ChunkSlice:
                    {
                        int keys = (int)U32(d, 0), sflags = (int)U32(d, 4);
                        var (name, q) = Str(d, 12);
                        // NoorSprite keeps a slice's first key (where it is on the first frame it is on).
                        if (keys > 0 && q + 20 <= d.Length)
                        {
                            var sl = new SpriteSlice { Name = name, X = (int)U32(d, q + 4), Y = (int)U32(d, q + 8), Width = (int)U32(d, q + 12), Height = (int)U32(d, q + 16) };
                            var r = q + 20;
                            if ((sflags & 1) != 0 && r + 16 <= d.Length) { sl.Nine = true; sl.CenterX = (int)U32(d, r); sl.CenterY = (int)U32(d, r + 4); sl.CenterWidth = (int)U32(d, r + 8); sl.CenterHeight = (int)U32(d, r + 12); r += 16; }
                            if ((sflags & 2) != 0 && r + 8 <= d.Length) { sl.HasPivot = true; sl.PivotX = (int)U32(d, r); sl.PivotY = (int)U32(d, r + 4); }
                            doc.Slices.Add(sl);
                            if (keys > 1) notes.Add($"Slice “{name}” moves over the frames: NoorSprite keeps where it is first.");
                        }
                        break;
                    }
                    case ChunkTags:
                    {
                        int count = U16(d, 0), q = 10;
                        for (var t = 0; t < count && q + 17 <= d.Length; t++)
                        {
                            int from = U16(d, q), to = U16(d, q + 2), dir = d[q + 4];
                            var (name, next) = Str(d, q + 17);
                            doc.Tags.Add(new SpriteTag { Name = name, From = from, To = to, Direction = dir switch { 1 => "reverse", 2 or 3 => "pingpong", _ => "forward" }, Color = $"#{d[q + 13]:x2}{d[q + 14]:x2}{d[q + 15]:x2}ff" });
                            q = next;
                        }
                        break;
                    }
                    case ChunkPalette:
                    {
                        int newSize = (int)U32(d, 0), first = (int)U32(d, 4), last = (int)U32(d, 8);
                        while (palette.Count < Math.Min(newSize, 4096)) palette.Add((0, 0, 0, 255));
                        var q = 20;
                        for (var i = first; i <= last && q + 6 <= d.Length; i++)
                        {
                            var entryFlags = U16(d, q);
                            if (i < palette.Count) palette[i] = (d[q + 2], d[q + 3], d[q + 4], d[q + 5]);
                            q += 6;
                            if ((entryFlags & 1) != 0) q = Str(d, q).Next;
                        }
                        break;
                    }
                    case ChunkOldPalette when palette.Count == 0:
                    {
                        int packets = U16(d, 0), q = 2, index = 0;
                        for (var pk = 0; pk < packets && q + 2 <= d.Length; pk++)
                        {
                            index += d[q];
                            var n = d[q + 1] == 0 ? 256 : d[q + 1];
                            q += 2;
                            for (var i = 0; i < n && q + 3 <= d.Length; i++, q += 3, index++)
                            {
                                while (palette.Count <= index) palette.Add((0, 0, 0, 255));
                                palette[index] = (d[q], d[q + 1], d[q + 2], 255);
                            }
                        }
                        break;
                    }
                }
                c += size;
            }
            p += frameBytes;
        }
        if (doc.Layers.Count == 0) throw new InvalidDataException("That sprite has no image layers NoorSprite can show.");
        if (skipped.Count > 0) notes.Add($"Left out: {string.Join(", ", skipped)} (their image layers are kept, flat).");
        doc.Palette = palette.Take(SpriteDoc.MaxPalette).Select(c => $"#{c.R:x2}{c.G:x2}{c.B:x2}{c.A:x2}").ToList();
        if (depth == 8) notes.Add("An indexed sprite: NoorSprite keeps its colours as RGBA (the palette is kept too).");
        return new Result(doc.Checked(), notes);
    }

    /// <summary>The sprite as an RGBA .aseprite file.</summary>
    public static byte[] Write(SpriteDoc doc)
    {
        doc.Checked();
        using var ms = new MemoryStream();
        var header = new byte[128];
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(4), HeaderMagic);
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(6), (ushort)doc.Frames.Count);
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(8), (ushort)doc.Width);
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(10), (ushort)doc.Height);
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(12), 32);
        BinaryPrimitives.WriteUInt32LittleEndian(header.AsSpan(14), 1); // layer opacity is valid
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(18), (ushort)Math.Clamp(doc.Frames[0].Duration, 1, 65535));
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(32), (ushort)(doc.Palette.Count is > 0 and < 256 ? doc.Palette.Count : 0));
        header[34] = 1; header[35] = 1; // square pixels
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(40), (ushort)doc.GridWidth);
        BinaryPrimitives.WriteUInt16LittleEndian(header.AsSpan(42), (ushort)doc.GridHeight);
        ms.Write(header);
        for (var f = 0; f < doc.Frames.Count; f++)
        {
            var chunks = new List<(ushort Type, byte[] Data)>();
            if (f == 0)
            {
                chunks.Add((ChunkColorProfile, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])); // sRGB
                if (doc.Palette.Count > 0) chunks.Add((ChunkPalette, PaletteChunk(doc.Palette)));
                foreach (var l in doc.Layers) chunks.Add((ChunkLayer, LayerChunk(l)));
                if (doc.Tags.Count > 0) chunks.Add((ChunkTags, TagsChunk(doc.Tags)));
                foreach (var sl in doc.Slices) chunks.Add((ChunkSlice, SliceChunk(sl)));
            }
            for (var li = 0; li < doc.Layers.Count; li++)
            {
                if (doc.Cel(doc.Layers[li].Id, f) is not { } cel) continue;
                // A linked cel after its first frame is written as a link to that frame.
                var first = cel.Link == null ? null : doc.Cels.Where(c => c.Layer == cel.Layer && c.Link == cel.Link).MinBy(c => c.Frame);
                chunks.Add((ChunkCel, first != null && first.Frame < f ? LinkedCelChunk(li, cel, first.Frame) : CelChunk(li, cel)));
            }
            var body = new MemoryStream();
            foreach (var (type, data) in chunks)
            {
                var head = new byte[6];
                BinaryPrimitives.WriteUInt32LittleEndian(head, (uint)(data.Length + 6));
                BinaryPrimitives.WriteUInt16LittleEndian(head.AsSpan(4), type);
                body.Write(head); body.Write(data);
            }
            var frameHeader = new byte[16];
            BinaryPrimitives.WriteUInt32LittleEndian(frameHeader, (uint)(body.Length + 16));
            BinaryPrimitives.WriteUInt16LittleEndian(frameHeader.AsSpan(4), FrameMagic);
            BinaryPrimitives.WriteUInt16LittleEndian(frameHeader.AsSpan(6), (ushort)Math.Min(chunks.Count, 0xFFFF));
            BinaryPrimitives.WriteUInt16LittleEndian(frameHeader.AsSpan(8), (ushort)Math.Clamp(doc.Frames[f].Duration, 1, 65535));
            BinaryPrimitives.WriteUInt32LittleEndian(frameHeader.AsSpan(12), (uint)chunks.Count);
            ms.Write(frameHeader); body.Position = 0; body.CopyTo(ms);
        }
        var bytes = ms.ToArray();
        BinaryPrimitives.WriteUInt32LittleEndian(bytes, (uint)bytes.Length);
        return bytes;
    }

    private static byte[] LayerChunk(SpriteLayer l)
    {
        var name = Encoding.UTF8.GetBytes(l.Name);
        var d = new byte[18 + name.Length];
        BinaryPrimitives.WriteUInt16LittleEndian(d, (ushort)((l.Visible ? 1 : 0) | (l.Locked ? 0 : 2) | (l.Reference ? 64 : 0)));
        BinaryPrimitives.WriteUInt16LittleEndian(d.AsSpan(10), (ushort)Math.Max(0, Array.IndexOf(BlendNames, l.Blend)));
        d[12] = (byte)l.Opacity;
        BinaryPrimitives.WriteUInt16LittleEndian(d.AsSpan(16), (ushort)name.Length);
        name.CopyTo(d, 18);
        return d;
    }

    private static byte[] CelChunk(int layer, SpriteCel c)
    {
        using var z = new MemoryStream();
        using (var zs = new ZLibStream(z, CompressionLevel.Optimal, leaveOpen: true)) zs.Write(c.Pixels());
        var d = new byte[20 + z.Length];
        BinaryPrimitives.WriteUInt16LittleEndian(d, (ushort)layer);
        BinaryPrimitives.WriteInt16LittleEndian(d.AsSpan(2), (short)c.X);
        BinaryPrimitives.WriteInt16LittleEndian(d.AsSpan(4), (short)c.Y);
        d[6] = (byte)c.Opacity;
        BinaryPrimitives.WriteUInt16LittleEndian(d.AsSpan(7), 2); // compressed image
        BinaryPrimitives.WriteUInt16LittleEndian(d.AsSpan(16), (ushort)c.Width);
        BinaryPrimitives.WriteUInt16LittleEndian(d.AsSpan(18), (ushort)c.Height);
        z.ToArray().CopyTo(d, 20);
        return d;
    }

    private static byte[] LinkedCelChunk(int layer, SpriteCel c, int frame)
    {
        var d = new byte[18];
        BinaryPrimitives.WriteUInt16LittleEndian(d, (ushort)layer);
        BinaryPrimitives.WriteInt16LittleEndian(d.AsSpan(2), (short)c.X);
        BinaryPrimitives.WriteInt16LittleEndian(d.AsSpan(4), (short)c.Y);
        d[6] = (byte)c.Opacity;
        BinaryPrimitives.WriteUInt16LittleEndian(d.AsSpan(7), 1); // linked
        BinaryPrimitives.WriteUInt16LittleEndian(d.AsSpan(16), (ushort)frame);
        return d;
    }

    private static byte[] SliceChunk(SpriteSlice s)
    {
        var name = Encoding.UTF8.GetBytes(s.Name);
        var size = 12 + 2 + name.Length + 20 + (s.Nine ? 16 : 0) + (s.HasPivot ? 8 : 0);
        var d = new byte[size];
        BinaryPrimitives.WriteUInt32LittleEndian(d, 1);
        BinaryPrimitives.WriteUInt32LittleEndian(d.AsSpan(4), (uint)((s.Nine ? 1 : 0) | (s.HasPivot ? 2 : 0)));
        BinaryPrimitives.WriteUInt16LittleEndian(d.AsSpan(12), (ushort)name.Length);
        name.CopyTo(d, 14);
        var q = 14 + name.Length;
        BinaryPrimitives.WriteUInt32LittleEndian(d.AsSpan(q), 0); // from frame 0
        BinaryPrimitives.WriteInt32LittleEndian(d.AsSpan(q + 4), s.X); BinaryPrimitives.WriteInt32LittleEndian(d.AsSpan(q + 8), s.Y);
        BinaryPrimitives.WriteUInt32LittleEndian(d.AsSpan(q + 12), (uint)s.Width); BinaryPrimitives.WriteUInt32LittleEndian(d.AsSpan(q + 16), (uint)s.Height);
        q += 20;
        if (s.Nine)
        {
            BinaryPrimitives.WriteInt32LittleEndian(d.AsSpan(q), s.CenterX); BinaryPrimitives.WriteInt32LittleEndian(d.AsSpan(q + 4), s.CenterY);
            BinaryPrimitives.WriteUInt32LittleEndian(d.AsSpan(q + 8), (uint)s.CenterWidth); BinaryPrimitives.WriteUInt32LittleEndian(d.AsSpan(q + 12), (uint)s.CenterHeight);
            q += 16;
        }
        if (s.HasPivot) { BinaryPrimitives.WriteInt32LittleEndian(d.AsSpan(q), s.PivotX); BinaryPrimitives.WriteInt32LittleEndian(d.AsSpan(q + 4), s.PivotY); }
        return d;
    }

    private static byte[] TagsChunk(List<SpriteTag> tags)
    {
        using var ms = new MemoryStream();
        var head = new byte[10];
        BinaryPrimitives.WriteUInt16LittleEndian(head, (ushort)tags.Count);
        ms.Write(head);
        foreach (var t in tags)
        {
            var name = Encoding.UTF8.GetBytes(t.Name);
            var d = new byte[19 + name.Length];
            BinaryPrimitives.WriteUInt16LittleEndian(d, (ushort)t.From);
            BinaryPrimitives.WriteUInt16LittleEndian(d.AsSpan(2), (ushort)t.To);
            d[4] = (byte)(t.Direction == "reverse" ? 1 : t.Direction == "pingpong" ? 2 : 0);
            d[13] = Convert.ToByte(t.Color[1..3], 16); d[14] = Convert.ToByte(t.Color[3..5], 16); d[15] = Convert.ToByte(t.Color[5..7], 16);
            BinaryPrimitives.WriteUInt16LittleEndian(d.AsSpan(17), (ushort)name.Length);
            name.CopyTo(d, 19);
            ms.Write(d);
        }
        return ms.ToArray();
    }

    private static byte[] PaletteChunk(List<string> palette)
    {
        var d = new byte[20 + palette.Count * 6];
        BinaryPrimitives.WriteUInt32LittleEndian(d, (uint)palette.Count);
        BinaryPrimitives.WriteUInt32LittleEndian(d.AsSpan(8), (uint)(palette.Count - 1));
        for (var i = 0; i < palette.Count; i++)
            for (var k = 0; k < 4; k++) d[20 + i * 6 + 2 + k] = Convert.ToByte(palette[i].Substring(1 + k * 2, 2), 16);
        return d;
    }

    private static byte[] ToRgba(byte[] raw, int n, int depth, List<(byte R, byte G, byte B, byte A)> palette, int transparent)
    {
        var o = new byte[n * 4];
        for (var i = 0; i < n; i++)
        {
            switch (depth)
            {
                case 32: Array.Copy(raw, i * 4, o, i * 4, 4); break;
                case 16: o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = raw[i * 2]; o[i * 4 + 3] = raw[i * 2 + 1]; break;
                default:
                    var k = raw[i];
                    if (k == transparent || k >= palette.Count) break;
                    (o[i * 4], o[i * 4 + 1], o[i * 4 + 2], o[i * 4 + 3]) = palette[k];
                    break;
            }
        }
        return o;
    }

    private static byte[] Inflate(ReadOnlySpan<byte> data, int expected)
    {
        using var z = new ZLibStream(new MemoryStream(data.ToArray()), CompressionMode.Decompress);
        var o = new byte[expected];
        var read = 0;
        while (read < expected) { var k = z.Read(o, read, expected - read); if (k <= 0) break; read += k; }
        return o;
    }

    private static int U16(ReadOnlySpan<byte> b, int at) => at + 2 <= b.Length ? BinaryPrimitives.ReadUInt16LittleEndian(b[at..]) : 0;
    private static uint U32(ReadOnlySpan<byte> b, int at) => at + 4 <= b.Length ? BinaryPrimitives.ReadUInt32LittleEndian(b[at..]) : 0;

    private static (string Value, int Next) Str(ReadOnlySpan<byte> b, int at)
    {
        var len = U16(b, at);
        if (at + 2 + len > b.Length) throw new InvalidDataException("A broken name in the file.");
        return (Encoding.UTF8.GetString(b.Slice(at + 2, len)), at + 2 + len);
    }
}
