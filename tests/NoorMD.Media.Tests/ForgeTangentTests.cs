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
