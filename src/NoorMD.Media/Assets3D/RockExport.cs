namespace NoorMD.Media.Assets3D;

/// <summary>
/// How a rock's levels of detail go into files, tagged like a tree's (glTF extras on each level's root: its level and
/// the distances it is seen between), so the NoorMD Godot plugin switches them; the root says it is a rock. The
/// collision pieces stay in the closest level.
/// </summary>
public static class RockExport
{
    /// <summary>Where one level hands over to the next (metres): about 12 times the rock's size, each next 2.5 times farther.</summary>
    public static float[] SwitchDistances(RockBuild build) =>
        Enumerable.Range(0, Math.Max(0, build.Lods.Count - 1)).Select(i => MathF.Round(MathF.Max(4, MathF.Max(build.Width, build.Height) * 12) * MathF.Pow(2.5f, i), 1)).ToArray();

    public static void Tag(RockBuild build)
    {
        var at = SwitchDistances(build);
        for (var i = 0; i < build.Lods.Count; i++)
            build.Lods[i].Root.Extras = new Dictionary<string, object>
            {
                ["noor_lod"] = i,
                ["noor_lod_count"] = build.Lods.Count,
                ["noor_visible_from"] = i == 0 ? 0f : at[i - 1],
                ["noor_visible_to"] = i < at.Length ? at[i] : 0f,
            };
    }

    public static Dictionary<string, object> About(RockBuild build) => new()
    {
        ["noor_rock"] = 1,
        ["noor_name"] = build.Recipe.Name,
        ["noor_kind"] = build.Recipe.Kind,
        ["noor_style"] = build.Recipe.Style,
        ["noor_collision_pieces"] = build.Collision.Count,
    };

    /// <summary>All levels in one asset: a root holding Name_LOD0, Name_LOD1…, each tagged.</summary>
    public static Asset3D OneFile(RockBuild build)
    {
        Tag(build);
        if (build.Lods.Count == 1)
        {
            foreach (var (k, v) in About(build)) build.Lods[0].Root.Extras![k] = v;
            return build.Lods[0];
        }
        var all = new Asset3D { Name = build.Recipe.Name, Root = new Node3D { Name = GameProfile.Species(build.Recipe.Name), Extras = About(build) } };
        all.Materials.AddRange(build.Lods.MaxBy(l => l.Materials.Count)!.Materials);
        for (var i = 0; i < build.Lods.Count; i++)
        {
            build.Lods[i].Root.Name = $"{GameProfile.Species(build.Recipe.Name)}_LOD{i}";
            all.Root.Children.Add(build.Lods[i].Root);
        }
        return all;
    }

    public static Asset3D Level(RockBuild build, int level)
    {
        Tag(build);
        foreach (var (k, v) in About(build)) build.Lods[level].Root.Extras![k] = v;
        return build.Lods[level];
    }

    /// <summary>Triangles drawn on a level (its collision pieces left out).</summary>
    public static int Drawn(Asset3D level) => level.Root.All().Where(n => n.Mesh != null && !n.Name.EndsWith("-convcolonly", StringComparison.Ordinal)).Sum(n => n.Mesh!.TriangleCount);
}
