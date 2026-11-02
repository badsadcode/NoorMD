using System.Numerics;
using System.Text.Json;
using NoorMD.Media.Forge;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>The textured model's tangents agree with how its normal map was made (glTF: green points up the picture).</summary>
public class ForgeTangentTests
{
    [Fact]
    public void Normal_map_green_points_up_the_picture_in_the_glb()
    {
        var model = ForgeModel.ReadObj(ForgeModelTests.CubeOnFloor(), "Test");
        var sets = Enumerable.Range(0, model.Sets.Count).Select(s =>
        {
            var bake = ForgeBake.Bake(model, s, 32, new ForgeBake.Settings(AoRays: 0));
            return ForgeCompositor.Compose(model, s, bake, new ForgeRecipe { Layers = [new ForgeLayer { Color = "#808080" }] }.Clamped(), _ => null);
        }).ToList();
        var glb = ForgeExport.Glb(model, sets);
        var jsonLen = BitConverter.ToInt32(glb, 12);
        using var doc = JsonDocument.Parse(glb.AsMemory(20, jsonLen));
        var binStart = 20 + jsonLen + 8;
        var root = doc.RootElement;
        float[] Floats(int accessor)
        {
            var a = root.GetProperty("accessors")[accessor];
            var v = root.GetProperty("bufferViews")[a.GetProperty("bufferView").GetInt32()];
            var off = binStart + (v.TryGetProperty("byteOffset", out var o) ? o.GetInt32() : 0) + (a.TryGetProperty("byteOffset", out var ao) ? ao.GetInt32() : 0);
            var n = a.GetProperty("count").GetInt32() * (a.GetProperty("type").GetString() switch { "VEC2" => 2, "VEC3" => 3, "VEC4" => 4, _ => 1 });
            var f = new float[n];
            Buffer.BlockCopy(glb, off, f, 0, n * 4);
            return f;
        }
        int[] Ints(int accessor)
        {
            var a = root.GetProperty("accessors")[accessor];
            var v = root.GetProperty("bufferViews")[a.GetProperty("bufferView").GetInt32()];
            var off = binStart + (v.TryGetProperty("byteOffset", out var o) ? o.GetInt32() : 0) + (a.TryGetProperty("byteOffset", out var ao) ? ao.GetInt32() : 0);
            var n = a.GetProperty("count").GetInt32();
            return a.GetProperty("componentType").GetInt32() switch
            {
                5125 => Enumerable.Range(0, n).Select(i => (int)BitConverter.ToUInt32(glb, off + i * 4)).ToArray(),
                5123 => Enumerable.Range(0, n).Select(i => (int)BitConverter.ToUInt16(glb, off + i * 2)).ToArray(),
                _ => Enumerable.Range(0, n).Select(i => (int)glb[off + i]).ToArray(),
            };
        }
        var checkedCorners = 0;
        foreach (var prim in root.GetProperty("meshes")[0].GetProperty("primitives").EnumerateArray())
        {
            var at = prim.GetProperty("attributes");
            var pos = Floats(at.GetProperty("POSITION").GetInt32()); var nrm = Floats(at.GetProperty("NORMAL").GetInt32());
            var tan = Floats(at.GetProperty("TANGENT").GetInt32()); var uv = Floats(at.GetProperty("TEXCOORD_0").GetInt32());
            var idx = Ints(prim.GetProperty("indices").GetInt32());
            Vector3 P(int i) => new(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
            Vector2 U(int i) => new(uv[i * 2], uv[i * 2 + 1]);
            for (var k = 0; k + 2 < idx.Length; k += 3)
            {
                int a = idx[k], b = idx[k + 1], c = idx[k + 2];
                Vector3 e1 = P(b) - P(a), e2 = P(c) - P(a); Vector2 d1 = U(b) - U(a), d2 = U(c) - U(a);
                var det = d1.X * d2.Y - d2.X * d1.Y;
                if (MathF.Abs(det) < 1e-9f) continue;
                // Up the picture is towards smaller glTF v (its first row is the top).
                var up = -(e2 * d1.X - e1 * d2.X) / det;
                foreach (var v in new[] { a, b, c })
                {
                    var n = new Vector3(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
                    var t = new Vector3(tan[v * 4], tan[v * 4 + 1], tan[v * 4 + 2]);
                    var bit = Vector3.Cross(n, t) * tan[v * 4 + 3];
                    Assert.True(Vector3.Dot(bit, up) > 0, "the bitangent points down the picture");
                    checkedCorners++;
                }
            }
        }
        Assert.True(checkedCorners > 12);
    }
}

/// <summary>Brush blend modes on paintings.</summary>
public class ForgeBlendTests
{
    [Fact]
    public void Blend_modes_mix_with_what_is_painted()
    {
        (float, float, float) red = (1, 0, 0), grey = (0.5f, 0.5f, 0.5f), blue = (0, 0, 1);
        Assert.Equal((0.5f, 0f, 0f), ForgeImagePaint.BlendRgb("multiply", red, grey));
        Assert.Equal((1f, 0.5f, 0.5f), ForgeImagePaint.BlendRgb("screen", red, grey));
        Assert.Equal((0.5f, 0.5f, 0.5f), ForgeImagePaint.BlendRgb("darken", grey, (1, 1, 1)));
        // Hue: the brush's hue with what is there's saturation and value.
        var (r, g, b) = ForgeImagePaint.BlendRgb("hue", red, blue);
        Assert.Equal(1, r, 3); Assert.Equal(0, g, 3); Assert.Equal(0, b, 3);
        (r, g, b) = ForgeImagePaint.BlendRgb("value", grey, red); // red at half value
        Assert.Equal(0.5f, r, 3); Assert.Equal(0, g, 3);
        (r, g, b) = ForgeImagePaint.BlendRgb("saturation", grey, red); // no saturation: grey at red's value
        Assert.Equal(1, r, 3); Assert.Equal(1, g, 3); Assert.Equal(1, b, 3);
        Assert.Equal("multiply", new ForgeStroke { Blend = "multiply" }.Clamped().Blend);
        Assert.Null(new ForgeStroke { Blend = "mix" }.Clamped().Blend);
        Assert.Null(new ForgeStroke { Blend = "nonsense" }.Clamped().Blend);
    }
}

/// <summary>The layers' height as bumps in the normal map.</summary>
public class ForgeReliefTests
{
    [Fact]
    public void Height_becomes_bumps_unless_relief_is_off()
    {
        var model = ForgeModel.ReadObj(ForgeModelTests.CubeOnFloor(), "Test");
        var bake = ForgeBake.Bake(model, 1, 128, new ForgeBake.Settings(AoRays: 0));
        double Tilt(double relief)
        {
            var recipe = new ForgeRecipe
            {
                Relief = relief,
                Layers = [new ForgeLayer { Color = "#808080", Height = 0.5 }, new ForgeLayer { Color = "#808080", Height = 1, Mask = new ForgeMask { Kind = "edges", Amount = 0.3, Noise = 0 } }],
            }.Clamped();
            var t = ForgeCompositor.Compose(model, 1, bake, recipe, _ => null);
            return Enumerable.Range(0, bake.Size * bake.Size).Where(i => bake.Covered[i] == 1).Average(i => 255.0 - t.Normal[i * 3 + 2]);
        }
        Assert.True(Tilt(0) < 0.5, "no relief: flat");
        Assert.True(Tilt(1) > 1, "relief: the raised edges tilt the normals");
        Assert.True(Tilt(3) > Tilt(1));
        Assert.Equal(4, new ForgeRecipe { Relief = 9 }.Clamped().Relief);
    }
}

/// <summary>Strokes that paint their own maps (as a painting program's brush: colour, roughness, metal, height).</summary>
public class ForgeChannelTests
{
    private static readonly ForgeModel Model = ForgeModel.ReadObj(ForgeModelTests.CubeOnFloor(), "Test");
    private static readonly ForgeBake Bake = ForgeBake.Bake(Model, 1, 128, new ForgeBake.Settings(AoRays: 0));
    private static readonly System.Numerics.Vector3 A = new(-0.25f, 1, 0), B = new(0.25f, 1, 0);

    private static ForgeStroke Dab(System.Numerics.Vector3 at, ForgeStrokeMaps? maps, string? color = null, bool erase = false) =>
        new ForgeStroke { Radius = 0.12, Hardness = 0.9, View = [0, -1, 0], Dabs = [at.X, at.Y, at.Z, 1, 1], Maps = maps, Color = color, Erase = erase }.Clamped();

    private static int At(ForgeBake b, System.Numerics.Vector3 p)
    {
        var best = -1; var d = float.MaxValue;
        for (var i = 0; i < b.Size * b.Size; i++)
            if (b.Covered[i] == 1 && b.Normal[i].Y > 0.9f && (b.Position[i] - p).LengthSquared() is var dd && dd < d) { d = dd; best = i; }
        return best;
    }

    private static ForgeTextures Run(params ForgeLayer[] layers) => ForgeCompositor.Compose(Model, 1, Bake, new ForgeRecipe { Relief = 0, Layers = [.. layers] }.Clamped(), _ => null);

    [Fact]
    public void Each_stroke_paints_only_its_own_maps()
    {
        var baseLayer = new ForgeLayer { Color = "#808080", Roughness = 0.8, Metallic = 0 };
        // A paint layer: shown only where painted; a metal stroke at A, a red colour stroke at B.
        var paint = new ForgeLayer { Color = "#808080", Mask = new ForgeMask { Kind = "none" } };
        paint.Strokes.Add(Dab(A, new ForgeStrokeMaps { Metallic = 1, Roughness = 0.2 }));
        paint.Strokes.Add(Dab(B, new ForgeStrokeMaps { Color = true }, "#ff0000"));
        var t = Run(baseLayer, paint);
        int a = At(Bake, A), b = At(Bake, B);
        Assert.True(t.Metallic[a] > 240 && t.Roughness[a] < 70, "metal and smooth at A");
        Assert.InRange(t.BaseColor[a * 3], 120, 135); // its colour left as it was (grey)
        Assert.True(t.BaseColor[b * 3] > 240 && t.BaseColor[b * 3 + 1] < 20, "red at B");
        Assert.True(t.Metallic[b] < 10 && t.Roughness[b] > 190, "B keeps the metal and roughness below");
        // Erasing only the metal at A: back to the base's metal, the roughness stroke stays.
        paint.Strokes.Add(Dab(A, new ForgeStrokeMaps { Metallic = 0 }, erase: true));
        t = Run(baseLayer, paint);
        Assert.True(t.Metallic[a] < 10 && t.Roughness[a] < 70);
    }

    [Fact]
    public void Height_strokes_raise_and_a_painting_keeps_its_colour_in_pixels()
    {
        var store = new ForgeImageStore();
        var big = ForgeBake.Bake(Model, 1, 256, new ForgeBake.Settings(AoRays: 0));
        var img = store.Create(256, ForgeImageStore.Blank(256, Model.Sets.Count));
        img = ForgeImagePaint.Apply(store, img, 1, big, new ForgeStroke { Radius = 0.12, Hardness = 0.9, View = [0, -1, 0], Dabs = [A.X, A.Y, A.Z, 1, 1], Color = "#0000ff" }.Clamped(), "#808080");
        var painting = new ForgeLayer { Image = img, UseRoughness = false, UseMetallic = false, UseHeight = false };
        painting.Strokes.Add(new ForgeStroke { Radius = 0.12, Hardness = 0.9, View = [0, -1, 0], Dabs = [B.X, B.Y, B.Z, 1, 1], Maps = new ForgeStrokeMaps { Height = 1 } }.Clamped());
        var t = ForgeCompositor.Compose(Model, 1, big, new ForgeRecipe { Relief = 0, Layers = [new ForgeLayer { Color = "#808080" }, painting] }.Clamped(), _ => null, id => store.Get(id));
        int a = At(big, A), b = At(big, B);
        Assert.True(t.BaseColor[a * 3 + 2] > 240, "blue from the picture at A");
        Assert.True(t.Height[b] > 240 && t.Height[a] < 140, "raised at B only");
        Assert.InRange(t.BaseColor[b * 3 + 2], 120, 135); // nothing painted in the picture at B
        Assert.True(ForgePaint.HasChannels(painting));
        Assert.Null(new ForgeStrokeMaps().Clamped());
        // Kept in the recipe file, as the page sends it.
        var back = ForgeRecipe.FromJson(new ForgeRecipe { Layers = [painting] }.ToJson());
        Assert.Equal(1, back.Layers[0].Strokes[0].Maps!.Height);
        Assert.Null(back.Layers[0].Strokes[0].Maps!.Metallic);
        var page = ForgeRecipe.FromJson("{\"layers\":[{\"name\":\"P\",\"strokes\":[{\"dabs\":[0,1,0,1,1],\"maps\":{\"color\":true,\"metallic\":1}}]}]}");
        Assert.True(page.Layers[0].Strokes[0].Maps!.Color); Assert.Equal(1, page.Layers[0].Strokes[0].Maps!.Metallic);
    }
}
