using System.Numerics;

namespace NoorMD.Media.Assets3D;

// The Asset Bench's neutral mesh model: what every generator (trees, rocks) produces and what the preview, the
// simplifier, the baker and the exporters read. Y is up, units are metres, the asset's pivot is at its base (0, 0, 0).

/// <summary>A material by name, with its colour and how it is drawn (textures are attached by the exporter).</summary>
public sealed class Material3D
{
    public string Name { get; set; } = "Material";
    public Vector4 BaseColor { get; set; } = Vector4.One;
    public float Roughness { get; set; } = 0.9f;
    public float Metallic { get; set; }
    /// <summary>"opaque", "mask" (alpha cutout, foliage cards) or "blend".</summary>
    public string Alpha { get; set; } = "opaque";
    public float AlphaCutoff { get; set; } = 0.5f;
    public bool DoubleSided { get; set; }
    /// <summary>Light the surface gives off itself (linear RGB, 0–1 each): glowing crystals, mushrooms.</summary>
    public Vector3 Emissive { get; set; }
    /// <summary>PNG bytes for the colour (with alpha for cards) and the normal map, or null.</summary>
    public byte[]? BaseColorPng { get; set; }
    public byte[]? NormalPng { get; set; }
    public byte[]? OcclusionRoughnessMetallicPng { get; set; }
    /// <summary>The normal and ORM maps' pixels (not exported): what a smaller copy is made from.</summary>
    public RawImage? NormalPixels { get; set; }
    public RawImage? OrmPixels { get; set; }
    /// <summary>Light let through from behind (0–1; leaves): glTF KHR_materials_diffuse_transmission.</summary>
    public float Transmission { get; set; }
    /// <summary>Textures sampled nearest, not blurred between pixels (pixel art).</summary>
    public bool Nearest { get; set; }
    /// <summary>The colour texture's pixels (not exported): what the billboard renderer samples.</summary>
    public RawImage? BaseColorPixels { get; set; }
}

/// <summary>An RGBA picture in memory (8 bits a channel, rows from the top).</summary>
public sealed record RawImage(int Width, int Height, byte[] Rgba)
{
    public byte[] Png() => PngWriter.Rgba(Width, Height, Rgba);

    public static RawImage FromRgb(int w, int h, byte[] rgb)
    {
        var px = new byte[w * h * 4];
        for (var i = 0; i < w * h; i++) { px[i * 4] = rgb[i * 3]; px[i * 4 + 1] = rgb[i * 3 + 1]; px[i * 4 + 2] = rgb[i * 3 + 2]; px[i * 4 + 3] = 255; }
        return new RawImage(w, h, px);
    }
}

/// <summary>Triangles of one material inside a mesh.</summary>
public sealed class Submesh
{
    public int Material { get; set; }
    public List<int> Indices { get; } = [];
}

/// <summary>A triangle mesh with per-vertex attributes (all lists the same length as Positions, or empty).</summary>
public sealed class Mesh3D
{
    public string Name { get; set; } = "Mesh";
    public List<Vector3> Positions { get; } = [];
    public List<Vector3> Normals { get; } = [];
    public List<Vector2> UV0 { get; } = [];
    /// <summary>Extra UV sets (TEXCOORD_1 and _2), used for wind data so it doesn't tint the model like vertex colours would.</summary>
    public List<Vector2> UV1 { get; } = [];
    public List<Vector2> UV2 { get; } = [];
    /// <summary>Vertex colours: in trees the wind data (R trunk sway, G branch bend, B leaf flutter, A phase), in stylized assets a painted gradient.</summary>
    public List<Vector4> Colors { get; } = [];
    /// <summary>Tangents for normal maps (xyz along +U, w the handedness ±1); made by ComputeTangents when needed.</summary>
    public List<Vector4> Tangents { get; } = [];
    public List<Submesh> Submeshes { get; } = [];

    public int VertexCount => Positions.Count;
    public int TriangleCount => Submeshes.Sum(s => s.Indices.Count) / 3;

    public int AddVertex(Vector3 p, Vector3 n, Vector2 uv, Vector4? color = null)
    {
        Positions.Add(p); Normals.Add(n); UV0.Add(uv);
        if (color != null || Colors.Count > 0)
        {
            while (Colors.Count < Positions.Count - 1) Colors.Add(Vector4.One);
            Colors.Add(color ?? Vector4.One);
        }
        return Positions.Count - 1;
    }

    public Submesh Sub(int material)
    {
        var s = Submeshes.FirstOrDefault(x => x.Material == material);
        if (s == null) { s = new Submesh { Material = material }; Submeshes.Add(s); }
        return s;
    }

    public (Vector3 Min, Vector3 Max) Bounds()
    {
        if (Positions.Count == 0) return (Vector3.Zero, Vector3.Zero);
        Vector3 lo = new(float.MaxValue), hi = new(float.MinValue);
        foreach (var p in Positions) { lo = Vector3.Min(lo, p); hi = Vector3.Max(hi, p); }
        return (lo, hi);
    }

    /// <summary>Smooth normals from the triangles (area-weighted), for vertices whose normals are missing or after editing.</summary>
    public void ComputeNormals()
    {
        var acc = new Vector3[Positions.Count];
        foreach (var s in Submeshes)
            for (var i = 0; i + 2 < s.Indices.Count; i += 3)
            {
                int a = s.Indices[i], b = s.Indices[i + 1], c = s.Indices[i + 2];
                var n = Vector3.Cross(Positions[b] - Positions[a], Positions[c] - Positions[a]);
                acc[a] += n; acc[b] += n; acc[c] += n;
            }
        Normals.Clear();
        foreach (var n in acc) Normals.Add(n.LengthSquared() > 1e-20f ? Vector3.Normalize(n) : Vector3.UnitY);
    }

    /// <summary>Per-vertex tangents from the UVs (Lengyel's method), orthogonal to the normals, with handedness in w.</summary>
    public void ComputeTangents()
    {
        var tan = new Vector3[VertexCount];
        var bit = new Vector3[VertexCount];
        foreach (var s in Submeshes)
            for (var i = 0; i + 2 < s.Indices.Count; i += 3)
            {
                int a = s.Indices[i], b = s.Indices[i + 1], c = s.Indices[i + 2];
                Vector3 e1 = Positions[b] - Positions[a], e2 = Positions[c] - Positions[a];
                Vector2 d1 = UV0[b] - UV0[a], d2 = UV0[c] - UV0[a];
                var det = d1.X * d2.Y - d2.X * d1.Y;
                if (MathF.Abs(det) < 1e-12f) continue;
                var r = 1 / det;
                var t = (e1 * d2.Y - e2 * d1.Y) * r;
                var bt = (e2 * d1.X - e1 * d2.X) * r;
                tan[a] += t; tan[b] += t; tan[c] += t;
                bit[a] += bt; bit[b] += bt; bit[c] += bt;
            }
        Tangents.Clear();
        for (var v = 0; v < VertexCount; v++)
        {
            var n = Normals[v];
            var t = tan[v] - n * Vector3.Dot(n, tan[v]);
            if (t.LengthSquared() < 1e-20f || !float.IsFinite(t.X))
            {
                // No usable UV direction here: any direction across the normal.
                t = Vector3.Cross(n, MathF.Abs(n.Y) < 0.9f ? Vector3.UnitY : Vector3.UnitX);
            }
            t = Vector3.Normalize(t);
            var w = Vector3.Dot(Vector3.Cross(n, t), bit[v]) < 0 ? -1f : 1f;
            Tangents.Add(new Vector4(t, w));
        }
    }

    /// <summary>Checks that would make an exporter or an engine choke: indices in range, finite values, unit normals, UVs present.</summary>
    public List<string> Problems()
    {
        var p = new List<string>();
        if (Normals.Count != Positions.Count) p.Add("normals missing");
        if (UV0.Count != Positions.Count) p.Add("UVs missing");
        if (Colors.Count != 0 && Colors.Count != Positions.Count) p.Add("colours for some vertices only");
        if ((UV1.Count != 0 && UV1.Count != Positions.Count) || (UV2.Count != 0 && UV2.Count != Positions.Count)) p.Add("extra UVs for some vertices only");
        if (Positions.Any(v => !float.IsFinite(v.X) || !float.IsFinite(v.Y) || !float.IsFinite(v.Z))) p.Add("a position is not a number");
        if (Normals.Any(n => !float.IsFinite(n.X) || MathF.Abs(n.Length() - 1) > 0.01f)) p.Add("a normal is not unit length");
        if (UV0.Any(u => !float.IsFinite(u.X) || !float.IsFinite(u.Y))) p.Add("a UV is not a number");
        if (Tangents.Count != 0 && (Tangents.Count != Positions.Count || Tangents.Any(t => MathF.Abs(new Vector3(t.X, t.Y, t.Z).Length() - 1) > 0.01f || MathF.Abs(MathF.Abs(t.W) - 1) > 1e-6f))) p.Add("a tangent is not unit length with a handedness of ±1");
        foreach (var s in Submeshes)
        {
            if (s.Indices.Count % 3 != 0) p.Add("a submesh's index count is not a multiple of 3");
            if (s.Indices.Any(i => i < 0 || i >= Positions.Count)) p.Add("an index is out of range");
            for (var i = 0; i + 2 < s.Indices.Count; i += 3)
                if (s.Indices[i] == s.Indices[i + 1] || s.Indices[i + 1] == s.Indices[i + 2] || s.Indices[i] == s.Indices[i + 2]) { p.Add("a triangle uses a vertex twice"); break; }
        }
        return p.Distinct().ToList();
    }
}

/// <summary>A node of the asset: a mesh (or none) placed at a pivot, with children (e.g. a tree with its separate branches).</summary>
public sealed class Node3D
{
    public string Name { get; set; } = "Node";
    public Vector3 Translation { get; set; }
    public Quaternion Rotation { get; set; } = Quaternion.Identity;
    public Mesh3D? Mesh { get; set; }
    public List<Node3D> Children { get; } = [];
    /// <summary>Written as the glTF node's "extras" (Godot keeps them as the node's "extras" metadata).</summary>
    public Dictionary<string, object>? Extras { get; set; }

    public IEnumerable<Node3D> All() => new[] { this }.Concat(Children.SelectMany(c => c.All()));
}

/// <summary>An asset: its nodes and the materials they use.</summary>
public sealed class Asset3D
{
    public string Name { get; set; } = "Asset";
    public Node3D Root { get; set; } = new();
    public List<Material3D> Materials { get; } = [];

    public int TriangleCount => Root.All().Sum(n => n.Mesh?.TriangleCount ?? 0);
}
