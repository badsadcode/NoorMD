using System.Numerics;
using System.Text;
using NoorMD.Media.Assets3D;

namespace NoorMD.Media.Forge;

/// <summary>
/// What an export writes: each texture set's maps (the usual names, for any engine), a Godot material using them, and
/// the textured model as a GLB with each texture set's maps on its material, the UVs they were painted through.
/// </summary>
public static class ForgeExport
{
    public static readonly (string Map, string Suffix)[] Maps =
        [("basecolor", "BaseColor"), ("normal", "Normal"), ("orm", "ORM"), ("roughness", "Roughness"), ("metallic", "Metallic"), ("ao", "AO"), ("height", "Height")];

    /// <summary>How many cells a side an atlas of so many texture sets has.</summary>
    public static int AtlasGrid(int sets) => Math.Max(1, (int)Math.Ceiling(Math.Sqrt(sets)));

    /// <summary>Texture set <paramref name="set"/>'s cell: column and row, from the top left.</summary>
    public static (int Column, int Row) AtlasCell(int set, int grid) => (set % grid, set / grid);

    /// <summary>A UV of a texture set (v up) moved into its cell of the atlas.</summary>
    public static Vector2 AtlasUv(Vector2 uv, int set, int grid)
    {
        var (cx, cy) = AtlasCell(set, grid);
        return new Vector2((cx + uv.X) / grid, 1 - (cy + 1 - uv.Y) / grid);
    }

    /// <summary>Texture sets (each composed at the cell's size) laid into one atlas; cells left over are flat.</summary>
    public static ForgeTextures Atlas(IReadOnlyList<ForgeTextures> cells)
    {
        var grid = AtlasGrid(cells.Count);
        var cell = cells[0].Size;
        var size = cell * grid;
        var n = size * size;
        var color = new byte[n * 3]; var normal = new byte[n * 3]; var rough = new byte[n]; var metal = new byte[n]; var ao = new byte[n]; var height = new byte[n];
        for (var i = 0; i < n; i++) { normal[i * 3] = 128; normal[i * 3 + 1] = 128; normal[i * 3 + 2] = 255; ao[i] = 255; height[i] = 128; rough[i] = 204; }
        for (var s = 0; s < cells.Count; s++)
        {
            var t = cells[s];
            if (t.Size != cell) throw new ArgumentException("Every cell of an atlas has the same size.");
            var (cx, cy) = AtlasCell(s, grid);
            for (var y = 0; y < cell; y++)
            {
                var src = y * cell; var dst = (cy * cell + y) * size + cx * cell;
                Array.Copy(t.BaseColor, src * 3, color, dst * 3, cell * 3);
                Array.Copy(t.Normal, src * 3, normal, dst * 3, cell * 3);
                Array.Copy(t.Roughness, src, rough, dst, cell);
                Array.Copy(t.Metallic, src, metal, dst, cell);
                Array.Copy(t.Ao, src, ao, dst, cell);
                Array.Copy(t.Height, src, height, dst, cell);
            }
        }
        return new ForgeTextures { Size = size, BaseColor = color, Normal = normal, Roughness = rough, Metallic = metal, Ao = ao, Height = height };
    }

    /// <summary>What an export writes, by the engine it is for (names and packing as each one expects).</summary>
    public static readonly (string Id, string Name, string Description)[] Presets =
    [
        ("godot", "Godot 4", "BaseColor, Normal (OpenGL), ORM, Roughness, Metallic, AO, Height, and a Godot material (.tres) using them"),
        ("unity-urp", "Unity (URP / Built-in)", "BaseMap, Normal (OpenGL), MetallicSmoothness (metal in red, smoothness in alpha), Occlusion, Height"),
        ("unity-hdrp", "Unity (HDRP)", "BaseMap, Normal (OpenGL), MaskMap (metal, occlusion, detail mask, smoothness), Height"),
        ("unreal", "Unreal Engine", "BaseColor, Normal (DirectX: green flipped), ORM (occlusion, roughness, metal), Height"),
        ("all", "Every map", "Everything above, for any engine"),
    ];

    /// <summary>One texture set's files for an engine (Godot's by default: the maps and a material beside them).</summary>
    public static IEnumerable<(string File, byte[] Data)> SetFiles(string setName, ForgeTextures tex, string preset = "godot")
    {
        var n = tex.Size * tex.Size;
        byte[] Rgba(Func<int, (byte R, byte G, byte B, byte A)> px)
        {
            var b = new byte[n * 4];
            for (var i = 0; i < n; i++) { var (r, g, bl, a) = px(i); b[i * 4] = r; b[i * 4 + 1] = g; b[i * 4 + 2] = bl; b[i * 4 + 3] = a; }
            return PngWriter.Rgba(tex.Size, tex.Size, b);
        }
        byte[] DirectXNormal()
        {
            var b = (byte[])tex.Normal.Clone();
            for (var i = 0; i < n; i++) b[i * 3 + 1] = (byte)(255 - b[i * 3 + 1]);
            return PngWriter.Rgb(tex.Size, tex.Size, b);
        }
        var all = preset == "all";
        if (preset == "godot" || all)
        {
            foreach (var (map, suffix) in Maps) yield return ($"{setName}_{suffix}.png", tex.Png(map));
            yield return ($"{setName}.tres", Encoding.UTF8.GetBytes(GodotMaterial(setName, setName)));
        }
        if (preset is "unity-urp" or "unity-hdrp" || all)
        {
            yield return ($"{setName}_BaseMap.png", tex.Png("basecolor"));
            if (!all) yield return ($"{setName}_Normal.png", tex.Png("normal"));
            if (preset == "unity-urp" || all)
            {
                yield return ($"{setName}_MetallicSmoothness.png", Rgba(i => (tex.Metallic[i], tex.Metallic[i], tex.Metallic[i], (byte)(255 - tex.Roughness[i]))));
                yield return ($"{setName}_Occlusion.png", tex.Png("ao"));
            }
            if (preset == "unity-hdrp" || all)
                yield return ($"{setName}_MaskMap.png", Rgba(i => (tex.Metallic[i], tex.Ao[i], 255, (byte)(255 - tex.Roughness[i]))));
            if (!all) yield return ($"{setName}_Height.png", tex.Png("height"));
        }
        if (preset == "unreal" || all)
        {
            if (!all) yield return ($"{setName}_BaseColor.png", tex.Png("basecolor"));
            yield return ($"{setName}_Normal{(all ? "DX" : "")}.png", DirectXNormal());
            if (!all) yield return ($"{setName}_ORM.png", tex.Png("orm"));
            if (!all) yield return ($"{setName}_Height.png", tex.Png("height"));
        }
    }

    /// <summary>
    /// A Godot 4 ORMMaterial3D using the set's maps, found beside it (paths relative to the material, so the folder can
    /// go anywhere in a project). The height map is set but off: parallax costs, and suits some surfaces only.
    /// </summary>
    public static string GodotMaterial(string name, string fileStem)
    {
        static string Q(string v) => "\"" + v.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        var sb = new StringBuilder();
        sb.Append("[gd_resource type=\"ORMMaterial3D\" load_steps=5 format=3]\n\n");
        sb.Append($"[ext_resource type=\"Texture2D\" path={Q(fileStem + "_BaseColor.png")} id=\"1_color\"]\n");
        sb.Append($"[ext_resource type=\"Texture2D\" path={Q(fileStem + "_Normal.png")} id=\"2_normal\"]\n");
        sb.Append($"[ext_resource type=\"Texture2D\" path={Q(fileStem + "_ORM.png")} id=\"3_orm\"]\n");
        sb.Append($"[ext_resource type=\"Texture2D\" path={Q(fileStem + "_Height.png")} id=\"4_height\"]\n\n");
        sb.Append("[resource]\n");
        sb.Append($"resource_name = {Q(name)}\n");
        sb.Append("albedo_texture = ExtResource(\"1_color\")\n");
        sb.Append("orm_texture = ExtResource(\"3_orm\")\n");
        sb.Append("normal_enabled = true\n");
        sb.Append("normal_texture = ExtResource(\"2_normal\")\n");
        sb.Append("ao_enabled = true\n");
        sb.Append("heightmap_enabled = false\n");
        sb.Append("heightmap_scale = 1.0\n");
        sb.Append("heightmap_texture = ExtResource(\"4_height\")\n");
        return sb.ToString();
    }

    /// <param name="atlasGrid">0: a material per texture set. More: <paramref name="sets"/> is one atlas, the sets in a
    /// grid of that many cells a side (AtlasCell), and every set's UVs are moved into its cell (one material).</param>
    public static byte[] Glb(ForgeModel model, IReadOnlyList<ForgeTextures> sets, string generator = "NoorMD NoorForge", int atlasGrid = 0)
    {
        var asset = new Asset3D { Name = model.Name };
        var mesh = new Mesh3D { Name = model.Name };
        for (var s = 0; s < model.Sets.Count; s++)
        {
            var set = model.Sets[s];
            if (atlasGrid == 0 || s == 0)
            {
                var tex = atlasGrid > 0 ? sets[0] : s < sets.Count ? sets[s] : null;
                asset.Materials.Add(new Material3D
                {
                    Name = atlasGrid > 0 ? model.Name : set.Name, BaseColor = Vector4.One, Roughness = 1, Metallic = 1,
                    BaseColorPng = tex?.Png("basecolor"), NormalPng = tex?.Png("normal"), OcclusionRoughnessMetallicPng = tex?.Png("orm"),
                });
            }
            // Corners that share a position, normal and UV are one vertex.
            var sub = mesh.Sub(atlasGrid > 0 ? 0 : s);
            var index = new Dictionary<(Vector3, Vector3, Vector2), int>();
            for (var i = 0; i < set.Positions.Count; i++)
            {
                var uv = atlasGrid > 0 ? AtlasUv(set.Uvs[i], s, atlasGrid) : set.Uvs[i];
                var key = (set.Positions[i], set.Normals[i], uv);
                if (!index.TryGetValue(key, out var v)) index[key] = v = mesh.AddVertex(set.Positions[i], set.Normals[i], new Vector2(uv.X, 1 - uv.Y));
                sub.Indices.Add(v);
            }
        }
        mesh.ComputeTangents();
        asset.Root.Children.Add(new Node3D { Name = model.Name, Mesh = mesh });
        return GlbWriter.Write(asset, generator);
    }
}
