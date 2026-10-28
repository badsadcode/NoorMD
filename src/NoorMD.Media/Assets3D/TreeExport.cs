using System.Globalization;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// How a tree's levels of detail go into files, and what an engine needs to switch them. Each level's root node carries
/// glTF "extras" (Godot keeps them as the node's "extras" metadata): its level, and the camera distances it is seen
/// between. The tree's root says what the file is. The NoorMD Godot import plugin reads these to set visibility ranges
/// and the wind material; Unity groups the _LOD0, _LOD1… names into a LOD Group by itself.
/// </summary>
public static class TreeExport
{
    /// <summary>
    /// The distances (metres) where one level hands over to the next: one fewer than the levels. The first is a few
    /// times the tree's size, each next one 2.5 times farther.
    /// </summary>
    public static float[] SwitchDistances(TreeBuild build)
    {
        var size = Size(build);
        return Enumerable.Range(0, Math.Max(0, build.Lods.Count - 1)).Select(i => Round(MathF.Max(8, size * 2.5f) * MathF.Pow(2.5f, i))).ToArray();
    }

    /// <summary>Marks every level's root with its level and distances (both for one file and for a file per level).</summary>
    public static void Tag(TreeBuild build)
    {
        var at = SwitchDistances(build);
        for (var i = 0; i < build.Lods.Count; i++)
            build.Lods[i].Root.Extras = new Dictionary<string, object>
            {
                ["noor_lod"] = i,
                ["noor_lod_count"] = build.Lods.Count,
                ["noor_visible_from"] = i == 0 ? 0f : at[i - 1],
                ["noor_visible_to"] = i < at.Length ? at[i] : 0f,      // 0: no limit
                ["noor_billboard"] = build.Recipe.Billboard && i == build.Lods.Count - 1 && build.Lods.Count > 1,
            };
    }

    /// <summary>What the file is: on the root of a one-file tree, or on the level's root of a file per level.</summary>
    public static Dictionary<string, object> About(TreeBuild build) => new()
    {
        ["noor_tree"] = 1,
        ["noor_name"] = build.Recipe.Name,
        ["noor_height"] = Round(Size(build)),
        ["noor_wind"] = !build.Recipe.Wind ? "none" : build.Recipe.WindData == "color" ? "color" : "uv",
        ["noor_style"] = build.Recipe.Style,
    };

    /// <summary>All levels in one asset: a root holding Name_LOD0, Name_LOD1…, each tagged; the levels share materials.</summary>
    public static Asset3D OneFile(TreeBuild build)
    {
        Tag(build);
        if (build.Lods.Count == 1)
        {
            foreach (var (k, v) in About(build)) build.Lods[0].Root.Extras![k] = v;
            return build.Lods[0];
        }
        var all = new Asset3D { Name = build.Recipe.Name, Root = new Node3D { Name = build.Recipe.Name, Extras = About(build) } };
        // The longest list holds every level's materials in the same order (the billboard's comes last).
        all.Materials.AddRange(build.Lods.MaxBy(l => l.Materials.Count)!.Materials);
        foreach (var lod in build.Lods) all.Root.Children.Add(lod.Root);
        return all;
    }

    /// <summary>One level as its own file, tagged with its level and with what the file is.</summary>
    public static Asset3D Level(TreeBuild build, int level)
    {
        Tag(build);
        foreach (var (k, v) in About(build)) build.Lods[level].Root.Extras![k] = v;
        return build.Lods[level];
    }

    /// <summary>The tree's height in metres (its finest level, leaves included).</summary>
    public static float Size(TreeBuild build) =>
        build.Lods.Count == 0 ? (float)build.Recipe.Height
        : build.Lods[0].Root.All().Where(n => n.Mesh is { VertexCount: > 0 }).Select(n => n.Mesh!.Bounds().Max.Y + n.Translation.Y).DefaultIfEmpty((float)build.Recipe.Height).Max();

    private static float Round(float v) => float.Parse(v.ToString("0.##", CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
}
