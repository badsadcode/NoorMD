using System.Numerics;
using System.Text;
using System.Text.Json;
using NoorMD.Media;
using NoorMD.Media.Assets3D;
using Xunit;

namespace NoorMD.Media.Tests;

public class GlbWriterTests
{
    /// <summary>A unit cube (24 vertices, flat faces) with UVs, normals and optional wind colours.</summary>
    internal static Mesh3D Cube(string name, float size = 1, int material = 0, bool colors = false)
    {
        var m = new Mesh3D { Name = name };
        var h = size / 2;
        Vector3[] axes = [Vector3.UnitX, -Vector3.UnitX, Vector3.UnitY, -Vector3.UnitY, Vector3.UnitZ, -Vector3.UnitZ];
        var sub = m.Sub(material);
        foreach (var n in axes)
        {
            var u = MathF.Abs(n.Y) > 0.5f ? Vector3.UnitX : Vector3.Cross(Vector3.UnitY, n);
            var v = Vector3.Cross(n, u);
            var b = m.VertexCount;
            for (var k = 0; k < 4; k++)
            {
                float su = k is 1 or 2 ? 1 : -1, sv = k >= 2 ? 1 : -1;
                m.AddVertex((n + u * su + v * sv) * h + new Vector3(0, h, 0), n, new Vector2((su + 1) / 2, (sv + 1) / 2), colors ? new Vector4(0.5f, 0.2f, 0, 0.7f) : null);
            }
            sub.Indices.AddRange([b, b + 1, b + 2, b, b + 2, b + 3]);
        }
        return m;
    }

    internal static Asset3D Sample()
    {
        var asset = new Asset3D { Name = "Test tree" };
        var px = new byte[4 * 4 * 4];
        for (var i = 0; i < 16; i++) { px[i * 4] = 90; px[i * 4 + 1] = 160; px[i * 4 + 2] = 60; px[i * 4 + 3] = (byte)(i % 2 == 0 ? 255 : 0); }
        asset.Materials.Add(new Material3D { Name = "Bark", BaseColor = new Vector4(0.4f, 0.3f, 0.2f, 1) });
        asset.Materials.Add(new Material3D { Name = "Leaves", Alpha = "mask", DoubleSided = true, BaseColorPng = PngWriter.Rgba(4, 4, px) });
        var trunk = Cube("Trunk", 1, 0, colors: true);
        // A second material in the same mesh (two primitives sharing the attributes).
        trunk.Sub(1).Indices.AddRange([0, 1, 2]);
        asset.Root = new Node3D { Name = "Tree", Mesh = trunk };
        asset.Root.Children.Add(new Node3D { Name = "Branch_1", Translation = new Vector3(0, 1, 0), Rotation = Quaternion.CreateFromAxisAngle(Vector3.UnitZ, 0.5f), Mesh = Cube("Branch_1", 0.3f) });
        asset.Root.Children.Add(new Node3D { Name = "Empty" });
        return asset;
    }

    /// <summary>Splits a GLB into its JSON and binary chunks, checking the header and chunk framing.</summary>
    internal static (JsonElement Json, byte[] Bin) Parse(byte[] glb)
    {
        Assert.Equal(0x46546C67u, BitConverter.ToUInt32(glb, 0));
        Assert.Equal(2u, BitConverter.ToUInt32(glb, 4));
        Assert.Equal((uint)glb.Length, BitConverter.ToUInt32(glb, 8));
        var jsonLen = (int)BitConverter.ToUInt32(glb, 12);
        Assert.Equal(0x4E4F534Au, BitConverter.ToUInt32(glb, 16));
        Assert.Equal(0, jsonLen % 4);
        var json = JsonDocument.Parse(Encoding.UTF8.GetString(glb, 20, jsonLen).TrimEnd(' ')).RootElement;
        var binStart = 20 + jsonLen;
        var binLen = (int)BitConverter.ToUInt32(glb, binStart);
        Assert.Equal(0x004E4942u, BitConverter.ToUInt32(glb, binStart + 4));
        Assert.Equal(0, binLen % 4);
        Assert.Equal(glb.Length, binStart + 8 + binLen);
        return (json, glb.AsSpan(binStart + 8, binLen).ToArray());
    }

    [Fact]
    public void Writes_a_well_formed_glb()
    {
        var asset = Sample();
        Assert.Empty(asset.Root.Mesh!.Problems());
        var (json, bin) = Parse(GlbWriter.Write(asset));
        Assert.Equal("2.0", json.GetProperty("asset").GetProperty("version").GetString());
        Assert.Equal(bin.Length, json.GetProperty("buffers")[0].GetProperty("byteLength").GetInt32());

        var nodes = json.GetProperty("nodes");
        Assert.Equal(3, nodes.GetArrayLength());
        Assert.Equal("Tree", nodes[0].GetProperty("name").GetString());
        Assert.Equal([1, 2], nodes[0].GetProperty("children").EnumerateArray().Select(e => e.GetInt32()));
        Assert.Equal(1f, nodes[1].GetProperty("translation")[1].GetSingle());
        Assert.True(nodes[1].TryGetProperty("rotation", out _));
        Assert.False(nodes[2].TryGetProperty("mesh", out _));

        // Every buffer view inside the buffer and 4-byte aligned; accessors fit their views.
        var views = json.GetProperty("bufferViews").EnumerateArray().ToList();
        foreach (var v in views)
        {
            var off = v.GetProperty("byteOffset").GetInt32();
            Assert.Equal(0, off % 4);
            Assert.True(off + v.GetProperty("byteLength").GetInt32() <= bin.Length);
        }
        foreach (var a in json.GetProperty("accessors").EnumerateArray())
        {
            var size = a.GetProperty("componentType").GetInt32() switch { 5126 or 5125 => 4, 5123 => 2, _ => 1 };
            var comps = a.GetProperty("type").GetString() switch { "VEC2" => 2, "VEC3" => 3, "VEC4" => 4, _ => 1 };
            Assert.True(a.GetProperty("count").GetInt32() * size * comps <= views[a.GetProperty("bufferView").GetInt32()].GetProperty("byteLength").GetInt32());
        }

        var prims = json.GetProperty("meshes")[0].GetProperty("primitives");
        Assert.Equal(2, prims.GetArrayLength());
        var attrs = prims[0].GetProperty("attributes");
        foreach (var name in new[] { "POSITION", "NORMAL", "TEXCOORD_0", "COLOR_0" }) Assert.True(attrs.TryGetProperty(name, out _), name);
        var pos = json.GetProperty("accessors")[attrs.GetProperty("POSITION").GetInt32()];
        Assert.Equal(0f, pos.GetProperty("min")[1].GetSingle());
        Assert.Equal(1f, pos.GetProperty("max")[1].GetSingle());
        Assert.Equal(5123, json.GetProperty("accessors")[prims[0].GetProperty("indices").GetInt32()].GetProperty("componentType").GetInt32());
        Assert.Equal(1, prims[1].GetProperty("material").GetInt32());

        var leaves = json.GetProperty("materials")[1];
        Assert.Equal("MASK", leaves.GetProperty("alphaMode").GetString());
        Assert.True(leaves.GetProperty("doubleSided").GetBoolean());
        var image = json.GetProperty("images")[0];
        Assert.Equal("image/png", image.GetProperty("mimeType").GetString());
        var iv = views[image.GetProperty("bufferView").GetInt32()];
        Assert.Equal(0x89, bin[iv.GetProperty("byteOffset").GetInt32()]);
    }

    [Fact]
    public void Positions_round_trip_and_big_meshes_use_32_bit_indices()
    {
        var m = new Mesh3D { Name = "Big" };
        var sub = m.Sub(0);
        for (var i = 0; i < 70000; i++) m.AddVertex(new Vector3(i * 0.001f, i % 7, 0), Vector3.UnitZ, Vector2.Zero);
        for (var i = 0; i + 2 < 70000; i += 3) sub.Indices.AddRange([i, i + 1, i + 2]);
        var asset = new Asset3D { Root = new Node3D { Mesh = m } };
        var (json, bin) = Parse(GlbWriter.Write(asset));
        var prim = json.GetProperty("meshes")[0].GetProperty("primitives")[0];
        var acc = json.GetProperty("accessors");
        Assert.Equal(5125, acc[prim.GetProperty("indices").GetInt32()].GetProperty("componentType").GetInt32());
        var view = json.GetProperty("bufferViews")[acc[prim.GetProperty("attributes").GetProperty("POSITION").GetInt32()].GetProperty("bufferView").GetInt32()];
        var off = view.GetProperty("byteOffset").GetInt32();
        Assert.Equal(m.Positions[69999].X, BitConverter.ToSingle(bin, off + 69999 * 12));
        Assert.Equal(m.Positions[69999].Y, BitConverter.ToSingle(bin, off + 69999 * 12 + 4));
    }

    [Fact]
    public void Mesh_problems_are_found()
    {
        var m = Cube("Cube");
        Assert.Empty(m.Problems());
        m.Sub(0).Indices.AddRange([0, 0, 1]);
        m.Normals[3] = new Vector3(0, 2, 0);
        m.Sub(1).Indices.Add(999);
        var p = m.Problems();
        Assert.Contains("a triangle uses a vertex twice", p);
        Assert.Contains("a normal is not unit length", p);
        Assert.Contains("an index is out of range", p);
        Assert.Contains("a submesh's index count is not a multiple of 3", p);
        m.ComputeNormals();
        Assert.DoesNotContain("a normal is not unit length", m.Problems());
    }

    /// <summary>For CI: writes sample GLBs to NOORMD_GLB_OUT so the Khronos glTF validator can check them.</summary>
    [Fact]
    public void Writes_samples_for_the_validator()
    {
        var dir = Environment.GetEnvironmentVariable("NOORMD_GLB_OUT");
        if (string.IsNullOrEmpty(dir)) return;
        Directory.CreateDirectory(dir);
        File.WriteAllBytes(Path.Combine(dir, "sample.glb"), GlbWriter.Write(Sample()));
        foreach (var (name, asset) in AssetSamples.All()) File.WriteAllBytes(Path.Combine(dir, name + ".glb"), GlbWriter.Write(asset));
    }
}

/// <summary>Generated assets the validator checks (filled in as the generators arrive).</summary>
internal static class AssetSamples
{
    public static IEnumerable<(string Name, Asset3D Asset)> All()
    {
        foreach (var (preset, mode) in new[] { ("oak", "merged"), ("pine", "separate"), ("stylized-oak", "mixed"), ("stylized-dead", "merged"),
                     ("cypress", "merged"), ("mangrove", "separate"), ("willow", "merged"), ("palm", "merged"), ("stylized-horror", "merged"), ("baobab", "merged") })
        {
            var r = TreePresets.Make(preset);
            r.Branches = mode;
            r.Quality = "low";
            r.Lods = 2;
            var build = TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 64 });
            for (var i = 0; i < build.Lods.Count; i++) yield return ($"tree-{preset}-{mode}-lod{i}", build.Lods[i]);
        }
        var colour = TreePresets.Make("birch");
        colour.WindData = "color";
        colour.Quality = "low";
        colour.Lods = 1;
        yield return ("tree-birch-colour-wind", TreeBuilder.Build(colour, new TreeBuilder.Options { TextureSize = 0 }).Lods[0]);
    }
}
