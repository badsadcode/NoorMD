using System.IO.Compression;
using System.Numerics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using NoorMD.Media.Assets3D;

namespace NoorMD.Media.Mesh;

/// <summary>A face of a NoorMesh mesh: its corners (vertex indices, counter-clockwise from outside), a UV per corner, a material slot, smooth or flat.</summary>
public sealed class MeshFace
{
    public int[] V { get; set; } = [];
    public float[]? Uv { get; set; }
    public int M { get; set; }
    public bool S { get; set; }
}

/// <summary>A NoorMesh mesh as the page keeps it: positions (x, y, z…, metres, +Z up), n-gon faces, edge flags by "a_b".</summary>
public sealed class MeshData
{
    public float[] V { get; set; } = [];
    public List<MeshFace> F { get; set; } = [];
    public Dictionary<string, JsonElement>? E { get; set; }
    [JsonIgnore] public int VertexCount => V.Length / 3;
    public Vector3 Vertex(int i) => new(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]);
}

/// <summary>
/// A picture a material uses: packed (kept inside the .noormesh file) or linked (a path to a file beside it, read when the
/// scene opens; Missing when it isn't there). Data is the picture's bytes (base64) on the way to and from the page.
/// </summary>
public sealed class MeshTexture
{
    public string Id { get; set; } = "t1";
    public string Name { get; set; } = "Texture";
    public string? Path { get; set; }
    public bool Packed { get; set; }
    public string? Data { get; set; }
    public string? Mime { get; set; }
    public bool Missing { get; set; }
}

/// <summary>A material of the scene (as glTF's metallic-roughness): base colour (linear RGBA 0–1), roughness, metallic.</summary>
public sealed class MeshMaterial
{
    /// <summary>Its base colour picture (a texture's id), multiplied by the colour, as glTF does.</summary>
    public string? Texture { get; set; }
    public string Id { get; set; } = "m1";
    public string Name { get; set; } = "Material";
    public float[] Color { get; set; } = [0.8f, 0.8f, 0.8f, 1];
    public float Roughness { get; set; } = 0.5f;
    public float Metallic { get; set; }
}

/// <summary>An object of the scene: its mesh placed by location, rotation (degrees, X then Y then Z, as Blender's XYZ) and scale.</summary>
public sealed class MeshObject
{
    public string Id { get; set; } = "o1";
    public string Name { get; set; } = "Object";
    public string Kind { get; set; } = "mesh";
    public float[] T { get; set; } = [0, 0, 0];
    public float[] R { get; set; } = [0, 0, 0];
    public float[] S { get; set; } = [1, 1, 1];
    public bool Hidden { get; set; }
    /// <summary>Its material slots (ids of the scene's materials): a face's M is the slot it uses.</summary>
    public List<string>? Materials { get; set; }
    public MeshData Mesh { get; set; } = new();
}

/// <summary>
/// A NoorMesh scene (docs/NOORMESH_PLAN.md): its objects, saved as a .noormesh file (a zip holding scene.json), exported
/// as GLB or OBJ (turned to their +Y up, n-gons triangulated for GLB, kept for OBJ) and made from GLB or OBJ files.
/// Everything read is checked: indices in range, numbers finite, sizes within limits.
/// </summary>
public sealed class MeshDoc
{
    public const int CurrentVersion = 1;
    public const int MaxObjects = 1000, MaxVertices = 4_000_000, MaxFaces = 4_000_000;
    public const long MaxFileBytes = 512L * 1024 * 1024;

    public string Format { get; set; } = "noormesh";
    public int Version { get; set; } = CurrentVersion;
    public List<MeshObject> Objects { get; set; } = [];
    public List<MeshMaterial>? Materials { get; set; }
    public List<MeshTexture>? Textures { get; set; }
    public const long MaxTextureBytes = 64L * 1024 * 1024;

    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    // ------------------------------------------------------------------ reading, checking, writing

    public static MeshDoc FromJson(string json)
    {
        MeshDoc? doc;
        try { doc = JsonSerializer.Deserialize<MeshDoc>(json, Json); }
        catch (JsonException ex) { throw new InvalidDataException("That isn't a NoorMesh scene: " + ex.Message); }
        return (doc ?? throw new InvalidDataException("That isn't a NoorMesh scene.")).Checked();
    }
    public string ToJson() => JsonSerializer.Serialize(this, Json);

    /// <summary>The scene checked (and what can be put right, put right): throws InvalidDataException when it can't be used.</summary>
    public MeshDoc Checked()
    {
        if (Format != "noormesh") throw new InvalidDataException("That isn't a NoorMesh scene.");
        if (Version > CurrentVersion) throw new InvalidDataException($"That scene was saved by a newer NoorMD (format {Version}); update NoorMD to open it.");
        if (Objects.Count > MaxObjects) throw new InvalidDataException($"Too many objects (more than {MaxObjects}).");
        long verts = 0, faces = 0;
        // Materials: ids unique, numbers in range; slots pointing at none are dropped.
        var matIds = new HashSet<string>(StringComparer.Ordinal);
        Materials = (Materials ?? []).Take(1000).Where(x => x != null).ToList();
        foreach (var mt in Materials)
        {
            if (string.IsNullOrWhiteSpace(mt.Id) || !matIds.Add(mt.Id)) { var n = 1; while (!matIds.Add($"m{n}")) n++; mt.Id = $"m{n}"; }
            mt.Name = string.IsNullOrWhiteSpace(mt.Name) ? "Material" : mt.Name.Trim()[..Math.Min(64, mt.Name.Trim().Length)];
            var c = mt.Color is { Length: >= 3 } ? mt.Color : [0.8f, 0.8f, 0.8f, 1];
            mt.Color = [.. Enumerable.Range(0, 4).Select(k => k < c.Length && float.IsFinite(c[k]) ? Math.Clamp(c[k], 0, 1) : k == 3 ? 1 : 0.8f)];
            mt.Roughness = float.IsFinite(mt.Roughness) ? Math.Clamp(mt.Roughness, 0, 1) : 0.5f;
            mt.Metallic = float.IsFinite(mt.Metallic) ? Math.Clamp(mt.Metallic, 0, 1) : 0;
        }
        // Textures: ids unique, pictures within the size limit and really base64; a material's map pointing at none dropped.
        var texIds = new HashSet<string>(StringComparer.Ordinal);
        Textures = (Textures ?? []).Take(1000).Where(x => x != null).ToList();
        foreach (var t in Textures)
        {
            if (string.IsNullOrWhiteSpace(t.Id) || !texIds.Add(t.Id)) { var n = 1; while (!texIds.Add($"t{n}")) n++; t.Id = $"t{n}"; }
            t.Name = string.IsNullOrWhiteSpace(t.Name) ? "Texture" : t.Name.Trim()[..Math.Min(128, t.Name.Trim().Length)];
            if (t.Path is { Length: > 2000 }) t.Path = null;
            if (t.Data != null && (t.Data.Length > MaxTextureBytes * 4 / 3 + 4 || !Convert.TryFromBase64String(t.Data, new byte[t.Data.Length], out _))) { t.Data = null; }
            if (t.Mime is not ("image/png" or "image/jpeg" or "image/webp" or "image/bmp")) t.Mime = t.Data != null ? "image/png" : null;
            if (!t.Packed && string.IsNullOrEmpty(t.Path)) t.Packed = true;
        }
        foreach (var mt in Materials) if (mt.Texture != null && !texIds.Contains(mt.Texture)) mt.Texture = null;
        if (Textures.Count == 0) Textures = null;
        if (Materials.Count == 0) Materials = null;
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var o in Objects)
        {
            o.Name = string.IsNullOrWhiteSpace(o.Name) ? "Object" : o.Name.Trim()[..Math.Min(64, o.Name.Trim().Length)];
            if (string.IsNullOrWhiteSpace(o.Id) || !ids.Add(o.Id)) { var n = 1; while (!ids.Add($"o{n}")) n++; o.Id = $"o{n}"; }
            o.Kind = string.IsNullOrWhiteSpace(o.Kind) || o.Kind.Length > 20 ? "mesh" : o.Kind;
            float[] Vec(float[]? v, float d) => v is { Length: 3 } && v.All(float.IsFinite) ? v : [d, d, d];
            o.T = Vec(o.T, 0); o.R = Vec(o.R, 0); o.S = Vec(o.S, 1);
            o.Materials = o.Materials?.Where(id => id != null && matIds.Contains(id)).Take(256).ToList();
            if (o.Materials is { Count: 0 }) o.Materials = null;
            var m = o.Mesh ??= new MeshData();
            if (m.V.Length % 3 != 0 || m.V.Any(x => !float.IsFinite(x))) throw new InvalidDataException($"\"{o.Name}\": its vertex positions are broken.");
            var n3 = m.VertexCount;
            m.F = (m.F ?? []).Where(f => f.V is { Length: >= 3 }).ToList();
            foreach (var f in m.F)
            {
                if (f.V.Any(i => i < 0 || i >= n3)) throw new InvalidDataException($"\"{o.Name}\": a face points at a missing vertex.");
                if (f.Uv != null && (f.Uv.Length != f.V.Length * 2 || f.Uv.Any(x => !float.IsFinite(x)))) f.Uv = null;
                f.M = Math.Clamp(f.M, 0, 255);
            }
            verts += n3; faces += m.F.Count;
        }
        if (verts > MaxVertices || faces > MaxFaces) throw new InvalidDataException("That scene is too big for NoorMesh.");
        return this;
    }

    /// <summary>The scene as a .noormesh file: a zip with scene.json in it.</summary>
    public byte[] ToFile()
    {
        using var ms = new MemoryStream();
        // Packed pictures go into the zip as files of their own (textures/<id>.png …); linked ones keep only their path.
        var kept = (Textures ?? []).Select(t => (t, t.Data, t.Missing)).ToList();
        try
        {
            using var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true);
            foreach (var (t, data, _) in kept)
            {
                if (t.Packed && data != null)
                {
                    var ext = t.Mime switch { "image/jpeg" => ".jpg", "image/webp" => ".webp", "image/bmp" => ".bmp", _ => ".png" };
                    var te = zip.CreateEntry($"textures/{SafeId(t.Id)}{ext}", CompressionLevel.NoCompression);
                    using var ts = te.Open(); var bytes = Convert.FromBase64String(data); ts.Write(bytes, 0, bytes.Length);
                }
                t.Data = null; t.Missing = false;
            }
            var e = zip.CreateEntry("scene.json", CompressionLevel.Optimal);
            using var w = new StreamWriter(e.Open(), new UTF8Encoding(false));
            w.Write(ToJson());
        }
        finally { foreach (var (t, data, missing) in kept) { t.Data = data; t.Missing = missing; } }
        return ms.ToArray();
    }
    private static string SafeId(string id) => new(id.Where(c => char.IsAsciiLetterOrDigit(c) || c == '_' || c == '-').Take(40).ToArray());

    public static MeshDoc FromFile(byte[] data)
    {
        try
        {
            using var zip = new ZipArchive(new MemoryStream(data), ZipArchiveMode.Read);
            var e = zip.GetEntry("scene.json") ?? throw new InvalidDataException("That isn't a NoorMesh file (no scene inside).");
            if (e.Length > MaxFileBytes) throw new InvalidDataException("That NoorMesh file is too big.");
            string json;
            using (var r = new StreamReader(e.Open(), Encoding.UTF8)) json = r.ReadToEnd();
            var doc = FromJson(json);
            foreach (var t in doc.Textures ?? [])
            {
                if (!t.Packed) continue;
                var te = zip.Entries.FirstOrDefault(x => x.FullName.StartsWith($"textures/{SafeId(t.Id)}.", StringComparison.Ordinal));
                if (te == null) { t.Missing = true; continue; }
                if (te.Length > MaxTextureBytes) throw new InvalidDataException("A picture in that NoorMesh file is too big.");
                using var s2 = te.Open(); using var buf = new MemoryStream(); s2.CopyTo(buf);
                t.Data = Convert.ToBase64String(buf.ToArray());
                t.Mime = MimeOf(te.Name);
            }
            return doc;
        }
        catch (InvalidDataException) { throw; }
        catch (Exception ex) when (ex is IOException or NotSupportedException) { throw new InvalidDataException("That isn't a NoorMesh file: " + ex.Message); }
    }

    public static string MimeOf(string name) => System.IO.Path.GetExtension(name).ToLowerInvariant() switch { ".jpg" or ".jpeg" => "image/jpeg", ".webp" => "image/webp", ".bmp" => "image/bmp", _ => "image/png" };
    private static bool IsPng(byte[] b) => b.Length > 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47;

    // ------------------------------------------------------------------ geometry helpers

    /// <summary>An object's matrix (column-major 4×4): location · rotation (Z·Y·X) · scale, as the page composes it.</summary>
    public static double[] Matrix(MeshObject o) => M4.Compose(o.T, o.R, o.S);

    public static (Vector3 N, float Area) FaceNormal(MeshData m, MeshFace f)
    {
        double nx = 0, ny = 0, nz = 0;
        for (var k = 0; k < f.V.Length; k++)
        {
            var a = m.Vertex(f.V[k]); var b = m.Vertex(f.V[(k + 1) % f.V.Length]);
            nx += (a.Y - b.Y) * (a.Z + b.Z); ny += (a.Z - b.Z) * (a.X + b.X); nz += (a.X - b.X) * (a.Y + b.Y);
        }
        var l = Math.Sqrt(nx * nx + ny * ny + nz * nz);
        return l > 0 ? (new Vector3((float)(nx / l), (float)(ny / l), (float)(nz / l)), (float)(l / 2)) : (Vector3.UnitZ, 0);
    }

    /// <summary>A face as triangles of corner positions (ear clipping on its own plane: concave n-gons come out right).</summary>
    public static List<(int A, int B, int C)> Triangulate(MeshData m, MeshFace f)
    {
        var n = f.V.Length;
        var tris = new List<(int, int, int)>();
        if (n == 3) { tris.Add((0, 1, 2)); return tris; }
        var (nrm, _) = FaceNormal(m, f);
        var ax = MathF.Abs(nrm.X) < 0.9f ? Vector3.UnitX : Vector3.UnitY;
        var u = Vector3.Normalize(Vector3.Cross(ax, nrm)); var w = Vector3.Cross(nrm, u);
        var p = f.V.Select(i => { var q = m.Vertex(i); return (X: (double)Vector3.Dot(q, u), Y: (double)Vector3.Dot(q, w)); }).ToArray();
        double Area2(int a, int b, int c) => (p[b].X - p[a].X) * (p[c].Y - p[a].Y) - (p[b].Y - p[a].Y) * (p[c].X - p[a].X);
        bool Inside(int q, int a, int b, int c) => Area2(a, b, q) >= -1e-12 && Area2(b, c, q) >= -1e-12 && Area2(c, a, q) >= -1e-12;
        var idx = Enumerable.Range(0, n).ToList();
        for (var guard = 0; idx.Count > 3 && guard < n * n; guard++)
        {
            var cut = false;
            for (var k = 0; k < idx.Count; k++)
            {
                int a = idx[(k + idx.Count - 1) % idx.Count], b = idx[k], c = idx[(k + 1) % idx.Count];
                if (Area2(a, b, c) <= 1e-14) continue;
                if (idx.Any(q => q != a && q != b && q != c && Inside(q, a, b, c))) continue;
                tris.Add((a, b, c)); idx.RemoveAt(k); cut = true; break;
            }
            if (!cut) break;
        }
        for (var k = 1; k + 1 < idx.Count; k++) tris.Add((idx[0], idx[k], idx[k + 1]));
        return tris;
    }

    // Z up (NoorMesh, Blender) ↔ Y up (glTF, OBJ, engines): a quarter turn about X.
    internal static Vector3 ToYUp(Vector3 p) => new(p.X, p.Z, -p.Y);
    internal static Vector3 ToZUp(Vector3 p) => new(p.X, -p.Z, p.Y);
    private static readonly double[] C = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];   // Z up → Y up (column-major)
    private static readonly double[] Ci = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];  // Y up → Z up

    // ------------------------------------------------------------------ GLB

    /// <summary>
    /// The scene as GLB (+Y up): one node per shown object with its location, rotation and scale, its mesh triangulated,
    /// flat faces with their own normal, smooth ones sharing one per vertex, UVs (V turned for glTF), a plain material.
    /// </summary>
    public byte[] ToGlb(string generator = "NoorMD NoorMesh")
    {
        var asset = new Asset3D { Name = "NoorMesh scene" };
        // The scene's materials (glTF's metallic-roughness), and a plain one for faces without.
        var index = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var mt in Materials ?? [])
        {
            index[mt.Id] = asset.Materials.Count;
            // Its picture (PNG; the page sends every picture as PNG for export), multiplied by the colour as glTF does.
            var tex = mt.Texture == null ? null : Textures?.FirstOrDefault(t => t.Id == mt.Texture);
            byte[]? png = null;
            if (tex?.Data != null) { try { var b = Convert.FromBase64String(tex.Data); if (IsPng(b)) png = b; } catch (FormatException) { } }
            asset.Materials.Add(new Material3D { Name = mt.Name, BaseColor = new Vector4(mt.Color[0], mt.Color[1], mt.Color[2], mt.Color[3]), Roughness = mt.Roughness, Metallic = mt.Metallic, Alpha = mt.Color[3] < 0.999f ? "blend" : "opaque", BaseColorPng = png });
        }
        var plain = -1;
        int Plain() { if (plain < 0) { plain = asset.Materials.Count; asset.Materials.Add(new Material3D { Name = "Material", BaseColor = new Vector4(0.8f, 0.8f, 0.8f, 1), Roughness = 0.6f, Metallic = 0 }); } return plain; }
        foreach (var o in Objects.Where(x => !x.Hidden))
        {
            var slots = o.Materials ?? [];
            var mesh = BuildMesh(o.Mesh, yUp: true, slot => slot >= 0 && slot < slots.Count && index.TryGetValue(slots[slot], out var mi) ? mi : Plain());
            if (mesh.TriangleCount == 0) continue;
            var (t, q, s) = M4.DecomposeQ(M4.Mul(C, M4.Mul(Matrix(o), Ci)));
            asset.Root.Children.Add(new Node3D { Name = o.Name, Mesh = mesh, Translation = t, Rotation = q, Scale = s });
        }
        if (asset.Materials.Count == 0) Plain();
        return GlbWriter.Write(asset, generator);
    }

    /// <summary>A mesh made for drawing or export: triangles (one submesh per material), vertices split where normals or UVs differ.</summary>
    internal static Mesh3D BuildMesh(MeshData m, bool yUp, Func<int, int>? materialOf = null)
    {
        var mesh = new Mesh3D();
        var vn = new Vector3[m.VertexCount];
        var fn = m.F.Select(f => FaceNormal(m, f)).ToList();
        for (var i = 0; i < m.F.Count; i++) if (m.F[i].S) foreach (var v in m.F[i].V) vn[v] += fn[i].N * fn[i].Area;
        var index = new Dictionary<(int, Vector3, Vector2), int>();
        for (var i = 0; i < m.F.Count; i++)
        {
            var f = m.F[i];
            var sub = mesh.Sub(materialOf?.Invoke(f.M) ?? 0);
            foreach (var (a, b, c) in Triangulate(m, f))
                foreach (var k in new[] { a, b, c })
                {
                    var v = f.V[k];
                    var n = f.S && vn[v].LengthSquared() > 0 ? Vector3.Normalize(vn[v]) : fn[i].N;
                    var uv = f.Uv != null ? new Vector2(f.Uv[k * 2], 1 - f.Uv[k * 2 + 1]) : Vector2.Zero;
                    var p = m.Vertex(v);
                    if (yUp) { p = ToYUp(p); n = ToYUp(n); }
                    var key = (v, new Vector3(MathF.Round(n.X, 4), MathF.Round(n.Y, 4), MathF.Round(n.Z, 4)), new Vector2(MathF.Round(uv.X, 5), MathF.Round(uv.Y, 5)));
                    if (!index.TryGetValue(key, out var idx)) index[key] = idx = mesh.AddVertex(p, n, uv);
                    sub.Indices.Add(idx);
                }
        }
        return mesh;
    }

    /// <summary>A scene made from a GLB file: one object per node with a mesh (its world placement kept), vertices welded, turned to +Z up.</summary>
    public static MeshDoc FromGlb(byte[] data, string name = "Model")
    {
        var gltf = GltfReader.Read(data);
        var doc = new MeshDoc();
        // The file's materials (and a plain one for primitives without), each object's slots its primitives' materials.
        var mats = gltf.Materials.Select((mt, i) => new MeshMaterial { Id = $"g{i + 1}", Name = mt.Name, Color = [mt.Color.X, mt.Color.Y, mt.Color.Z, mt.Color.W], Roughness = mt.Roughness, Metallic = mt.Metallic, Texture = mt.Image != null ? $"gt{i + 1}" : null }).ToList();
        var texs = gltf.Materials.Select((mt, i) => (mt, i)).Where(x => x.mt.Image != null).Select(x => new MeshTexture { Id = $"gt{x.i + 1}", Name = $"{x.mt.Name} colour", Packed = true, Data = Convert.ToBase64String(x.mt.Image!), Mime = x.mt.Mime }).ToList();
        string MatId(int i) { if (i >= 0 && i < mats.Count) return mats[i].Id; var p = mats.FirstOrDefault(x => x.Id == "g0"); if (p == null) { p = new MeshMaterial { Id = "g0", Name = "Material" }; mats.Add(p); } return p.Id; }
        var n = 0;
        foreach (var node in gltf.Nodes)
        {
            if (node.Mesh is not { } prims || prims.Count == 0) continue;
            var m = new MeshData();
            var verts = new List<float>();
            var slots = new List<string>();
            var slot = 0;
            foreach (var prim in prims)
            {
                // Welded by position within the primitive; each triangle a face, smooth where its normals bend.
                var map = new Dictionary<Vector3, int>();
                var local = new int[prim.Positions.Length];
                for (var i = 0; i < prim.Positions.Length; i++)
                {
                    var p = ToZUp(prim.Positions[i]);
                    if (!map.TryGetValue(p, out var vi)) { vi = verts.Count / 3; map[p] = vi; verts.Add(p.X); verts.Add(p.Y); verts.Add(p.Z); }
                    local[i] = vi;
                }
                m.V = verts.ToArray();
                for (var t = 0; t + 2 < prim.Indices.Length; t += 3)
                {
                    int i0 = prim.Indices[t], i1 = prim.Indices[t + 1], i2 = prim.Indices[t + 2];
                    if (local[i0] == local[i1] || local[i1] == local[i2] || local[i0] == local[i2]) continue;
                    var face = new MeshFace { V = [local[i0], local[i1], local[i2]], M = slots.IndexOf(MatId(prim.Material)) is var si && si >= 0 ? si : slots.Count };
                    if (prim.Uvs != null) face.Uv = [prim.Uvs[i0].X, 1 - prim.Uvs[i0].Y, prim.Uvs[i1].X, 1 - prim.Uvs[i1].Y, prim.Uvs[i2].X, 1 - prim.Uvs[i2].Y];
                    if (prim.Normals != null)
                    {
                        var (fnrm, _) = FaceNormal(m, face);
                        face.S = new[] { i0, i1, i2 }.Any(i => Vector3.Dot(Vector3.Normalize(ToZUp(prim.Normals[i])), fnrm) < 0.9998f);
                    }
                    m.F.Add(face);
                }
                if (!slots.Contains(MatId(prim.Material))) slots.Add(MatId(prim.Material));
                slot++;
            }
            m.V = verts.ToArray();
            var (t3, r3, s3) = M4.DecomposeEuler(M4.Mul(Ci, M4.Mul(node.World, C)));
            doc.Objects.Add(new MeshObject { Id = $"o{++n}", Name = string.IsNullOrWhiteSpace(node.Name) ? $"{name}.{n:000}" : node.Name, Kind = "imported", T = t3, R = r3, S = s3, Mesh = m, Materials = slots.Count > 0 && gltf.Materials.Count > 0 ? slots : null });
        }
        if (doc.Objects.Count == 0) throw new InvalidDataException("That GLB has no meshes NoorMesh can read (triangles).");
        if (gltf.Materials.Count > 0) doc.Materials = mats;
        if (texs.Count > 0) doc.Textures = texs;
        return doc.Checked();
    }

    // ------------------------------------------------------------------ OBJ

    /// <summary>The scene as OBJ (+Y up, n-gons kept): each shown object as an "o" in the world (OBJ has no placements), its UVs and smoothing.</summary>
    public string ToObj(string generator = "NoorMD NoorMesh")
    {
        var sb = new StringBuilder();
        var ci = System.Globalization.CultureInfo.InvariantCulture;
        sb.Append("# ").Append(generator).Append(" — OBJ, +Y up, metres\n");
        int vBase = 1, tBase = 1;
        foreach (var o in Objects.Where(x => !x.Hidden))
        {
            var m = o.Mesh; var M = Matrix(o);
            sb.Append("o ").Append(o.Name.Replace('\n', ' ')).Append('\n');
            for (var i = 0; i < m.VertexCount; i++) { var p = ToYUp(M4.Point(M, m.Vertex(i))); sb.AppendFormat(ci, "v {0:0.######} {1:0.######} {2:0.######}\n", p.X, p.Y, p.Z); }
            var uvCount = 0;
            foreach (var f in m.F) if (f.Uv != null) for (var k = 0; k < f.V.Length; k++) { sb.AppendFormat(ci, "vt {0:0.######} {1:0.######}\n", f.Uv[k * 2], f.Uv[k * 2 + 1]); uvCount++; }
            var smooth = (bool?)null; var t = tBase;
            // A mirroring placement turns the faces inside out: their order is turned back.
            var flip = M4.Det3(M) < 0;
            foreach (var f in m.F)
            {
                if (smooth != f.S) { sb.Append(f.S ? "s 1\n" : "s off\n"); smooth = f.S; }
                sb.Append('f');
                var corners = Enumerable.Range(0, f.V.Length).ToList();
                if (flip) corners.Reverse();
                foreach (var k in corners) { sb.Append(' ').Append(f.V[k] + vBase); if (f.Uv != null) sb.Append('/').Append(t + k); }
                if (f.Uv != null) t += f.V.Length;
                sb.Append('\n');
            }
            vBase += m.VertexCount; tBase += uvCount;
        }
        return sb.ToString();
    }

    /// <summary>A scene made from an OBJ file (n-gons kept): an object per "o" (or "g"), +Y up turned to +Z up.</summary>
    public static MeshDoc FromObj(string text, string name = "Model")
    {
        var ci = System.Globalization.CultureInfo.InvariantCulture;
        var pos = new List<Vector3>(); var uvs = new List<Vector2>();
        var doc = new MeshDoc();
        string objName = name; var faces = new List<(int[] V, int[]? T, bool S, int M)>();
        var smooth = false; var mats = new Dictionary<string, int>(); var mat = 0;
        void Flush()
        {
            if (faces.Count == 0) return;
            var used = new Dictionary<int, int>(); var m = new MeshData(); var v = new List<float>();
            foreach (var (fv, ft, s, mm) in faces)
            {
                var face = new MeshFace { V = fv.Select(i => { if (!used.TryGetValue(i, out var j)) { j = used.Count; used[i] = j; var p = ToZUp(pos[i]); v.Add(p.X); v.Add(p.Y); v.Add(p.Z); } return j; }).ToArray(), S = s, M = mm };
                if (ft != null && ft.All(i => i >= 0 && i < uvs.Count)) face.Uv = ft.SelectMany(i => new[] { uvs[i].X, uvs[i].Y }).ToArray();
                if (face.V.Distinct().Count() >= 3) m.F.Add(face);
            }
            m.V = v.ToArray();
            doc.Objects.Add(new MeshObject { Id = $"o{doc.Objects.Count + 1}", Name = objName, Kind = "imported", Mesh = m });
            faces = [];
        }
        int Ref(string s, int count) { var i = int.Parse(s, ci); return i < 0 ? count + i : i - 1; }
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line[0] == '#') continue;
            var parts = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
            try
            {
                switch (parts[0])
                {
                    case "v" when parts.Length >= 4: pos.Add(new Vector3(float.Parse(parts[1], ci), float.Parse(parts[2], ci), float.Parse(parts[3], ci))); break;
                    case "vt" when parts.Length >= 3: uvs.Add(new Vector2(float.Parse(parts[1], ci), float.Parse(parts[2], ci))); break;
                    case "o" or "g": Flush(); objName = parts.Length > 1 ? string.Join(' ', parts.Skip(1)) : name; break;
                    case "s": smooth = parts.Length > 1 && parts[1] is not ("off" or "0"); break;
                    case "usemtl": var key = parts.Length > 1 ? parts[1] : ""; if (!mats.TryGetValue(key, out mat)) { mat = mats.Count; mats[key] = mat; } break;
                    case "f" when parts.Length >= 4:
                    {
                        var fv = new int[parts.Length - 1]; int[]? ft = new int[parts.Length - 1];
                        for (var k = 1; k < parts.Length; k++)
                        {
                            var bits = parts[k].Split('/');
                            fv[k - 1] = Ref(bits[0], pos.Count);
                            if (ft != null && bits.Length > 1 && bits[1].Length > 0) ft[k - 1] = Ref(bits[1], uvs.Count); else ft = null;
                        }
                        if (fv.Any(i => i < 0 || i >= pos.Count)) throw new InvalidDataException("A face of that OBJ points at a missing vertex.");
                        faces.Add((fv, ft, smooth, mat));
                        break;
                    }
                }
            }
            catch (FormatException) { throw new InvalidDataException($"That OBJ has a line NoorMesh can't read: \"{line[..Math.Min(60, line.Length)]}\"."); }
            catch (OverflowException) { throw new InvalidDataException("That OBJ has a number too big to read."); }
        }
        Flush();
        if (doc.Objects.Count == 0) throw new InvalidDataException("That OBJ has no faces.");
        return doc.Checked();
    }
}

/// <summary>4×4 matrices, column-major (as the page's), for objects' placements.</summary>
internal static class M4
{
    public static double[] Mul(double[] a, double[] b)
    {
        var o = new double[16];
        for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { double s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
        return o;
    }
    public static double[] Compose(float[] t, float[] rDeg, float[] s)
    {
        double d = Math.PI / 180, cx = Math.Cos(rDeg[0] * d), sx = Math.Sin(rDeg[0] * d), cy = Math.Cos(rDeg[1] * d), sy = Math.Sin(rDeg[1] * d), cz = Math.Cos(rDeg[2] * d), sz = Math.Sin(rDeg[2] * d);
        double[] X = [1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1], Y = [cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1], Z = [cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        var m = Mul(Z, Mul(Y, X));
        for (var c = 0; c < 3; c++) for (var k = 0; k < 3; k++) m[c * 4 + k] *= s[c];
        m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
        return m;
    }
    public static Vector3 Point(double[] m, Vector3 p) => new((float)(m[0] * p.X + m[4] * p.Y + m[8] * p.Z + m[12]), (float)(m[1] * p.X + m[5] * p.Y + m[9] * p.Z + m[13]), (float)(m[2] * p.X + m[6] * p.Y + m[10] * p.Z + m[14]));
    public static double Det3(double[] m) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
    /// <summary>Location, rotation matrix (3×3 row-major R[r,c]) and scale (a mirror: negative X scale).</summary>
    private static (double[] T, double[,] R, double[] S) Split(double[] m)
    {
        double Len(int c) => Math.Sqrt(m[c * 4] * m[c * 4] + m[c * 4 + 1] * m[c * 4 + 1] + m[c * 4 + 2] * m[c * 4 + 2]);
        double sx = Len(0), sy = Len(1), sz = Len(2);
        if (Det3(m) < 0) sx = -sx;
        double[] s = [sx, sy, sz];
        var R = new double[3, 3];
        for (var c = 0; c < 3; c++) for (var r = 0; r < 3; r++) R[r, c] = s[c] != 0 ? m[c * 4 + r] / s[c] : (r == c ? 1 : 0);
        return ([m[12], m[13], m[14]], R, s);
    }
    public static (float[] T, float[] R, float[] S) DecomposeEuler(double[] m)
    {
        var (t, R, s) = Split(m);
        double r20 = Math.Clamp(R[2, 0], -1, 1), ry = Math.Asin(-r20), rx, rz;
        if (Math.Abs(r20) < 0.999999) { rx = Math.Atan2(R[2, 1], R[2, 2]); rz = Math.Atan2(R[1, 0], R[0, 0]); }
        else { rz = 0; rx = Math.Atan2(-R[1, 2], R[1, 1]); }
        float F(double x) => Math.Abs(x) < 1e-9 ? 0 : (float)(Math.Round(x * 1e6) / 1e6);
        var d = 180 / Math.PI;
        return (t.Select(F).ToArray(), new[] { F(rx * d), F(ry * d), F(rz * d) }, s.Select(F).ToArray());
    }
    public static (Vector3 T, Quaternion Q, Vector3 S) DecomposeQ(double[] m)
    {
        var (t, R, s) = Split(m);
        // Shepperd's method: the rotation matrix as a unit quaternion.
        double tr = R[0, 0] + R[1, 1] + R[2, 2], qw, qx, qy, qz;
        if (tr > 0) { var k = Math.Sqrt(tr + 1) * 2; qw = 0.25 * k; qx = (R[2, 1] - R[1, 2]) / k; qy = (R[0, 2] - R[2, 0]) / k; qz = (R[1, 0] - R[0, 1]) / k; }
        else if (R[0, 0] > R[1, 1] && R[0, 0] > R[2, 2]) { var k = Math.Sqrt(1 + R[0, 0] - R[1, 1] - R[2, 2]) * 2; qw = (R[2, 1] - R[1, 2]) / k; qx = 0.25 * k; qy = (R[0, 1] + R[1, 0]) / k; qz = (R[0, 2] + R[2, 0]) / k; }
        else if (R[1, 1] > R[2, 2]) { var k = Math.Sqrt(1 + R[1, 1] - R[0, 0] - R[2, 2]) * 2; qw = (R[0, 2] - R[2, 0]) / k; qx = (R[0, 1] + R[1, 0]) / k; qy = 0.25 * k; qz = (R[1, 2] + R[2, 1]) / k; }
        else { var k = Math.Sqrt(1 + R[2, 2] - R[0, 0] - R[1, 1]) * 2; qw = (R[1, 0] - R[0, 1]) / k; qx = (R[0, 2] + R[2, 0]) / k; qy = (R[1, 2] + R[2, 1]) / k; qz = 0.25 * k; }
        var q = Quaternion.Normalize(new Quaternion((float)qx, (float)qy, (float)qz, (float)qw));
        static float Clean(double x) => Math.Abs(x) < 1e-7 ? 0 : (float)x;
        return (new Vector3(Clean(t[0]), Clean(t[1]), Clean(t[2])), q, new Vector3((float)s[0], (float)s[1], (float)s[2]));
    }
    public static double[] FromTrs(Vector3 t, Quaternion q, Vector3 s)
    {
        float x = q.X, y = q.Y, z = q.Z, w = q.W;
        double[] m =
        [
            (1 - 2 * (y * y + z * z)) * s.X, 2 * (x * y + z * w) * s.X, 2 * (x * z - y * w) * s.X, 0,
            2 * (x * y - z * w) * s.Y, (1 - 2 * (x * x + z * z)) * s.Y, 2 * (y * z + x * w) * s.Y, 0,
            2 * (x * z + y * w) * s.Z, 2 * (y * z - x * w) * s.Z, (1 - 2 * (x * x + y * y)) * s.Z, 0,
            t.X, t.Y, t.Z, 1,
        ];
        return m;
    }
}

/// <summary>Just enough of a GLB reader for NoorMesh: nodes with their world matrices and their meshes' triangles (positions, normals, UV0).</summary>
internal static class GltfReader
{
    public sealed record Prim(Vector3[] Positions, Vector3[]? Normals, Vector2[]? Uvs, int[] Indices, int Material = -1);
    public sealed record Node(string Name, double[] World, List<Prim>? Mesh);
    public sealed record Mat(string Name, Vector4 Color, float Roughness, float Metallic, byte[]? Image = null, string? Mime = null);
    public sealed record Gltf(List<Node> Nodes, List<Mat> Materials);

    public static Gltf Read(byte[] data)
    {
        if (data.Length < 20 || BitConverter.ToUInt32(data, 0) != 0x46546C67) throw new InvalidDataException("That isn't a GLB file.");
        var jsonLen = BitConverter.ToInt32(data, 12);
        if (jsonLen <= 0 || 20 + jsonLen > data.Length || BitConverter.ToUInt32(data, 16) != 0x4E4F534A) throw new InvalidDataException("That GLB is broken (no JSON chunk).");
        using var json = JsonDocument.Parse(data.AsMemory(20, jsonLen));
        var root = json.RootElement;
        var binStart = 20 + jsonLen + 8;
        var binLen = binStart <= data.Length ? BitConverter.ToInt32(data, 20 + jsonLen) : 0;
        if (binStart + binLen > data.Length) throw new InvalidDataException("That GLB is broken (its data is cut short).");
        JsonElement Arr(string k) => root.TryGetProperty(k, out var v) ? v : default;

        (int Offset, int Count, int Comps, int Type, int Stride) Accessor(int i)
        {
            var a = Arr("accessors")[i];
            var comps = a.GetProperty("type").GetString() switch { "SCALAR" => 1, "VEC2" => 2, "VEC3" => 3, "VEC4" => 4, _ => throw new InvalidDataException("That GLB uses an accessor NoorMesh can't read.") };
            var type = a.GetProperty("componentType").GetInt32();
            if (!a.TryGetProperty("bufferView", out var bvi)) throw new InvalidDataException("That GLB has a sparse or empty accessor NoorMesh can't read.");
            var bv = Arr("bufferViews")[bvi.GetInt32()];
            if (bv.TryGetProperty("buffer", out var buf) && buf.GetInt32() != 0) throw new InvalidDataException("That GLB keeps data in another file.");
            var size = type switch { 5126 or 5125 => 4, 5123 or 5122 => 2, _ => 1 };
            var stride = bv.TryGetProperty("byteStride", out var st) ? st.GetInt32() : size * comps;
            var off = binStart + (bv.TryGetProperty("byteOffset", out var bo) ? bo.GetInt32() : 0) + (a.TryGetProperty("byteOffset", out var ao) ? ao.GetInt32() : 0);
            var count = a.GetProperty("count").GetInt32();
            if (count < 0 || count > 50_000_000 || off < binStart || off + (long)stride * Math.Max(0, count - 1) + size * comps > binStart + binLen) throw new InvalidDataException("That GLB has an accessor outside its data.");
            return (off, count, comps, type, stride);
        }
        float[] Floats(int i, int want)
        {
            var (off, count, comps, type, stride) = Accessor(i);
            if (comps != want) throw new InvalidDataException("That GLB has an attribute of the wrong shape.");
            var o = new float[count * comps];
            for (var k = 0; k < count; k++)
                for (var c = 0; c < comps; c++)
                {
                    var at = off + k * stride;
                    o[k * comps + c] = type switch
                    {
                        5126 => BitConverter.ToSingle(data, at + c * 4),
                        5123 => BitConverter.ToUInt16(data, at + c * 2) / 65535f, // normalized (UVs)
                        5121 => data[at + c] / 255f,
                        _ => throw new InvalidDataException("That GLB has an attribute type NoorMesh can't read."),
                    };
                }
            return o;
        }
        int[] Ints(int i)
        {
            var (off, count, _, type, stride) = Accessor(i);
            var o = new int[count];
            for (var k = 0; k < count; k++)
                o[k] = type switch { 5125 => (int)BitConverter.ToUInt32(data, off + k * stride), 5123 => BitConverter.ToUInt16(data, off + k * stride), 5121 => data[off + k * stride], _ => throw new InvalidDataException("That GLB has indices NoorMesh can't read.") };
            return o;
        }
        List<Prim>? MeshOf(int mi)
        {
            var prims = new List<Prim>();
            foreach (var p in Arr("meshes")[mi].GetProperty("primitives").EnumerateArray())
            {
                if (p.TryGetProperty("mode", out var mode) && mode.GetInt32() != 4) continue; // triangles only
                var at = p.GetProperty("attributes");
                if (!at.TryGetProperty("POSITION", out var pa)) continue;
                var pf = Floats(pa.GetInt32(), 3);
                var pos = Enumerable.Range(0, pf.Length / 3).Select(k => new Vector3(pf[k * 3], pf[k * 3 + 1], pf[k * 3 + 2])).ToArray();
                if (pos.Any(v => !float.IsFinite(v.X) || !float.IsFinite(v.Y) || !float.IsFinite(v.Z))) throw new InvalidDataException("That GLB has a vertex that isn't a number.");
                Vector3[]? nrm = null; Vector2[]? uv = null;
                if (at.TryGetProperty("NORMAL", out var na)) { var f = Floats(na.GetInt32(), 3); if (f.Length == pf.Length) nrm = Enumerable.Range(0, f.Length / 3).Select(k => new Vector3(f[k * 3], f[k * 3 + 1], f[k * 3 + 2])).ToArray(); }
                if (at.TryGetProperty("TEXCOORD_0", out var ta)) { var f = Floats(ta.GetInt32(), 2); if (f.Length / 2 == pos.Length) uv = Enumerable.Range(0, f.Length / 2).Select(k => new Vector2(f[k * 2], f[k * 2 + 1])).ToArray(); }
                var idx = p.TryGetProperty("indices", out var ia) ? Ints(ia.GetInt32()) : Enumerable.Range(0, pos.Length).ToArray();
                if (idx.Any(x => x < 0 || x >= pos.Length)) throw new InvalidDataException("That GLB has an index outside its vertices.");
                var matIndex = p.TryGetProperty("material", out var pm) && pm.ValueKind == JsonValueKind.Number ? pm.GetInt32() : -1;
                prims.Add(new Prim(pos, nrm, uv, idx, matIndex));
            }
            return prims;
        }
        var nodes = new List<Node>();
        var visited = new HashSet<int>();
        void Walk(int i, double[] parent, int depth)
        {
            if (depth > 64 || !visited.Add(i)) return;
            var n = Arr("nodes")[i];
            double[] local;
            if (n.TryGetProperty("matrix", out var mx) && mx.GetArrayLength() == 16) local = mx.EnumerateArray().Select(x => x.GetDouble()).ToArray();
            else
            {
                Vector3 V3(string k, float d) => n.TryGetProperty(k, out var v) && v.GetArrayLength() == 3 ? new Vector3(v[0].GetSingle(), v[1].GetSingle(), v[2].GetSingle()) : new Vector3(d);
                var q = n.TryGetProperty("rotation", out var r) && r.GetArrayLength() == 4 ? new Quaternion(r[0].GetSingle(), r[1].GetSingle(), r[2].GetSingle(), r[3].GetSingle()) : Quaternion.Identity;
                local = M4.FromTrs(V3("translation", 0), Quaternion.Normalize(q), V3("scale", 1));
            }
            var world = M4.Mul(parent, local);
            var name = n.TryGetProperty("name", out var nm) ? nm.GetString() ?? "" : "";
            nodes.Add(new Node(name, world, n.TryGetProperty("mesh", out var mi) ? MeshOf(mi.GetInt32()) : null));
            if (n.TryGetProperty("children", out var ch)) foreach (var c in ch.EnumerateArray()) Walk(c.GetInt32(), world, depth + 1);
        }
        double[] I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        if (root.TryGetProperty("scenes", out var scenes) && scenes.GetArrayLength() > 0)
        {
            var si = root.TryGetProperty("scene", out var s0) ? s0.GetInt32() : 0;
            if (scenes[si].TryGetProperty("nodes", out var sn)) foreach (var x in sn.EnumerateArray()) Walk(x.GetInt32(), I, 0);
        }
        else if (root.TryGetProperty("nodes", out var all)) for (var i = 0; i < all.GetArrayLength(); i++) Walk(i, I, 0);
        var mats = new List<Mat>();
        if (root.TryGetProperty("materials", out var ms) && ms.ValueKind == JsonValueKind.Array)
            foreach (var mt in ms.EnumerateArray().Take(1000))
            {
                var c = Vector4.One; float r = 1, mtl = 1;
                if (mt.TryGetProperty("pbrMetallicRoughness", out var pbr))
                {
                    if (pbr.TryGetProperty("baseColorFactor", out var bc) && bc.GetArrayLength() == 4) c = new Vector4(bc[0].GetSingle(), bc[1].GetSingle(), bc[2].GetSingle(), bc[3].GetSingle());
                    if (pbr.TryGetProperty("roughnessFactor", out var rf)) r = rf.GetSingle();
                    if (pbr.TryGetProperty("metallicFactor", out var mf)) mtl = mf.GetSingle();
                }
                // Its base colour picture, when it is kept inside the GLB (a buffer view, not another file).
                byte[]? img = null; string? mime = null;
                if (mt.TryGetProperty("pbrMetallicRoughness", out var pbr2) && pbr2.TryGetProperty("baseColorTexture", out var bct) && bct.TryGetProperty("index", out var ti)
                    && root.TryGetProperty("textures", out var texs) && ti.GetInt32() >= 0 && ti.GetInt32() < texs.GetArrayLength() && texs[ti.GetInt32()].TryGetProperty("source", out var src)
                    && root.TryGetProperty("images", out var imgs) && src.GetInt32() >= 0 && src.GetInt32() < imgs.GetArrayLength() && imgs[src.GetInt32()].TryGetProperty("bufferView", out var ibv))
                {
                    var bv = Arr("bufferViews")[ibv.GetInt32()];
                    var off = binStart + (bv.TryGetProperty("byteOffset", out var bo2) ? bo2.GetInt32() : 0);
                    var ln = bv.GetProperty("byteLength").GetInt32();
                    if (ln > 0 && ln <= MeshDoc.MaxTextureBytes && off >= binStart && off + (long)ln <= binStart + binLen) { img = data.AsSpan(off, ln).ToArray(); mime = imgs[src.GetInt32()].TryGetProperty("mimeType", out var mm) ? mm.GetString() : "image/png"; }
                }
                mats.Add(new Mat(mt.TryGetProperty("name", out var mn) ? mn.GetString() ?? "Material" : "Material", c, r, mtl, img, mime));
            }
        return new Gltf(nodes, mats);
    }
}
