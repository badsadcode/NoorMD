using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace NoorMD.Core.Sprite;

/// <summary>
/// PNG for sprites: 8-bit RGBA written exactly (straight alpha) and read back; reading also takes the PNGs other
/// programs write (grey, RGB, palette, with or without alpha; 8 bits, not interlaced) — enough for pixel art.
/// </summary>
public static class SpritePng
{
    private static readonly byte[] Signature = [137, 80, 78, 71, 13, 10, 26, 10];

    public static byte[] Encode(int width, int height, byte[] rgba)
    {
        if (rgba.Length != width * height * 4) throw new ArgumentException("The pixels don't match the size.");
        using var ms = new MemoryStream();
        ms.Write(Signature);
        var ihdr = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(ihdr, width); BinaryPrimitives.WriteInt32BigEndian(ihdr.AsSpan(4), height);
        ihdr[8] = 8; ihdr[9] = 6;
        Chunk(ms, "IHDR", ihdr);
        using var raw = new MemoryStream();
        using (var z = new ZLibStream(raw, CompressionLevel.Optimal, leaveOpen: true))
        {
            var row = new byte[1 + width * 4];
            var prev = new byte[width * 4];
            for (var y = 0; y < height; y++)
            {
                // Filter "up" when the row repeats a lot of the one above (common in pixel art), else none.
                var line = rgba.AsSpan(y * width * 4, width * 4);
                var same = 0;
                for (var i = 0; i < line.Length; i++) if (line[i] == prev[i]) same++;
                row[0] = (byte)(y > 0 && same > line.Length / 2 ? 2 : 0);
                for (var i = 0; i < line.Length; i++) row[1 + i] = row[0] == 2 ? (byte)(line[i] - prev[i]) : line[i];
                z.Write(row);
                line.CopyTo(prev);
            }
        }
        Chunk(ms, "IDAT", raw.ToArray());
        Chunk(ms, "IEND", []);
        return ms.ToArray();
    }

    public static (int Width, int Height, byte[] Rgba) Decode(byte[] png)
    {
        if (png.Length < 8 || !png.AsSpan(0, 8).SequenceEqual(Signature)) throw new InvalidDataException("Not a PNG image.");
        int w = 0, h = 0, depth = 0, type = 0, interlace = 0;
        byte[]? plte = null, trns = null;
        using var idat = new MemoryStream();
        for (var p = 8; p + 8 <= png.Length;)
        {
            var len = BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(p));
            if (len < 0 || p + 12 + len > png.Length) throw new InvalidDataException("A broken PNG.");
            var kind = Encoding.ASCII.GetString(png, p + 4, 4);
            var data = png.AsSpan(p + 8, len);
            switch (kind)
            {
                case "IHDR":
                    w = BinaryPrimitives.ReadInt32BigEndian(data); h = BinaryPrimitives.ReadInt32BigEndian(data[4..]);
                    depth = data[8]; type = data[9]; interlace = data[12];
                    break;
                case "PLTE": plte = data.ToArray(); break;
                case "tRNS": trns = data.ToArray(); break;
                case "IDAT": idat.Write(data); break;
            }
            p += 12 + len;
        }
        if (w < 1 || h < 1 || w > SpriteDoc.MaxSide * 4 || h > SpriteDoc.MaxSide * 4) throw new InvalidDataException("That PNG is too large or broken.");
        if (depth != 8 || interlace != 0) throw new InvalidDataException("Only 8-bit, not interlaced PNG pictures can be read here.");
        var channels = type switch { 0 => 1, 2 => 3, 3 => 1, 4 => 2, 6 => 4, _ => throw new InvalidDataException("An unknown kind of PNG.") };
        idat.Position = 0;
        using var z = new ZLibStream(idat, CompressionMode.Decompress);
        var stride = w * channels;
        var line = new byte[stride]; var prev = new byte[stride];
        var outPx = new byte[w * h * 4];
        for (var y = 0; y < h; y++)
        {
            var f = z.ReadByte();
            if (f < 0) throw new InvalidDataException("A PNG cut short.");
            z.ReadExactly(line);
            for (var x = 0; x < stride; x++)
            {
                int a = x >= channels ? line[x - channels] : 0, b = prev[x], c = x >= channels ? prev[x - channels] : 0;
                line[x] = (byte)(line[x] + f switch { 1 => a, 2 => b, 3 => (a + b) / 2, 4 => Paeth(a, b, c), _ => 0 });
            }
            for (var x = 0; x < w; x++)
            {
                var o = (y * w + x) * 4;
                switch (type)
                {
                    case 0: outPx[o] = outPx[o + 1] = outPx[o + 2] = line[x]; outPx[o + 3] = 255; break;
                    case 4: outPx[o] = outPx[o + 1] = outPx[o + 2] = line[x * 2]; outPx[o + 3] = line[x * 2 + 1]; break;
                    case 2: outPx[o] = line[x * 3]; outPx[o + 1] = line[x * 3 + 1]; outPx[o + 2] = line[x * 3 + 2]; outPx[o + 3] = 255; break;
                    case 6: Array.Copy(line, x * 4, outPx, o, 4); break;
                    case 3:
                        var i = line[x];
                        if (plte != null && i * 3 + 2 < plte.Length) { outPx[o] = plte[i * 3]; outPx[o + 1] = plte[i * 3 + 1]; outPx[o + 2] = plte[i * 3 + 2]; }
                        outPx[o + 3] = trns != null && i < trns.Length ? trns[i] : (byte)255;
                        break;
                }
            }
            (prev, line) = (line, prev);
        }
        return (w, h, outPx);
    }

    private static int Paeth(int a, int b, int c) { int p = a + b - c, pa = Math.Abs(p - a), pb = Math.Abs(p - b), pc = Math.Abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }

    private static void Chunk(System.IO.Stream s, string type, byte[] data)
    {
        Span<byte> len = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(len, data.Length);
        s.Write(len);
        var t = Encoding.ASCII.GetBytes(type);
        s.Write(t); s.Write(data);
        var crc = Crc32(t, data);
        BinaryPrimitives.WriteUInt32BigEndian(len, crc);
        s.Write(len);
    }

    private static readonly uint[] CrcTable = Enumerable.Range(0, 256).Select(n => { var c = (uint)n; for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1; return c; }).ToArray();

    private static uint Crc32(byte[] a, byte[] b)
    {
        var c = 0xFFFFFFFFu;
        foreach (var x in a) c = CrcTable[(c ^ x) & 0xFF] ^ (c >> 8);
        foreach (var x in b) c = CrcTable[(c ^ x) & 0xFF] ^ (c >> 8);
        return c ^ 0xFFFFFFFFu;
    }
}
