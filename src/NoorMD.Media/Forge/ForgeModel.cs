using System.Globalization;
using System.Numerics;
using System.Text;
using System.Text.Json;

namespace NoorMD.Media.Forge;

// NoorForge: texturing a model with layers and smart masks (see docs/NOORFORGE_PLAN.md). This file reads the model —
// GLB or OBJ — into triangles in world space, one texture set per material, and gives it UVs to paint on: its own if
// they are usable, else an automatic unwrap.

/// <summary>One material's triangles: a texture set of its own (three corners each, in world space).</summary>
public sealed class ForgeSet
{
    public string Name { get; set; } = "Material";
    public List<Vector3> Positions { get; } = [];
    public List<Vector3> Normals { get; } = [];
    public List<Vector2> Uvs { get; } = [];
    /// <summary>Which part (mesh) each triangle came from, for "by part" masks.</summary>
    public List<int> Parts { get; } = [];
    public int TriangleCount => Positions.Count / 3;
    /// <summary>Whether the UVs were made here (the model had none usable).</summary>
    public bool Unwrapped { get; set; }
}

public sealed class ForgeModel
{
    public string Name { get; set; } = "Model";
    public List<ForgeSet> Sets { get; } = [];
    public List<string> PartNames { get; } = [];
    public const int MaxTriangles = 1_000_000;

    public (Vector3 Min, Vector3 Max) Bounds()
    {
        var min = new Vector3(float.MaxValue); var max = new Vector3(float.MinValue);
        foreach (var p in Sets.SelectMany(s => s.Positions)) { min = Vector3.Min(min, p); max = Vector3.Max(max, p); }
        return Sets.Any(s => s.Positions.Count > 0) ? (min, max) : (Vector3.Zero, Vector3.Zero);
    }

    public int TriangleCount => Sets.Sum(s => s.TriangleCount);

    // ------------------------------------------------------------------ GLB

    public static ForgeModel ReadGlb(byte[] data, string name = "Model")
    {
        if (data.Length < 20 || BitConverter.ToUInt32(data, 0) != 0x46546C67) throw new InvalidDataException("That isn't a GLB file.");
        var jsonLen = (int)BitConverter.ToUInt32(data, 12);
        if (20 + jsonLen > data.Length) throw new InvalidDataException("The GLB file is cut short.");
        using var doc = JsonDocument.Parse(new ReadOnlyMemory<byte>(data, 20, jsonLen));
        var j = doc.RootElement;
        var binAt = 20 + jsonLen + 8;
        var binLen = binAt <= data.Length ? (int)BitConverter.ToUInt32(data, 20 + jsonLen) : 0;
        var model = new ForgeModel { Name = name };
        var materials = new List<string>();
        if (j.TryGetProperty("materials", out var mats))
            foreach (var m in mats.EnumerateArray()) materials.Add(m.TryGetProperty("name", out var n) && n.GetString() is { Length: > 0 } s ? s : $"Material {materials.Count + 1}");
        var sets = new Dictionary<int, ForgeSet>();
        ForgeSet SetFor(int material)
        {
            if (!sets.TryGetValue(material, out var set))
            {
                set = new ForgeSet { Name = material >= 0 && material < materials.Count ? materials[material] : "Material" };
                sets[material] = set; model.Sets.Add(set);
            }
            return set;
        }

        float[] Floats(int accessor, int comps)
        {
            var a = j.GetProperty("accessors")[accessor];
            var count = a.GetProperty("count").GetInt32();
            if (!a.TryGetProperty("bufferView", out var bvi)) return new float[count * comps];
            var bv = j.GetProperty("bufferViews")[bvi.GetInt32()];
            var off = binAt + Opt(bv, "byteOffset") + Opt(a, "byteOffset");
            var stride = Opt(bv, "byteStride");
            var type = a.GetProperty("componentType").GetInt32();
            var size = type switch { 5126 => 4, 5123 or 5122 => 2, 5121 or 5120 => 1, _ => throw new InvalidDataException("Unsupported vertex data.") };
            if (stride == 0) stride = size * comps;
            var norm = a.TryGetProperty("normalized", out var nz) && nz.GetBoolean();
            var outp = new float[count * comps];
            for (var i = 0; i < count; i++)
                for (var c = 0; c < comps; c++)
                {
                    var at = off + i * stride + c * size;
                    if (at + size > Math.Min(data.Length, binAt + binLen)) throw new InvalidDataException("The GLB's data is cut short.");
                    outp[i * comps + c] = type switch
                    {
                        5126 => BitConverter.ToSingle(data, at),
                        5123 => norm ? BitConverter.ToUInt16(data, at) / 65535f : BitConverter.ToUInt16(data, at),
                        5122 => norm ? Math.Max(-1, BitConverter.ToInt16(data, at) / 32767f) : BitConverter.ToInt16(data, at),
                        5121 => norm ? data[at] / 255f : data[at],
                        _ => norm ? Math.Max(-1, (sbyte)data[at] / 127f) : (sbyte)data[at],
                    };
                }
            return outp;
        }
        int[] Ints(int accessor)
        {
            var a = j.GetProperty("accessors")[accessor];
            var count = a.GetProperty("count").GetInt32();
            var bv = j.GetProperty("bufferViews")[a.GetProperty("bufferView").GetInt32()];
            var off = binAt + Opt(bv, "byteOffset") + Opt(a, "byteOffset");
            var type = a.GetProperty("componentType").GetInt32();
            var outp = new int[count];
            for (var i = 0; i < count; i++)
                outp[i] = type switch
                {
                    5125 => (int)BitConverter.ToUInt32(data, off + i * 4),
                    5123 => BitConverter.ToUInt16(data, off + i * 2),
                    5121 => data[off + i],
                    _ => throw new InvalidDataException("Unsupported index data."),
                };
            return outp;
        }

        void Node(int index, Matrix4x4 parent, int depth)
        {
            if (depth > 64) return;
            var node = j.GetProperty("nodes")[index];
            var local = Matrix4x4.Identity;
            if (node.TryGetProperty("matrix", out var mx))
            {
                var v = mx.EnumerateArray().Select(x => x.GetSingle()).ToArray();
                local = new Matrix4x4(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13], v[14], v[15]);
            }
            else
            {
                var s = node.TryGetProperty("scale", out var sc) ? Vec3(sc) : Vector3.One;
                var r = node.TryGetProperty("rotation", out var ro) ? new Quaternion(ro[0].GetSingle(), ro[1].GetSingle(), ro[2].GetSingle(), ro[3].GetSingle()) : Quaternion.Identity;
                var t = node.TryGetProperty("translation", out var tr) ? Vec3(tr) : Vector3.Zero;
                local = Matrix4x4.CreateScale(s) * Matrix4x4.CreateFromQuaternion(r) * Matrix4x4.CreateTranslation(t);
            }
            var world = local * parent;
            var nodeName = node.TryGetProperty("name", out var nn0) ? nn0.GetString() ?? "" : "";
            if (node.TryGetProperty("mesh", out var mi) && !IsCollision(nodeName))
            {
                var mesh = j.GetProperty("meshes")[mi.GetInt32()];
                var part = model.PartNames.Count;
                model.PartNames.Add(node.TryGetProperty("name", out var nn) && nn.GetString() is { Length: > 0 } ns ? ns : mesh.TryGetProperty("name", out var mn) && mn.GetString() is { Length: > 0 } ms ? ms : $"Part {part + 1}");
                Matrix4x4.Invert(world, out var inv);
                var normalMatrix = Matrix4x4.Transpose(inv);
                foreach (var prim in mesh.GetProperty("primitives").EnumerateArray())
                {
                    if (prim.TryGetProperty("mode", out var mode) && mode.GetInt32() != 4) continue; // triangles only
                    var attrs = prim.GetProperty("attributes");
                    if (!attrs.TryGetProperty("POSITION", out var pa)) continue;
                    var pos = Floats(pa.GetInt32(), 3);
                    var nrm = attrs.TryGetProperty("NORMAL", out var na) ? Floats(na.GetInt32(), 3) : null;
                    var uv = attrs.TryGetProperty("TEXCOORD_0", out var ua) ? Floats(ua.GetInt32(), 2) : null;
                    var idx = prim.TryGetProperty("indices", out var ia) ? Ints(ia.GetInt32()) : Enumerable.Range(0, pos.Length / 3).ToArray();
                    var set = SetFor(prim.TryGetProperty("material", out var pm) ? pm.GetInt32() : -1);
                    if (model.TriangleCount + idx.Length / 3 > MaxTriangles) throw new InvalidDataException($"The model has over {MaxTriangles:N0} triangles: too many to texture here.");
                    for (var k = 0; k + 2 < idx.Length; k += 3)
                    {
                        for (var c = 0; c < 3; c++)
                        {
                            var v = idx[k + c];
                            if (v < 0 || v * 3 + 2 >= pos.Length) throw new InvalidDataException("The GLB's indices are out of range.");
                            set.Positions.Add(Vector3.Transform(new Vector3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]), world));
                            set.Normals.Add(nrm != null ? SafeNormal(Vector3.TransformNormal(new Vector3(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]), normalMatrix)) : Vector3.Zero);
                            // glTF's v runs down the picture; inside NoorForge (as in OBJ) it runs up.
                            set.Uvs.Add(uv != null ? new Vector2(uv[v * 2], 1 - uv[v * 2 + 1]) : new Vector2(float.NaN));
                        }
                        set.Parts.Add(part);
                    }
                }
            }
            if (node.TryGetProperty("children", out var ch))
                foreach (var c in ch.EnumerateArray()) Node(c.GetInt32(), world, depth + 1);
        }

        var scene = j.TryGetProperty("scene", out var sc0) ? sc0.GetInt32() : 0;
        if (j.TryGetProperty("scenes", out var scenes) && scenes.GetArrayLength() > scene)
            foreach (var n in scenes[scene].GetProperty("nodes").EnumerateArray()) Node(n.GetInt32(), Matrix4x4.Identity, 0);
        else if (j.TryGetProperty("nodes", out var nodes))
            for (var i = 0; i < nodes.GetArrayLength(); i++) Node(i, Matrix4x4.Identity, 0);
        model.Finish();
        return model;
    }

    /// <summary>Collision shapes are not painted (and would hide the model from its own light): Godot's and Unreal's names for them.</summary>
    public static bool IsCollision(string name) =>
        name.EndsWith("-colonly", StringComparison.OrdinalIgnoreCase) || name.EndsWith("-convcolonly", StringComparison.OrdinalIgnoreCase)
        || name.EndsWith("-col", StringComparison.OrdinalIgnoreCase) || name.EndsWith("-convcol", StringComparison.OrdinalIgnoreCase)
        || name.StartsWith("Collision", StringComparison.OrdinalIgnoreCase) || name.StartsWith("UCX_", StringComparison.Ordinal) || name.StartsWith("UBX_", StringComparison.Ordinal);

    private static int Opt(JsonElement e, string name) => e.TryGetProperty(name, out var v) ? v.GetInt32() : 0;
    private static Vector3 Vec3(JsonElement e) => new(e[0].GetSingle(), e[1].GetSingle(), e[2].GetSingle());
    private static Vector3 SafeNormal(Vector3 v) => v.LengthSquared() > 1e-12f ? Vector3.Normalize(v) : Vector3.UnitY;

    // ------------------------------------------------------------------ OBJ

    public static ForgeModel ReadObj(string text, string name = "Model")
    {
        var model = new ForgeModel { Name = name };
        List<Vector3> v = [], vn = [];
        List<Vector2> vt = [];
        var sets = new Dictionary<string, ForgeSet>();
        var current = "Material";
        var part = -1;
        ForgeSet Set() { if (!sets.TryGetValue(current, out var s)) { s = new ForgeSet { Name = current }; sets[current] = s; model.Sets.Add(s); } return s; }
        static float F(string s) => float.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture);
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line[0] == '#') continue;
            var p = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
            switch (p[0])
            {
                case "v" when p.Length >= 4: v.Add(new Vector3(F(p[1]), F(p[2]), F(p[3]))); break;
                case "vn" when p.Length >= 4: vn.Add(SafeNormal(new Vector3(F(p[1]), F(p[2]), F(p[3])))); break;
                case "vt" when p.Length >= 3: vt.Add(new Vector2(F(p[1]), F(p[2]))); break;
                case "usemtl" when p.Length >= 2: current = string.Join(' ', p.Skip(1)); break;
                case "o" or "g" when p.Length >= 2: part = model.PartNames.Count; model.PartNames.Add(string.Join(' ', p.Skip(1))); break;
                case "f" when p.Length >= 4:
                {
                    if (part < 0) { part = 0; model.PartNames.Add(name); }
                    var corners = p.Skip(1).Select(c =>
                    {
                        var s = c.Split('/');
                        int Ref(int k, int count) => k < s.Length && s[k].Length > 0 && int.TryParse(s[k], out var x) ? (x < 0 ? count + x : x - 1) : -1;
                        return (V: Ref(0, v.Count), T: Ref(1, vt.Count), N: Ref(2, vn.Count));
                    }).ToList();
                    var set = Set();
                    for (var k = 1; k + 1 < corners.Count; k++)
                    {
                        foreach (var c in new[] { corners[0], corners[k], corners[k + 1] })
                        {
                            if (c.V < 0 || c.V >= v.Count) throw new InvalidDataException("The OBJ file refers to a point it doesn't have.");
                            set.Positions.Add(v[c.V]);
                            set.Normals.Add(c.N >= 0 && c.N < vn.Count ? vn[c.N] : Vector3.Zero);
                            set.Uvs.Add(c.T >= 0 && c.T < vt.Count ? vt[c.T] : new Vector2(float.NaN));
                        }
                        set.Parts.Add(part);
                    }
                    if (model.TriangleCount > MaxTriangles) throw new InvalidDataException($"The model has over {MaxTriangles:N0} triangles: too many to texture here.");
                    break;
                }
            }
        }
        model.Finish();
        return model;
    }

    // ------------------------------------------------------------------ after reading

    /// <summary>Normals where the file had none (smooth by shared position), empty sets dropped, and UVs to paint on.</summary>
    private void Finish()
    {
        Sets.RemoveAll(s => s.TriangleCount == 0);
        if (Sets.Count == 0) throw new InvalidDataException("The model has no triangles.");
        foreach (var s in Sets)
        {
            if (s.Normals.Any(n => n == Vector3.Zero)) SmoothNormals(s);
            if (!UvAtlas.Usable(s)) { UvAtlas.Unwrap(s); s.Unwrapped = true; }
        }
    }

    private static void SmoothNormals(ForgeSet s)
    {
        var sum = new Dictionary<(int, int, int), Vector3>();
        static (int, int, int) Key(Vector3 p) => ((int)MathF.Round(p.X * 1e4f), (int)MathF.Round(p.Y * 1e4f), (int)MathF.Round(p.Z * 1e4f));
        for (var t = 0; t < s.TriangleCount; t++)
        {
            var (a, b, c) = (s.Positions[t * 3], s.Positions[t * 3 + 1], s.Positions[t * 3 + 2]);
            var n = Vector3.Cross(b - a, c - a); // area-weighted
            for (var k = 0; k < 3; k++) { var key = Key(s.Positions[t * 3 + k]); sum[key] = sum.GetValueOrDefault(key) + n; }
        }
        for (var i = 0; i < s.Positions.Count; i++)
            if (s.Normals[i] == Vector3.Zero) s.Normals[i] = SafeNormal(sum[Key(s.Positions[i])]);
    }

    public static ForgeModel Read(string path)
    {
        var name = Path.GetFileNameWithoutExtension(path);
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".glb" => ReadGlb(File.ReadAllBytes(path), name),
            ".obj" => ReadObj(File.ReadAllText(path, Encoding.UTF8), name),
            _ => throw new InvalidDataException("NoorForge opens GLB and OBJ models."),
        };
    }
}
