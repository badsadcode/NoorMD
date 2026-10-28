using System.IO.Compression;

namespace NoorMD.Media;

/// <summary>A small PNG encoder (8-bit grey, RGB, RGBA and 16-bit grey), so materials can be written without a GUI library.</summary>
public static class PngWriter
{
    /// <param name="fast">Quicker, larger files (for previews).</param>
    public static byte[] Gray(int w, int h, byte[] px, bool fast = false) => Encode(w, h, 0, 8, 1, px, fast);
    public static byte[] Rgb(int w, int h, byte[] px, bool fast = false) => Encode(w, h, 2, 8, 3, px, fast);
    public static byte[] Rgba(int w, int h, byte[] px, bool fast = false) => Encode(w, h, 6, 8, 4, px, fast);

    /// <summary>16-bit greyscale from 0–1 values (height maps keep their smooth slopes).</summary>
    public static byte[] Gray16(int w, int h, float[] values, bool fast = false)
    {
        var px = new byte[w * h * 2];
        for (var i = 0; i < w * h; i++)
        {
            var v = (int)Math.Round(Math.Clamp(values[i], 0, 1) * 65535);
            px[i * 2] = (byte)(v >> 8); px[i * 2 + 1] = (byte)v;
        }
        return Encode(w, h, 0, 16, 2, px, fast);
    }

    private static byte[] Encode(int w, int h, byte colorType, byte depth, int bytesPerPixel, byte[] px, bool fast)
    {
        if (px.Length != w * h * bytesPerPixel) throw new ArgumentException("Pixel data doesn't match the size.");
        var stride = w * bytesPerPixel;
        var raw = new MemoryStream();
        using (var z = new ZLibStream(raw, fast ? CompressionLevel.Fastest : CompressionLevel.Optimal, leaveOpen: true))
        {
            // Each row with the "Up" filter (difference from the row above): smaller files for smooth maps.
            var row = new byte[stride + 1];
            for (var y = 0; y < h; y++)
            {
                row[0] = (byte)(y == 0 ? 0 : 2);
                for (var i = 0; i < stride; i++) row[i + 1] = (byte)(px[y * stride + i] - (y == 0 ? 0 : px[(y - 1) * stride + i]));
                z.Write(row);
            }
        }
        var outp = new MemoryStream();
        outp.Write([137, 80, 78, 71, 13, 10, 26, 10]);
        var ihdr = new byte[13];
        Be(ihdr, 0, w); Be(ihdr, 4, h);
        ihdr[8] = depth; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
        Chunk(outp, "IHDR", ihdr);
        Chunk(outp, "IDAT", raw.ToArray());
        Chunk(outp, "IEND", []);
        return outp.ToArray();
    }

    private static void Be(byte[] b, int at, int v) { b[at] = (byte)(v >> 24); b[at + 1] = (byte)(v >> 16); b[at + 2] = (byte)(v >> 8); b[at + 3] = (byte)v; }

    private static void Chunk(Stream s, string type, byte[] data)
    {
        var len = new byte[4]; Be(len, 0, data.Length);
        s.Write(len);
        var typeBytes = System.Text.Encoding.ASCII.GetBytes(type);
        s.Write(typeBytes);
        s.Write(data);
        var crc = Crc(typeBytes, data);
        var c = new byte[4]; Be(c, 0, (int)crc);
        s.Write(c);
    }

    private static readonly uint[] Table = Enumerable.Range(0, 256).Select(n =>
    {
        var c = (uint)n;
        for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
        return c;
    }).ToArray();

    private static uint Crc(byte[] type, byte[] data)
    {
        var c = 0xFFFFFFFFu;
        foreach (var b in type) c = Table[(c ^ b) & 0xFF] ^ (c >> 8);
        foreach (var b in data) c = Table[(c ^ b) & 0xFF] ^ (c >> 8);
        return c ^ 0xFFFFFFFFu;
    }
}
