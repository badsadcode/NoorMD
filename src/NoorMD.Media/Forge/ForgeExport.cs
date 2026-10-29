using System.Numerics;
using NoorMD.Media.Assets3D;

namespace NoorMD.Media.Forge;

/// <summary>The textured model: a GLB with each texture set's maps on its material, the UVs they were painted through.</summary>
public static class ForgeExport
{
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
