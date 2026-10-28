using System.Numerics;
using System.Text;
using System.Text.Json;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// glTF 2.0 binary (.glb): one file with the node tree (names and pivots), meshes (one primitive per material),
/// materials (metallic-roughness, alpha mode, double-sided) and their textures embedded as PNG. Y is up, units are
/// metres. Written by hand (the format is small), checked by the Khronos validator in CI.
/// </summary>
public static class GlbWriter
{
    private const int ArrayBuffer = 34962, ElementArrayBuffer = 34963;
    private const int Float = 5126, UnsignedInt = 5125, UnsignedShort = 5123;

    public static byte[] Write(Asset3D asset, string generator = "NoorMD Asset Bench")
    {
        var bin = new MemoryStream();
        var bufferViews = new List<object>();
        var accessors = new List<object>();
        var meshes = new List<object>();
        var nodes = new List<object>();
        var images = new List<object>();
        var textures = new List<object>();

        int View(byte[] data, int? target)
        {
            while (bin.Length % 4 != 0) bin.WriteByte(0);
            var offset = (int)bin.Length;
            bin.Write(data);
            var v = new Dictionary<string, object> { ["buffer"] = 0, ["byteOffset"] = offset, ["byteLength"] = data.Length };
            if (target != null) v["target"] = target.Value;
            bufferViews.Add(v);
            return bufferViews.Count - 1;
        }

        int Accessor(int view, int componentType, int count, string type, float[]? min = null, float[]? max = null)
        {
            var a = new Dictionary<string, object> { ["bufferView"] = view, ["componentType"] = componentType, ["count"] = count, ["type"] = type };
            if (min != null) a["min"] = min;
            if (max != null) a["max"] = max;
            accessors.Add(a);
            return accessors.Count - 1;
        }

        static byte[] Floats(IEnumerable<float> values)
        {
            var list = values.ToArray();
            var bytes = new byte[list.Length * 4];
            Buffer.BlockCopy(list, 0, bytes, 0, bytes.Length);
            return bytes;
        }

        int Texture(byte[] png)
        {
            var view = View(png, null);
            images.Add(new Dictionary<string, object> { ["bufferView"] = view, ["mimeType"] = "image/png" });
            textures.Add(new Dictionary<string, object> { ["source"] = images.Count - 1, ["sampler"] = 0 });
            return textures.Count - 1;
        }

        // Materials.
        var materials = asset.Materials.Select(m =>
        {
            var pbr = new Dictionary<string, object>
            {
                ["baseColorFactor"] = new[] { m.BaseColor.X, m.BaseColor.Y, m.BaseColor.Z, m.BaseColor.W },
                ["metallicFactor"] = m.Metallic, ["roughnessFactor"] = m.Roughness,
            };
            var mat = new Dictionary<string, object> { ["name"] = m.Name, ["pbrMetallicRoughness"] = pbr };
            if (m.BaseColorPng != null) pbr["baseColorTexture"] = new Dictionary<string, object> { ["index"] = Texture(m.BaseColorPng) };
            if (m.OcclusionRoughnessMetallicPng != null)
            {
                var t = Texture(m.OcclusionRoughnessMetallicPng);
                pbr["metallicRoughnessTexture"] = new Dictionary<string, object> { ["index"] = t };
                mat["occlusionTexture"] = new Dictionary<string, object> { ["index"] = t };
            }
            if (m.NormalPng != null) mat["normalTexture"] = new Dictionary<string, object> { ["index"] = Texture(m.NormalPng) };
            if (m.Alpha == "mask") { mat["alphaMode"] = "MASK"; mat["alphaCutoff"] = m.AlphaCutoff; }
            else if (m.Alpha == "blend") mat["alphaMode"] = "BLEND";
            if (m.DoubleSided) mat["doubleSided"] = true;
            return (object)mat;
        }).ToList();

        // Meshes and nodes (depth first; children listed by index).
        int AddNode(Node3D n)
        {
            var node = new Dictionary<string, object> { ["name"] = n.Name };
            if (n.Translation != Vector3.Zero) node["translation"] = new[] { n.Translation.X, n.Translation.Y, n.Translation.Z };
            if (n.Rotation != Quaternion.Identity) node["rotation"] = new[] { n.Rotation.X, n.Rotation.Y, n.Rotation.Z, n.Rotation.W };
            nodes.Add(node);
            var index = nodes.Count - 1;
            if (n.Mesh is { VertexCount: > 0 } m && m.TriangleCount > 0)
            {
                var (lo, hi) = m.Bounds();
                var attrs = new Dictionary<string, object>
                {
                    ["POSITION"] = Accessor(View(Floats(m.Positions.SelectMany(p => new[] { p.X, p.Y, p.Z })), ArrayBuffer), Float, m.VertexCount, "VEC3", [lo.X, lo.Y, lo.Z], [hi.X, hi.Y, hi.Z]),
                };
                if (m.Normals.Count == m.VertexCount) attrs["NORMAL"] = Accessor(View(Floats(m.Normals.SelectMany(p => new[] { p.X, p.Y, p.Z })), ArrayBuffer), Float, m.VertexCount, "VEC3");
                if (m.Tangents.Count == m.VertexCount && m.Normals.Count == m.VertexCount) attrs["TANGENT"] = Accessor(View(Floats(m.Tangents.SelectMany(t => new[] { t.X, t.Y, t.Z, t.W })), ArrayBuffer), Float, m.VertexCount, "VEC4");
                if (m.UV0.Count == m.VertexCount) attrs["TEXCOORD_0"] = Accessor(View(Floats(m.UV0.SelectMany(p => new[] { p.X, p.Y })), ArrayBuffer), Float, m.VertexCount, "VEC2");
                if (m.UV1.Count == m.VertexCount) attrs["TEXCOORD_1"] = Accessor(View(Floats(m.UV1.SelectMany(p => new[] { p.X, p.Y })), ArrayBuffer), Float, m.VertexCount, "VEC2");
                if (m.UV2.Count == m.VertexCount) attrs["TEXCOORD_2"] = Accessor(View(Floats(m.UV2.SelectMany(p => new[] { p.X, p.Y })), ArrayBuffer), Float, m.VertexCount, "VEC2");
                if (m.Colors.Count == m.VertexCount) attrs["COLOR_0"] = Accessor(View(Floats(m.Colors.SelectMany(p => new[] { Clamp01(p.X), Clamp01(p.Y), Clamp01(p.Z), Clamp01(p.W) })), ArrayBuffer), Float, m.VertexCount, "VEC4");
                var small = m.VertexCount <= ushort.MaxValue;
                var prims = new List<object>();
                foreach (var s in m.Submeshes.Where(s => s.Indices.Count >= 3))
                {
                    byte[] data;
                    if (small) { data = new byte[s.Indices.Count * 2]; for (var i = 0; i < s.Indices.Count; i++) BitConverter.TryWriteBytes(data.AsSpan(i * 2), (ushort)s.Indices[i]); }
                    else { data = new byte[s.Indices.Count * 4]; for (var i = 0; i < s.Indices.Count; i++) BitConverter.TryWriteBytes(data.AsSpan(i * 4), (uint)s.Indices[i]); }
                    var prim = new Dictionary<string, object> { ["attributes"] = attrs, ["indices"] = Accessor(View(data, ElementArrayBuffer), small ? UnsignedShort : UnsignedInt, s.Indices.Count, "SCALAR"), ["mode"] = 4 };
                    if (s.Material >= 0 && s.Material < materials.Count) prim["material"] = s.Material;
                    prims.Add(prim);
                }
                meshes.Add(new Dictionary<string, object> { ["name"] = m.Name, ["primitives"] = prims });
                node["mesh"] = meshes.Count - 1;
            }
            var children = n.Children.Select(AddNode).ToList();
            if (children.Count > 0) node["children"] = children;
            return index;
        }
        var root = AddNode(asset.Root);

        while (bin.Length % 4 != 0) bin.WriteByte(0);
        var gltf = new Dictionary<string, object>
        {
            ["asset"] = new Dictionary<string, object> { ["version"] = "2.0", ["generator"] = generator },
            ["scene"] = 0,
            ["scenes"] = new[] { new Dictionary<string, object> { ["name"] = asset.Name, ["nodes"] = new[] { root } } },
            ["nodes"] = nodes,
            ["buffers"] = new[] { new Dictionary<string, object> { ["byteLength"] = (int)bin.Length } },
            ["bufferViews"] = bufferViews,
            ["accessors"] = accessors,
        };
        if (meshes.Count > 0) gltf["meshes"] = meshes;
        if (materials.Count > 0) gltf["materials"] = materials;
        if (images.Count > 0)
        {
            gltf["images"] = images;
            gltf["textures"] = textures;
            // Repeat (bark and rock tile); trilinear.
            gltf["samplers"] = new[] { new Dictionary<string, object> { ["magFilter"] = 9729, ["minFilter"] = 9987, ["wrapS"] = 10497, ["wrapT"] = 10497 } };
        }
        var json = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(gltf));
        var jsonPadded = (json.Length + 3) & ~3;
        var binBytes = bin.ToArray();
        var total = 12 + 8 + jsonPadded + 8 + binBytes.Length;
        var outStream = new MemoryStream(total);
        void U32(uint v) => outStream.Write(BitConverter.GetBytes(v));
        U32(0x46546C67); U32(2); U32((uint)total);              // "glTF", version 2
        U32((uint)jsonPadded); U32(0x4E4F534A);                  // JSON chunk
        outStream.Write(json);
        for (var i = json.Length; i < jsonPadded; i++) outStream.WriteByte(0x20);
        U32((uint)binBytes.Length); U32(0x004E4942);             // BIN chunk
        outStream.Write(binBytes);
        return outStream.ToArray();
    }

    private static float Clamp01(float v) => float.IsFinite(v) ? Math.Clamp(v, 0, 1) : 0;
}
