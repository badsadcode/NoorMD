using System.Globalization;
using System.Text;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// A game the Asset Bench makes trees for: its presets (in their own group, with the game's triangles per level and
/// texture look), how its trees are exported (still ordinary glTF files and a manifest, for any engine), the names the
/// game's catalogue knows them by, and a note for whoever brings them into the game. NoorMD itself stays
/// game-agnostic: a profile only picks settings every tree has anyway.
/// </summary>
/// <param name="Group">The preset group holding the game's trees.</param>
/// <param name="Engine">The export's "For" choice (and so its level files and helpers).</param>
/// <param name="Catalogue">The game's name for a tree: {species} the recipe's name, {variant} A, B, C… in a variety pack.</param>
public sealed record GameProfile(string Id, string Name, string Description, string Group, string Engine, string LodFiles, bool Helpers, string Catalogue, string Notes)
{
    public string CatalogueName(string species, int variant) =>
        Catalogue.Replace("{species}", Species(species), StringComparison.Ordinal).Replace("{variant}", Variant(variant), StringComparison.Ordinal);

    public static string Species(string name) => string.Join('_', name.Split([' ', '-', '_'], StringSplitOptions.RemoveEmptyEntries));

    /// <summary>A, B, … Z, then AA, AB…</summary>
    public static string Variant(int i) => i < 26 ? ((char)('A' + i)).ToString() : Variant(i / 26 - 1) + (char)('A' + i % 26);
}

public static class GameProfiles
{
    public static readonly IReadOnlyList<GameProfile> All =
    [
        new("thornwake", "Thornwake", "Trees for Thornwake: three levels at the game's triangle budgets (it bakes its own far impostors, so no billboard), full PBR textures (colour, normal, ORM) at the game's 64 pixels, sampled sharp, a glTF file per level.",
            "Thornwake", "other", "separate", false, "TREE_{species}_{variant}",
            """
            Thornwake reads exported files and the manifest only (docs/ASSET_SPEC.md, Part 1), and maps NoorMD's names
            itself. For a look in the game without importing anything:

                --test-tree=<this folder>/<file stem>;<catalogue species, e.g. Pine_A>

            (the game adds "_LOD0.glb", "_LOD1.glb", "_LOD2.glb" to the stem).
            """),
    ];

    public static GameProfile? Find(string? id) => string.IsNullOrEmpty(id) ? null : All.FirstOrDefault(p => p.Id == id);

    /// <summary>One tree of a delivery, for the hand-off note.</summary>
    public sealed record Delivered(string Catalogue, string Recipe, IReadOnlyList<string> Files, IReadOnlyList<int> Triangles, float Height, float Width);

    /// <summary>
    /// The note that goes with an export made for a game: what each file is, what the levels cost, how materials,
    /// textures, axes and wind data are laid out, and the profile's own notes. Written for a person or an agent bringing
    /// the trees into the game.
    /// </summary>
    public static string Handoff(GameProfile profile, TreeRecipe recipe, string manifest, IReadOnlyList<Delivered> trees, int textureSize)
    {
        var inv = CultureInfo.InvariantCulture;
        var sb = new StringBuilder();
        sb.Append("# ").Append(recipe.Name).Append(" for ").Append(profile.Name).Append(" — hand-off\n\n");
        sb.Append("Made with NoorMD's Asset Bench (").Append(profile.Name).Append(" profile). Everything here is plain glTF 2.0 and JSON; nothing is engine-specific.\n\n");
        sb.Append("## Files\n\n");
        sb.Append("| ").Append(profile.Name).Append(" name | Files | Triangles per level | Height × width |\n|---|---|---|---|\n");
        foreach (var t in trees)
            sb.Append("| ").Append(t.Catalogue).Append(" | ").Append(string.Join(", ", t.Files.Select(f => "`" + f + "`")))
              .Append(" | ").Append(string.Join(" / ", t.Triangles.Select(n => n.ToString("N0", inv))))
              .Append(" | ").Append(t.Height.ToString("0.0", inv)).Append(" × ").Append(t.Width.ToString("0.0", inv)).Append(" m |\n");
        var stems = trees.Select(t => t.Files.FirstOrDefault(f => f.EndsWith("_LOD0.glb", StringComparison.Ordinal))).OfType<string>().Select(f => f[..^"_LOD0.glb".Length]).ToList();
        if (stems.Count > 0) sb.Append("\nFile stems (each level is the stem + `_LOD0.glb`, `_LOD1.glb`…): ").Append(string.Join(", ", stems.Select(x => "`" + x + "`"))).Append(".\n");
        sb.Append("\n* `").Append(manifest).Append("`: every tree, level, file, triangle count, bounds and material, for reading by a tool.\n");
        sb.Append("* `*.noortree.json`: each tree's recipe (with its seed), to remake it at another size or change it later.\n\n");
        sb.Append("## Layout\n\n");
        sb.Append("* A file per level, `_LOD0` the closest. Each file has one root; the wood is a mesh named `Trunk` (and `Branch_..`), the leaves `Leaves`.\n");
        sb.Append("* Metres, Y up (glTF), the pivot at the base of the trunk on the ground. Bounds in the manifest are Y up too.\n");
        sb.Append("* Materials: `Bark` (opaque) and `Leaves` (alpha MASK, cut-off 0.5, single-sided cards with real back faces)");
        if (recipe.Moss > 0) sb.Append(", `Moss` (alpha MASK)");
        sb.Append(".\n");
        if (recipe.Pixels > 0)
            sb.Append("* Textures ").Append(recipe.Pixels).Append(" × ").Append(recipe.Pixels).Append(" px, embedded, full PBR: colour (sRGB")
              .Append(recipe.PixelColours > 0 ? $", {recipe.PixelColours} colours" : "").Append("), normal (OpenGL, Y+) and ORM (R occlusion, G roughness, B metallic); leaves cut out hard. The files' samplers say NEAREST — keep the engine's filter on nearest for crisp pixels.\n");
        else if (textureSize > 0)
            sb.Append("* Textures ").Append(textureSize).Append(" px, embedded: colour (sRGB), normal (OpenGL, Y+), ORM (R occlusion, G roughness, B metallic).\n");
        sb.Append(recipe.Wind
            ? recipe.WindData == "color"
                ? "* Wind data in COLOR_0 (R trunk sway, G branch bend, B leaf flutter, A phase).\n"
                : "* Wind data in TEXCOORD_1 (x branch bend, y leaf flutter) and TEXCOORD_2 (x phase, y trunk sway); vertex colours carry painted shading only.\n"
            : "* No wind data.\n");
        sb.Append(recipe.Billboard ? "* The last level is a billboard (crossed cards).\n" : "* No billboard level: the game makes its own far impostors.\n");
        if (profile.Notes.Trim().Length > 0) sb.Append("\n## ").Append(profile.Name).Append("\n\n").Append(profile.Notes.Trim().Replace("\r\n", "\n")).Append('\n');
        return sb.ToString();
    }
}
