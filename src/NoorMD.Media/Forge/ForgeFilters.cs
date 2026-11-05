using System.Numerics;

namespace NoorMD.Media.Forge;

/// <summary>
/// Filters on a mask (levels, blur, sharpen, posterize, threshold, invert, contrast), worked on the texture's texels:
/// a blur and a sharpen only mix texels on the model (not the empty space between charts), and their radius is a share
/// of the texture, so every texture size looks the same.
/// </summary>
public static class ForgeFilters
{
    public static void Apply(ForgeBake bake, float[] v, IReadOnlyList<ForgeFilter> filters)
    {
        var size = bake.Size;
        foreach (var f in filters)
        {
            switch (f.Kind)
            {
                case "levels":
                {
                    float lo = (float)f.A, hi = MathF.Max((float)f.B, lo + 1e-4f), g = (float)(1 / f.C);
                    for (var i = 0; i < v.Length; i++) v[i] = MathF.Pow(Math.Clamp((v[i] - lo) / (hi - lo), 0, 1), g);
                    break;
                }
                case "invert": for (var i = 0; i < v.Length; i++) if (bake.Covered[i] != 0) v[i] = 1 - v[i]; break;
                case "posterize": { var n = MathF.Max(2, (float)Math.Round(f.A)) - 1; for (var i = 0; i < v.Length; i++) v[i] = MathF.Round(v[i] * n) / n; break; }
                case "threshold":
                {
                    float at = (float)f.A, soft = MathF.Max((float)f.B, 1e-4f);
                    for (var i = 0; i < v.Length; i++) { var t = Math.Clamp((v[i] - at + soft) / (2 * soft), 0, 1); v[i] = t * t * (3 - 2 * t); }
                    break;
                }
                case "contrast": { var k = (float)Math.Pow(4, f.A); for (var i = 0; i < v.Length; i++) v[i] = Math.Clamp((v[i] - 0.5f) * k + 0.5f, 0, 1); break; }
                case "blur": Blur(bake, v, Math.Max(1, (int)Math.Round(f.A * size))); break;
                case "sharpen":
                {
                    var soft = (float[])v.Clone();
                    Blur(bake, soft, Math.Max(1, (int)Math.Round(f.B * size)));
                    var a = (float)f.A;
                    for (var i = 0; i < v.Length; i++) if (bake.Covered[i] != 0) v[i] = Math.Clamp(v[i] + (v[i] - soft[i]) * a, 0, 1);
                    break;
                }
            }
        }
    }

    /// <summary>A box blur run three times (close to a gaussian), over the texels on the model only.</summary>
    internal static void Blur(ForgeBake bake, float[] v, int r)
    {
        var size = bake.Size;
        var tmp = new float[v.Length];
        for (var pass = 0; pass < 3; pass++)
        {
            Run(bake, v, tmp, r, size, true);
            Run(bake, tmp, v, r, size, false);
        }
    }

    private static void Run(ForgeBake bake, float[] src, float[] dst, int r, int size, bool horizontal)
    {
        Parallel.For(0, size, line =>
        {
            for (var k = 0; k < size; k++)
            {
                var i = horizontal ? line * size + k : k * size + line;
                if (bake.Covered[i] == 0) { dst[i] = src[i]; continue; }
                float sum = 0; var cnt = 0;
                for (var d = -r; d <= r; d++)
                {
                    var kk = k + d;
                    if (kk < 0 || kk >= size) continue;
                    var j = horizontal ? line * size + kk : kk * size + line;
                    if (bake.Covered[j] == 0) continue;
                    sum += src[j]; cnt++;
                }
                dst[i] = cnt > 0 ? sum / cnt : src[i];
            }
        });
    }

    /// <summary>A colour over another by a blend mode (linear colours, 0–1).</summary>
    public static Vector3 BlendColor(string mode, Vector3 b, Vector3 t) => mode switch
    {
        "multiply" => b * t,
        "screen" => Vector3.One - (Vector3.One - b) * (Vector3.One - t),
        "overlay" => new Vector3(Ov(b.X, t.X), Ov(b.Y, t.Y), Ov(b.Z, t.Z)),
        "softlight" => new Vector3(Sl(b.X, t.X), Sl(b.Y, t.Y), Sl(b.Z, t.Z)),
        "add" => Vector3.Min(b + t, Vector3.One),
        "subtract" => Vector3.Max(b - t, Vector3.Zero),
        "darken" => Vector3.Min(b, t),
        "lighten" => Vector3.Max(b, t),
        "difference" => Vector3.Abs(b - t),
        _ => t,
    };
    private static float Ov(float b, float t) => b < 0.5f ? 2 * b * t : 1 - 2 * (1 - b) * (1 - t);
    private static float Sl(float b, float t) => t < 0.5f ? b - (1 - 2 * t) * b * (1 - b) : b + (2 * t - 1) * (MathF.Sqrt(b) - b);

    /// <summary>A value (roughness, metal, height) over another: "add" and "subtract" move by the value's distance from the middle for height.</summary>
    public static float BlendValue(string mode, float b, float t, bool centred = false) => mode switch
    {
        "add" => Math.Clamp(b + (centred ? t - 0.5f : t), 0, 1),
        "subtract" => Math.Clamp(b - (centred ? t - 0.5f : t), 0, 1),
        "multiply" => MathF.Min(1, b * (centred ? t * 2 : t)),
        "max" => MathF.Max(b, t),
        "min" => MathF.Min(b, t),
        _ => t,
    };

    /// <summary>A colour's hue turned (degrees), its saturation, brightness and contrast moved (−1…1 each).</summary>
    public static Vector3 Adjust(Vector3 c, float hue, float sat, float bright, float contrast)
    {
        if (hue != 0 || sat != 0)
        {
            // Turned about the grey axis (hue); pulled towards or away from its grey (saturation).
            var grey = new Vector3((c.X + c.Y + c.Z) / 3);
            var d = c - grey;
            if (hue != 0)
            {
                var a = hue * MathF.PI / 180; var k = Vector3.Normalize(Vector3.One);
                d = d * MathF.Cos(a) + Vector3.Cross(k, d) * MathF.Sin(a) + k * Vector3.Dot(k, d) * (1 - MathF.Cos(a));
            }
            c = grey + d * (1 + sat);
        }
        if (bright != 0) c = bright > 0 ? c + (Vector3.One - c) * bright : c * (1 + bright);
        if (contrast != 0) { var k2 = MathF.Pow(4, contrast); c = (c - new Vector3(0.18f)) * k2 + new Vector3(0.18f); }
        return Vector3.Clamp(c, Vector3.Zero, Vector3.One);
    }
}
