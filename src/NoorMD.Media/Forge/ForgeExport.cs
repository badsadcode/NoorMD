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

    public static byte[] Glb(ForgeModel model, IReadOnlyList<ForgeTextures> sets, string generator = "NoorMD NoorForge")
    {
        var asset = new Asset3D { Name = model.Name };
        var mesh = new Mesh3D { Name = model.Name };
        for (var s = 0; s < model.Sets.Count; s++)
        {
            var set = model.Sets[s];
            var tex = s < sets.Count ? sets[s] : null;
            asset.Materials.Add(new Material3D
            {
                Name = set.Name, BaseColor = Vector4.One, Roughness = 1, Metallic = 1,
                BaseColorPng = tex?.Png("basecolor"), NormalPng = tex?.Png("normal"), OcclusionRoughnessMetallicPng = tex?.Png("orm"),
            });
            // Corners that share a position, normal and UV are one vertex.
            var sub = mesh.Sub(s);
            var index = new Dictionary<(Vector3, Vector3, Vector2), int>();
            for (var i = 0; i < set.Positions.Count; i++)
            {
                var key = (set.Positions[i], set.Normals[i], set.Uvs[i]);
                if (!index.TryGetValue(key, out var v)) index[key] = v = mesh.AddVertex(set.Positions[i], set.Normals[i], new Vector2(set.Uvs[i].X, 1 - set.Uvs[i].Y));
                sub.Indices.Add(v);
            }
        }
        mesh.ComputeTangents();
        asset.Root.Children.Add(new Node3D { Name = model.Name, Mesh = mesh });
        return GlbWriter.Write(asset, generator);
    }
}
