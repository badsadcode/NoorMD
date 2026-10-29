using System.Numerics;
using System.Text;
using NoorMD.Media;
using NoorMD.Media.Forge;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>NoorForge stage 3: detail baked from a high-poly model, and exports made for each engine.</summary>
public class ForgeHighPolyTests
{
    /// <summary>A flat square 2 m across, facing up (the low model).</summary>
    private static string Flat() => "o Plate\nv -1 0 -1\nv 1 0 -1\nv 1 0 1\nv -1 0 1\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nvn 0 1 0\nf 1/1/1 3/3/1 2/2/1\nf 1/1/1 4/4/1 3/3/1\n";

    /// <summary>The same square, finely divided, with a round bump in the middle (the high model).</summary>
    private static string Bumpy()
    {
        var sb = new StringBuilder("o Bumpy\n");
        const int N = 60;
        float H(float x, float z) => 0.12f * MathF.Exp(-(x * x + z * z) / 0.08f);
        for (var j = 0; j <= N; j++)
            for (var i = 0; i <= N; i++)
            {
                float x = -1 + 2f * i / N, z = -1 + 2f * j / N;
                sb.Append(FormattableString.Invariant($"v {x} {H(x, z)} {z}\n"));
            }
        for (var j = 0; j < N; j++)
            for (var i = 0; i < N; i++)
            {
                int a = j * (N + 1) + i + 1, b = a + 1, c = a + N + 1, d = c + 1;
                sb.Append($"f {a} {c} {d}\nf {a} {d} {b}\n");
            }
        return sb.ToString();
    }

    [Fact]
    public void A_high_poly_models_detail_is_baked_into_the_normal_map_and_shading()
    {
        var low = ForgeModel.ReadObj(Flat(), "Low");
        var high = ForgeModel.ReadObj(Bumpy(), "High");
        var settings = new ForgeBake.Settings(AoRays: 16, HighDistance: 0.1f);
        var plain = ForgeBake.Bake(low, 0, 96, settings);
        var baked = ForgeBake.Bake(low, 0, 96, settings, high);
        var covered = baked.Covered.Count(c => c != 0);
        Assert.True(baked.HighHits > covered * 0.95, $"{baked.HighHits} of {covered}");
        Assert.Null(plain.HighNormal);
        // On the bump's side the normal leans away from its middle; far from it, straight up.
        int Near(float x, float z) => Enumerable.Range(0, 96 * 96).Where(i => baked.Covered[i] != 0).MinBy(i => MathF.Abs(baked.Position[i].X - x) + MathF.Abs(baked.Position[i].Z - z));
        var side = baked.Shade(Near(0.2f, 0));
        Assert.True(side.X > 0.25f && side.Y > 0.5f, $"{side}");
        Assert.True(baked.Shade(Near(0.85f, 0.85f)).Y > 0.99f);
        Assert.Equal(Vector3.UnitY, baked.Normal[Near(0.2f, 0)]); // the low model's own normal is kept (the normal map's frame)
        // Into the normal map (tangent space): tilted on the bump, flat (128, 128, 255) away from it; untouched without it.
        var recipe = new ForgeRecipe { Layers = [new ForgeLayer { Color = "#808080" }] }.Clamped();
        var tex = ForgeCompositor.Compose(low, 0, baked, recipe, _ => null);
        var flat = ForgeCompositor.Compose(low, 0, plain, recipe, _ => null);
        var at = Near(0.2f, 0);
        Assert.True(Math.Abs(tex.Normal[at * 3] - 128) + Math.Abs(tex.Normal[at * 3 + 1] - 128) > 40, $"{tex.Normal[at * 3]}, {tex.Normal[at * 3 + 1]}");
        Assert.True(Math.Abs(flat.Normal[at * 3] - 128) + Math.Abs(flat.Normal[at * 3 + 1] - 128) < 4);
        var far = Near(0.85f, 0.85f);
        Assert.True(Math.Abs(tex.Normal[far * 3] - 128) + Math.Abs(tex.Normal[far * 3 + 1] - 128) < 6);
        // Masks that look up read the detail: "on top" thins out on the bump's steep side.
        var top = ForgePaint.LayerMask(baked, new ForgeLayer { Mask = new ForgeMask { Kind = "top", Amount = 0.01, Softness = 0, Noise = 0 } }.Clamped(), 0);
        Assert.True(top[Near(0.2f, 0)] < top[far]);
    }

    [Fact]
    public void Exports_name_and_pack_the_maps_as_each_engine_expects()
    {
        var model = ForgeModel.ReadObj(Flat(), "Low");
        var bake = ForgeBake.Bake(model, 0, 32, new ForgeBake.Settings(AoRays: 0));
        var tex = ForgeCompositor.Compose(model, 0, bake, new ForgeRecipe { Layers = [new ForgeLayer { Color = "#808080", Roughness = 0.25, Metallic = 0.6 }] }.Clamped(), _ => null);
        string[] Names(string preset) => ForgeExport.SetFiles("Plate", tex, preset).Select(f => f.File).ToArray();
        Assert.Equal(["Plate_BaseColor.png", "Plate_Normal.png", "Plate_ORM.png", "Plate_Roughness.png", "Plate_Metallic.png", "Plate_AO.png", "Plate_Height.png", "Plate.tres"], Names("godot"));
        Assert.Equal(["Plate_BaseMap.png", "Plate_Normal.png", "Plate_MetallicSmoothness.png", "Plate_Occlusion.png", "Plate_Height.png"], Names("unity-urp"));
        Assert.Equal(["Plate_BaseMap.png", "Plate_Normal.png", "Plate_MaskMap.png", "Plate_Height.png"], Names("unity-hdrp"));
        Assert.Equal(["Plate_BaseColor.png", "Plate_Normal.png", "Plate_ORM.png", "Plate_Height.png"], Names("unreal"));
        var every = Names("all");
        Assert.Equal(every.Length, every.Distinct().Count());
        Assert.Contains("Plate_NormalDX.png", every);
        Assert.Contains("Plate_MaskMap.png", every);
        // The packed maps: URP's smoothness in alpha (1 − roughness); Unreal's normal with green flipped.
        var i = Array.IndexOf(bake.Covered, (byte)1);
        var urp = Decode(ForgeExport.SetFiles("Plate", tex, "unity-urp").First(f => f.File.EndsWith("MetallicSmoothness.png")).Data);
        Assert.Equal(tex.Metallic[i], urp[i * 4]);
        Assert.Equal(255 - tex.Roughness[i], urp[i * 4 + 3]);
        var hdrp = Decode(ForgeExport.SetFiles("Plate", tex, "unity-hdrp").First(f => f.File.EndsWith("MaskMap.png")).Data);
        Assert.Equal((tex.Metallic[i], tex.Ao[i], (byte)255, (byte)(255 - tex.Roughness[i])), (hdrp[i * 4], hdrp[i * 4 + 1], hdrp[i * 4 + 2], hdrp[i * 4 + 3]));
        var dx = Decode(ForgeExport.SetFiles("Plate", tex, "unreal").First(f => f.File.EndsWith("Normal.png")).Data, 3);
        Assert.Equal(255 - tex.Normal[i * 3 + 1], dx[i * 3 + 1]);
        Assert.Equal("unity-hdrp", ForgeRecipe.FromJson(new ForgeRecipe { Export = "unity-hdrp" }.ToJson()).Export);
        Assert.Equal("godot", new ForgeRecipe { Export = "blender?" }.Clamped().Export);
    }

    /// <summary>The pixels of a PNG this app wrote (one IDAT, filter bytes per row).</summary>
    private static byte[] Decode(byte[] png, int channels = 4)
    {
        int w = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
        var idat = new MemoryStream();
        for (var p = 8; p < png.Length;)
        {
            var len = (png[p] << 24) | (png[p + 1] << 16) | (png[p + 2] << 8) | png[p + 3];
            var type = Encoding.ASCII.GetString(png, p + 4, 4);
            if (type == "IDAT") idat.Write(png, p + 8, len);
            p += 12 + len;
        }
        idat.Position = 0;
        using var z = new System.IO.Compression.ZLibStream(idat, System.IO.Compression.CompressionMode.Decompress);
        var raw = new MemoryStream(); z.CopyTo(raw);
        var bytes = raw.ToArray();
        var stride = w * channels;
        var outPx = new byte[bytes.Length / (stride + 1) * stride];
        var prev = new byte[stride];
        for (int row = 0, o = 0; o < bytes.Length; row++, o += stride + 1)
        {
            var f = bytes[o];
            for (var x = 0; x < stride; x++)
            {
                int a = x >= channels ? outPx[row * stride + x - channels] : 0, b = prev[x], c = x >= channels ? prev[x - channels] : 0, v = bytes[o + 1 + x];
                v += f switch { 1 => a, 2 => b, 3 => (a + b) / 2, 4 => Paeth(a, b, c), _ => 0 };
                outPx[row * stride + x] = (byte)v;
            }
            Array.Copy(outPx, row * stride, prev, 0, stride);
        }
        return outPx;
    }

    private static int Paeth(int a, int b, int c) { int p = a + b - c, pa = Math.Abs(p - a), pb = Math.Abs(p - b), pc = Math.Abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
}
