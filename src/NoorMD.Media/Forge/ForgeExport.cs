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

    /// <summary>One texture set's files: {setName}_{Map}.png and the Godot material {setName}.tres beside them.</summary>
    public static IEnumerable<(string File, byte[] Data)> SetFiles(string setName, ForgeTextures tex)
    {
        foreach (var (map, suffix) in Maps) yield return ($"{setName}_{suffix}.png", tex.Png(map));
        yield return ($"{setName}.tres", Encoding.UTF8.GetBytes(GodotMaterial(setName, setName)));
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
