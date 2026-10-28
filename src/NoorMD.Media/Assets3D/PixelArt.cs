namespace NoorMD.Media.Assets3D;

/// <summary>
/// Small textures for games that draw with them: shrunk to a few dozen pixels (each pixel the average colour of the
/// opaque pixels it covers, cut out hard where less than about a third is covered), and, when asked, reduced to a
/// small palette. Engines draw them sampled nearest, so each pixel shows as a crisp square.
/// </summary>
public static class PixelArt
{
    /// <summary>The colour map shrunk (see the class), with its colours reduced to <paramref name="colours"/> when that is above 0.</summary>
    public static RawImage Make(RawImage src, int size, int colours = 0)
    {
        var w = Math.Clamp(size, 1, src.Width);
        var h = Math.Max(1, (int)Math.Round((double)src.Height * w / src.Width));
        var dst = new byte[w * h * 4];
        for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++)
            {
                int x0 = x * src.Width / w, x1 = Math.Max(x0 + 1, (x + 1) * src.Width / w);
                int y0 = y * src.Height / h, y1 = Math.Max(y0 + 1, (y + 1) * src.Height / h);
                double r = 0, g = 0, b = 0, cover = 0;
                var n = 0;
                for (var sy = y0; sy < y1; sy++)
                    for (var sx = x0; sx < x1; sx++)
                    {
                        var i = (sy * src.Width + sx) * 4;
                        double a = src.Rgba[i + 3];
                        r += src.Rgba[i] * a; g += src.Rgba[i + 1] * a; b += src.Rgba[i + 2] * a;
                        cover += a; n++;
                    }
                var o = (y * w + x) * 4;
                if (cover > 0) { dst[o] = (byte)(r / cover); dst[o + 1] = (byte)(g / cover); dst[o + 2] = (byte)(b / cover); }
                dst[o + 3] = cover / (n * 255.0) >= 0.35 ? (byte)255 : (byte)0;
            }
        if (colours > 0) Quantize(dst, colours);
        return new RawImage(w, h, dst);
    }

    /// <summary>A data map (ORM) shrunk: each pixel the plain average of those it covers.</summary>
    public static RawImage Shrink(RawImage src, int size)
    {
        var w = Math.Clamp(size, 1, src.Width);
        var h = Math.Max(1, (int)Math.Round((double)src.Height * w / src.Width));
        var dst = new byte[w * h * 4];
        for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++)
            {
                int x0 = x * src.Width / w, x1 = Math.Max(x0 + 1, (x + 1) * src.Width / w);
                int y0 = y * src.Height / h, y1 = Math.Max(y0 + 1, (y + 1) * src.Height / h);
                var sum = new double[4];
                var n = 0;
                for (var sy = y0; sy < y1; sy++)
                    for (var sx = x0; sx < x1; sx++, n++)
                        for (var c = 0; c < 4; c++) sum[c] += src.Rgba[(sy * src.Width + sx) * 4 + c];
                for (var c = 0; c < 4; c++) dst[(y * w + x) * 4 + c] = (byte)Math.Round(sum[c] / n);
            }
        return new RawImage(w, h, dst);
    }

    /// <summary>A normal map shrunk: the averaged normals set back to unit length (an average of slopes is flatter).</summary>
    public static RawImage Normals(RawImage src, int size)
    {
        var small = Shrink(src, size);
        var px = small.Rgba;
        for (var i = 0; i < px.Length; i += 4)
        {
            var n = new System.Numerics.Vector3(px[i] / 127.5f - 1, px[i + 1] / 127.5f - 1, px[i + 2] / 127.5f - 1);
            n = n.LengthSquared() > 1e-6f ? System.Numerics.Vector3.Normalize(n) : System.Numerics.Vector3.UnitZ;
            px[i] = (byte)Math.Round((n.X + 1) * 127.5f); px[i + 1] = (byte)Math.Round((n.Y + 1) * 127.5f); px[i + 2] = (byte)Math.Round((n.Z + 1) * 127.5f);
        }
        return small;
    }

    /// <summary>The opaque pixels' colours reduced to <paramref name="colours"/> (k-means from colours spread over the brightness range).</summary>
    private static void Quantize(byte[] px, int colours)
    {
        var opaque = Enumerable.Range(0, px.Length / 4).Where(i => px[i * 4 + 3] > 0).ToArray();
        if (opaque.Length == 0) return;
        float Luma(int i) => px[i * 4] * 0.3f + px[i * 4 + 1] * 0.59f + px[i * 4 + 2] * 0.11f;
        var sorted = opaque.OrderBy(Luma).ToArray();
        var k = Math.Min(colours, sorted.Length);
        var centres = new float[k, 3];
        for (var c = 0; c < k; c++)
        {
            var i = sorted[(int)((c + 0.5) * sorted.Length / k)];
            for (var ch = 0; ch < 3; ch++) centres[c, ch] = px[i * 4 + ch];
        }
        var of = new int[opaque.Length];
        for (var round = 0; round < 8; round++)
        {
            var sum = new double[k, 3];
            var count = new int[k];
            for (var j = 0; j < opaque.Length; j++)
            {
                var i = opaque[j] * 4;
                var best = 0;
                var bestD = float.MaxValue;
                for (var c = 0; c < k; c++)
                {
                    float dr = px[i] - centres[c, 0], dg = px[i + 1] - centres[c, 1], db = px[i + 2] - centres[c, 2];
                    var d = dr * dr + dg * dg + db * db;
                    if (d < bestD) { bestD = d; best = c; }
                }
                of[j] = best;
                count[best]++;
                for (var ch = 0; ch < 3; ch++) sum[best, ch] += px[i + ch];
            }
            for (var c = 0; c < k; c++)
                if (count[c] > 0)
                    for (var ch = 0; ch < 3; ch++) centres[c, ch] = (float)(sum[c, ch] / count[c]);
        }
        for (var j = 0; j < opaque.Length; j++)
            for (var ch = 0; ch < 3; ch++) px[opaque[j] * 4 + ch] = (byte)Math.Round(centres[of[j], ch]);
    }
}
