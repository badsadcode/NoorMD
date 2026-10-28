using NoorMD.Core.Export;
using Xunit;

namespace NoorMD.Core.Tests;

public class ExportLayoutTests
{
    private static Dictionary<string, string> T(string name, string map = "albedo", string size = "2048", string family = "Walls")
    {
        var t = ExportLayouts.NameTokens(name);
        foreach (var kv in ExportLayouts.MapTokens(map)) t[kv.Key] = kv.Value;
        t["size"] = size;
        foreach (var kv in ExportLayouts.NameTokens(family, "family")) t[kv.Key] = kv.Value;   // as the app does
        return t;
    }

    private static string TexturePath(string layout, string name, string map)
    {
        var l = ExportLayouts.Get(layout)!;
        var t = T(name, map);
        return string.Join('/', [.. ExportLayouts.Folders(ExportLayouts.Expand(l.TextureFolder, t)), ExportLayouts.FileName(ExportLayouts.Expand(l.TextureFile, t), name) + ".png"]);
    }

    [Fact]
    public void Templates_give_each_engine_its_usual_structure_and_names()
    {
        Assert.Equal("Red_bricks_albedo.png", TexturePath("flat", "Red bricks", "albedo")); // as before templates
        Assert.Equal("Red_bricks/Red_bricks_normal.png", TexturePath("per-item", "Red bricks", "normal"));
        Assert.Equal("assets/materials/red_bricks/red_bricks_roughness.png", TexturePath("godot", "Red bricks", "roughness"));
        Assert.Equal("Assets/Materials/RedBricks/Textures/RedBricks_MetallicSmoothness.png", TexturePath("unity", "Red bricks", "metallic_smoothness"));
        Assert.Equal("Content/Materials/RedBricks/T_RedBricks_ORM.png", TexturePath("unreal", "Red bricks", "orm"));
        Assert.Equal("Content/Materials/RedBricks/T_RedBricks_BC.png", TexturePath("unreal", "Red bricks", "basecolor"));
        Assert.Equal("Textures/2048/Red_bricks/Red_bricks_height.png", TexturePath("by-size", "Red bricks", "height"));
    }

    [Fact]
    public void Music_goes_to_each_engines_music_folder()
    {
        string Music(string layout, string name)
        {
            var l = ExportLayouts.Get(layout)!;
            var t = T(name, family: "Exploration");
            return string.Join('/', [.. ExportLayouts.Folders(ExportLayouts.Expand(l.MusicFolder, t)), ExportLayouts.FileName(ExportLayouts.Expand(l.MusicFile, t), name) + ".wav"]);
        }
        Assert.Equal("Cozy_village.wav", Music("flat", "Cozy village"));
        Assert.Equal("Cozy_village/Cozy_village.wav", Music("per-item", "Cozy village"));
        Assert.Equal("assets/audio/music/cozy_village/cozy_village.wav", Music("godot", "Cozy village"));
        Assert.Equal("Assets/Audio/Music/CozyVillage/CozyVillage.wav", Music("unity", "Cozy village"));
        Assert.Equal("Content/Audio/Music/CozyVillage/A_CozyVillage.wav", Music("unreal", "Cozy village"));
        Assert.Equal("Audio/Music/Exploration/Cozy_village/Cozy_village.wav", Music("by-size", "Cozy village"));
    }

    [Fact]
    public void Models_go_to_each_engines_model_folder_by_kind()
    {
        string Model(string layout, string name)
        {
            var l = ExportLayouts.Get(layout)!;
            var t = T(name, family: "Broadleaf");
            return string.Join('/', [.. ExportLayouts.Folders(ExportLayouts.Expand(l.ModelFolder, t)), ExportLayouts.FileName(ExportLayouts.Expand(l.ModelFile, t), name) + ".glb"]);
        }
        Assert.Equal("Old_oak.glb", Model("flat", "Old oak"));
        Assert.Equal("Old_oak/Old_oak.glb", Model("per-item", "Old oak"));
        Assert.Equal("assets/models/broadleaf/old_oak/old_oak.glb", Model("godot", "Old oak"));
        Assert.Equal("Assets/Models/Broadleaf/OldOak/OldOak.glb", Model("unity", "Old oak"));
        Assert.Equal("Content/Broadleaf/OldOak/SM_OldOak.glb", Model("unreal", "Old oak"));
        Assert.Equal("Models/Broadleaf/Old_oak/Old_oak.glb", Model("by-size", "Old oak"));
    }

    [Fact]
    public void Names_split_into_words_however_they_are_written()
    {
        Assert.Equal("WornPaintedPanels", ExportLayouts.NameTokens("worn painted-panels")["Name"]);
        Assert.Equal("red_bricks_2", ExportLayouts.NameTokens("RedBricks 2")["name_snake"]);
        Assert.Equal("żółta-łódź", ExportLayouts.NameTokens("Żółta Łódź")["name-kebab"]);
        Assert.Equal("untitled", ExportLayouts.NameTokens("  !!  ")["name_snake"]);
    }

    [Fact]
    public void One_variation_drops_its_number()
    {
        var t = ExportLayouts.NameTokens("Wind gust");
        t["n"] = "03";
        Assert.Equal("A_WindGust_03", ExportLayouts.Expand("A_{Name}_{n}", t));
        Assert.Equal("A_WindGust", ExportLayouts.Expand("A_{Name}_{n}", t, single: true));
        Assert.Equal("Wind_gust", ExportLayouts.Expand("{name} {n}", t, single: true));
        Assert.Equal("Wind_gust", ExportLayouts.Expand("{name}{unknown}", t)); // unknown tokens are left out
    }

    [Theory]
    [InlineData("../../Windows/System32", "Windows/System32")]
    [InlineData("C:/Users/x", "C_/Users/x")]
    [InlineData("a/./b//c/", "a/b/c")]
    [InlineData("CON/aux.txt/  spaced  ./name?*", "CON_/aux.txt_/spaced/name__")]
    public void Folder_patterns_can_not_leave_the_export_folder_or_make_bad_names(string pattern, string expected) =>
        Assert.Equal(expected, string.Join('/', ExportLayouts.Folders(pattern)));

    [Fact]
    public void Paths_stay_under_the_root()
    {
        var root = Path.Combine(Path.GetTempPath(), "noorproject");
        Assert.Equal(Path.Combine(root, "Assets", "Tex"), ExportLayouts.Under(root, ExportLayouts.Folders("Assets/Tex")));
        Assert.Equal(Path.GetFullPath(root), ExportLayouts.Under(root, []));
        Assert.Throws<InvalidOperationException>(() => ExportLayouts.Under(root, [".."]));
        Assert.Equal("untitled", ExportLayouts.FileName("///", ""));
        Assert.Equal("a_b", ExportLayouts.FileName("a/b", "x"));
    }

    [Fact]
    public void Projects_are_kept_by_folder()
    {
        var dir = Directory.CreateTempSubdirectory("noorexport").FullName;
        try
        {
            var store = new ExportProjectStore(Path.Combine(dir, "projects.json"));
            var game = Directory.CreateDirectory(Path.Combine(dir, "My Game")).FullName;
            var a = store.Add(game);
            Assert.Equal("My Game", a.Name);
            Assert.Equal(a, store.Add(game + Path.DirectorySeparatorChar)); // the same folder twice is one project
            var b = store.Add(Directory.CreateDirectory(Path.Combine(dir, "Other")).FullName, "Jam entry");
            Assert.Equal(["p1", "p2"], store.List().Select(p => p.Id));
            Assert.Equal("Jam entry", store.Get("p2")!.Name);
            store.Remove("p1");
            Assert.Equal(["p2"], store.List().Select(p => p.Id));
            File.WriteAllText(Path.Combine(dir, "projects.json"), "not json");
            Assert.Empty(store.List());
        }
        finally { Directory.Delete(dir, true); }
    }
}
