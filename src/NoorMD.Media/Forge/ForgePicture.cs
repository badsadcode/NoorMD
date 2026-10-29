using System.Text.Json.Serialization;

namespace NoorMD.Media.Forge;

/// <summary>
/// A greyscale picture kept in the recipe (white paints, black doesn't): a brush tip, or a stencil laid over the view.
/// Kept inside the recipe, so it opens anywhere without the file it came from.
/// </summary>
public sealed class ForgePicture
{
    public const int MaxSide = 1024;

    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public int Width { get; set; }
    public int Height { get; set; }
    /// <summary>One byte a pixel, rows from the top, as base64.</summary>
    public string Data { get; set; } = "";

    private byte[]? _gray;
    [JsonIgnore] public byte[] Gray => _gray ??= Decode();

    private byte[] Decode()
    {
        try { var b = Convert.FromBase64String(Data); return b.Length == Width * Height ? b : new byte[Math.Max(0, Width * Height)]; }
        catch (FormatException) { return new byte[Math.Max(0, Width * Height)]; }
    }

    public static ForgePicture From(string id, string name, int width, int height, byte[] gray) =>
        new() { Id = id, Name = name, Width = width, Height = height, Data = Convert.ToBase64String(gray), _gray = gray };

    /// <summary>The value (0–1) at u, v (0–1 across, from the top), bilinear; outside it is 0, or it repeats when tiled.</summary>
    public float Sample(float u, float v, bool tile = false)
    {
        if (Width <= 0 || Height <= 0) return 0;
        if (tile) { u -= MathF.Floor(u); v -= MathF.Floor(v); }
        else if (u < 0 || v < 0 || u > 1 || v > 1) return 0;
        var g = Gray;
        float fx = u * Width - 0.5f, fy = v * Height - 0.5f;
        int x0 = (int)MathF.Floor(fx), y0 = (int)MathF.Floor(fy);
        float ax = fx - x0, ay = fy - y0;
        int X(int x) => tile ? ((x % Width) + Width) % Width : Math.Clamp(x, 0, Width - 1);
        int Y(int y) => tile ? ((y % Height) + Height) % Height : Math.Clamp(y, 0, Height - 1);
        float At(int x, int y) => g[Y(y) * Width + X(x)] / 255f;
        return (At(x0, y0) * (1 - ax) + At(x0 + 1, y0) * ax) * (1 - ay) + (At(x0, y0 + 1) * (1 - ax) + At(x0 + 1, y0 + 1) * ax) * ay;
    }

    public ForgePicture? Clamped()
    {
        Id = (Id ?? "").Trim();
        if (Id.Length is 0 or > 40 || Id.Any(c => !char.IsLetterOrDigit(c) && c != '-' && c != '_')) return null;
        Name = string.IsNullOrWhiteSpace(Name) ? "Picture" : Name.Trim()[..Math.Min(Name.Trim().Length, 80)];
        if (Width is < 1 or > MaxSide || Height is < 1 or > MaxSide) return null;
        if ((Data ?? "").Length > (Width * Height + 2) / 3 * 4 + 4) return null;
        return this;
    }

    /// <summary>
    /// A picture as a tip or stencil: its shape where it is transparent, else its brightness — turned around when it is
    /// dark on a light ground (as most brush pictures are), so the mark is what paints. Fitted into at most side × side.
    /// </summary>
    public static ForgePicture FromImage(string id, string name, int w, int h, float[] rgb, float[]? alpha, int side, bool square)
    {
        var scale = Math.Min(1.0, (double)side / Math.Max(w, h));
        int ow = Math.Max(1, (int)Math.Round(w * scale)), oh = Math.Max(1, (int)Math.Round(h * scale));
        int cw = square ? side : ow, ch = square ? side : oh;
        int ox = (cw - ow) / 2, oy = (ch - oh) / 2;
        var lum = new float[w * h];
        for (var i = 0; i < w * h; i++) lum[i] = 0.2126f * rgb[i * 3] + 0.7152f * rgb[i * 3 + 1] + 0.0722f * rgb[i * 3 + 2];
        var shaped = alpha != null && alpha.Any(a => a < 0.98f);
        // Dark on light: the border is mostly bright.
        var invert = false;
        if (!shaped)
        {
            double edge = 0; var count = 0;
            for (var x = 0; x < w; x++) { edge += lum[x] + lum[(h - 1) * w + x]; count += 2; }
            for (var y = 0; y < h; y++) { edge += lum[y * w] + lum[y * w + w - 1]; count += 2; }
            invert = edge / count > 0.5;
        }
        var outPx = new byte[cw * ch];
        for (var y = 0; y < oh; y++)
            for (var x = 0; x < ow; x++)
            {
                // Box filter over the source pixels this one covers.
                int sx0 = (int)(x / scale), sx1 = Math.Max(sx0 + 1, (int)((x + 1) / scale)), sy0 = (int)(y / scale), sy1 = Math.Max(sy0 + 1, (int)((y + 1) / scale));
                double sum = 0; var n = 0;
                for (var sy = sy0; sy < Math.Min(h, sy1); sy++)
                    for (var sx = sx0; sx < Math.Min(w, sx1); sx++)
                    {
                        var i = sy * w + sx;
                        sum += shaped ? alpha![i] : invert ? 1 - lum[i] : lum[i];
                        n++;
                    }
                outPx[(y + oy) * cw + x + ox] = (byte)Math.Clamp((int)Math.Round(sum / Math.Max(1, n) * 255), 0, 255);
            }
        return From(id, name, cw, ch, outPx);
    }
}

/// <summary>NoorForge's own brush tips, drawn here (128 pixels square), the same each time.</summary>
public static class ForgeTips
{
    public static readonly (string Id, string Name)[] All =
        [("square", "Square"), ("chalk", "Chalk"), ("splatter", "Splatter"), ("grunge", "Grunge"), ("scratches", "Scratches"), ("stipple", "Stipple"), ("leaf", "Leaf")];

    private static readonly Dictionary<string, ForgePicture> Cache = new();

    public static ForgePicture? Get(string id)
    {
        lock (Cache)
        {
            if (Cache.TryGetValue(id, out var hit)) return hit;
            if (!All.Any(t => t.Id == id)) return null;
            return Cache[id] = ForgePicture.From(id, All.First(t => t.Id == id).Name, Size, Size, Draw(id));
        }
    }

    private const int Size = 128;

    private static byte[] Draw(string id)
    {
        var px = new float[Size * Size];
        var rng = new Random(id.Aggregate(17, (h, c) => h * 31 + c));
        float Disc(float x, float y, float r, float soft) { var d = MathF.Sqrt(x * x + y * y); return Math.Clamp((r - d) / soft, 0, 1); }
        void Each(Func<float, float, float> f) { for (var y = 0; y < Size; y++) for (var x = 0; x < Size; x++) px[y * Size + x] = Math.Max(px[y * Size + x], f((x + 0.5f) / Size * 2 - 1, (y + 0.5f) / Size * 2 - 1)); }
        float Noise(float x, float y, float scale) => ForgeCompositor.Fbm(new System.Numerics.Vector3(x * scale, y * scale, 0.37f));
        switch (id)
        {
            case "square": Each((x, y) => Math.Clamp((0.9f - MathF.Max(MathF.Abs(x), MathF.Abs(y))) / 0.04f, 0, 1)); break;
            case "chalk": Each((x, y) => Disc(x, y, 0.92f, 0.1f) * (Noise(x, y, 9) > 0.47f ? 1 : 0.15f)); break;
            case "grunge": Each((x, y) => Disc(x, y, 0.95f, 0.5f) * Math.Clamp((Noise(x, y, 4) - 0.38f) * 4, 0, 1)); break;
            case "splatter":
                Each((x, y) => Disc(x, y, 0.42f, 0.05f));
                for (var i = 0; i < 26; i++)
                {
                    float a = (float)(rng.NextDouble() * Math.PI * 2), d = 0.3f + (float)rng.NextDouble() * 0.6f, r = 0.03f + (float)rng.NextDouble() * 0.11f * (1 - d);
                    float cx = MathF.Cos(a) * d, cy = MathF.Sin(a) * d;
                    Each((x, y) => Disc(x - cx, y - cy, r, 0.02f));
                }
                break;
            case "scratches":
                for (var i = 0; i < 9; i++)
                {
                    float a = (float)(rng.NextDouble() * 0.6 - 0.3), off = (float)(rng.NextDouble() * 1.4 - 0.7), len = 0.4f + (float)rng.NextDouble() * 0.5f, w = 0.012f + (float)rng.NextDouble() * 0.02f;
                    float ca = MathF.Cos(a), sa = MathF.Sin(a);
                    Each((x, y) => { var along = x * ca + y * sa; var across = -x * sa + y * ca - off; return MathF.Abs(along) < len ? Math.Clamp((w - MathF.Abs(across)) / 0.01f, 0, 1) * (1 - MathF.Abs(along) / len * 0.5f) : 0; });
                }
                break;
            case "stipple":
                for (var i = 0; i < 70; i++)
                {
                    float a = (float)(rng.NextDouble() * Math.PI * 2), d = MathF.Sqrt((float)rng.NextDouble()) * 0.85f;
                    float cx = MathF.Cos(a) * d, cy = MathF.Sin(a) * d;
                    Each((x, y) => Disc(x - cx, y - cy, 0.045f, 0.02f));
                }
                break;
            case "leaf":
                Each((x, y) =>
                {
                    // An almond with a vein down its middle, pointing up.
                    var w = 0.5f * MathF.Max(0, 1 - y * y) * (1 - 0.25f * y);
                    var inside = Math.Clamp((w - MathF.Abs(x)) / 0.04f, 0, 1) * Math.Clamp((0.95f - MathF.Abs(y)) / 0.04f, 0, 1);
                    return inside * (MathF.Abs(x) < 0.02f ? 0.55f : 1);
                });
                break;
        }
        var bytes = new byte[Size * Size];
        for (var i = 0; i < bytes.Length; i++) bytes[i] = (byte)Math.Clamp((int)MathF.Round(px[i] * 255), 0, 255);
        return bytes;
    }
}
