using System.Text.Json;
using NoorMD.Media.Assets3D;
using Xunit;

namespace NoorMD.Media.Tests;

public class GodotExportTests
{
    private static TreeBuild Build(string preset = "oak", bool billboard = true, string windData = "uv")
    {
        var r = TreePresets.Make(preset);
        r.Quality = "low";
        r.Lods = 2;
        r.Billboard = billboard;
        r.WindData = windData;
        return TreeBuilder.Build(r, new TreeBuilder.Options { TextureSize = 64 });
    }

    [Fact]
    public void One_file_holds_every_level_tagged_with_its_distances()
    {
        var build = Build();
        var (json, _) = GlbWriterTests.Parse(GlbWriter.Write(TreeExport.OneFile(build)));
        var nodes = json.GetProperty("nodes").EnumerateArray().ToList();
        var root = nodes[json.GetProperty("scenes")[0].GetProperty("nodes")[0].GetInt32()];
        Assert.Equal(1, root.GetProperty("extras").GetProperty("noor_tree").GetInt32());
        Assert.Equal("uv", root.GetProperty("extras").GetProperty("noor_wind").GetString());
        var levels = nodes.Where(n => n.TryGetProperty("extras", out var e) && e.TryGetProperty("noor_lod", out _)).ToList();
        Assert.Equal(3, levels.Count);
        Assert.Equal(["Oak_LOD0", "Oak_LOD1", "Oak_LOD2"], levels.Select(n => n.GetProperty("name").GetString()));
        // Each level starts where the one before ends; the billboard has no far limit.
        var e0 = levels[0].GetProperty("extras");
        var e1 = levels[1].GetProperty("extras");
        var e2 = levels[2].GetProperty("extras");
        Assert.Equal(0, e0.GetProperty("noor_visible_from").GetSingle());
        Assert.Equal(e0.GetProperty("noor_visible_to").GetSingle(), e1.GetProperty("noor_visible_from").GetSingle());
        Assert.Equal(e1.GetProperty("noor_visible_to").GetSingle(), e2.GetProperty("noor_visible_from").GetSingle());
        Assert.True(e1.GetProperty("noor_visible_to").GetSingle() > e0.GetProperty("noor_visible_to").GetSingle());
        Assert.Equal(0, e2.GetProperty("noor_visible_to").GetSingle());
        Assert.True(e2.GetProperty("noor_billboard").GetBoolean());
        Assert.False(e0.GetProperty("noor_billboard").GetBoolean());
        // A few tree heights before the first switch.
        Assert.InRange(e0.GetProperty("noor_visible_to").GetSingle(), TreeExport.Size(build) * 2, TreeExport.Size(build) * 4);
    }

    [Fact]
    public void In_one_file_the_billboard_keeps_its_own_material()
    {
        var (json, _) = GlbWriterTests.Parse(GlbWriter.Write(TreeExport.OneFile(Build())));
        var materials = json.GetProperty("materials").EnumerateArray().Select(m => m.GetProperty("name").GetString()).ToList();
        Assert.Equal(materials.Distinct().Count(), materials.Count);
        var billboardMesh = json.GetProperty("meshes").EnumerateArray().Single(m => m.GetProperty("name").GetString() == "Billboard");
        Assert.Equal("Billboard", materials[billboardMesh.GetProperty("primitives")[0].GetProperty("material").GetInt32()]);
        // The trunk of the finest level still has the bark.
        var trunk = json.GetProperty("meshes").EnumerateArray().First(m => m.GetProperty("name").GetString() == "Trunk");
        Assert.Equal("Bark", materials[trunk.GetProperty("primitives")[0].GetProperty("material").GetInt32()]);
    }

    [Fact]
    public void A_file_per_level_says_what_it_is_and_holds_only_what_it_uses()
    {
        var build = Build();
        var (far, _) = GlbWriterTests.Parse(GlbWriter.Write(TreeExport.Level(build, 2)));
        var root = far.GetProperty("nodes")[0].GetProperty("extras");
        Assert.Equal(2, root.GetProperty("noor_lod").GetInt32());
        Assert.Equal(1, root.GetProperty("noor_tree").GetInt32());
        Assert.Equal("Billboard", Assert.Single(far.GetProperty("materials").EnumerateArray()).GetProperty("name").GetString());
        Assert.Single(far.GetProperty("images").EnumerateArray());
    }

    [Fact]
    public void Leaves_let_light_through_and_say_so_in_the_file()
    {
        var (json, _) = GlbWriterTests.Parse(GlbWriter.Write(TreeExport.Level(Build(billboard: false), 0)));
        var materials = json.GetProperty("materials").EnumerateArray().ToList();
        var leaves = materials.Single(m => m.GetProperty("name").GetString() == "Leaves");
        Assert.InRange(leaves.GetProperty("extensions").GetProperty("KHR_materials_diffuse_transmission").GetProperty("diffuseTransmissionFactor").GetSingle(), 0.2f, 0.5f);
        Assert.False(materials.Single(m => m.GetProperty("name").GetString() == "Bark").TryGetProperty("extensions", out _));
        // Optional: an engine that doesn't know it still loads the file.
        Assert.Contains("KHR_materials_diffuse_transmission", json.GetProperty("extensionsUsed").EnumerateArray().Select(e => e.GetString()));
        Assert.False(json.TryGetProperty("extensionsRequired", out _));
    }

    [Fact]
    public void Wind_in_colours_and_no_wind_are_named()
    {
        var colour = Build("birch", billboard: false, windData: "color");
        Assert.Equal("color", TreeExport.About(colour)["noor_wind"]);
        var still = TreePresets.Make("birch");
        still.Wind = false; still.Quality = "low"; still.Lods = 1; still.Billboard = false;
        var b = TreeBuilder.Build(still, new TreeBuilder.Options());
        Assert.Equal("none", TreeExport.About(b)["noor_wind"]);
        // A single level: the tree's root is that level, with no distances to switch.
        var (json, _) = GlbWriterTests.Parse(GlbWriter.Write(TreeExport.OneFile(b)));
        var extras = json.GetProperty("nodes")[0].GetProperty("extras");
        Assert.Equal(1, extras.GetProperty("noor_lod_count").GetInt32());
        Assert.Equal(0, extras.GetProperty("noor_visible_to").GetSingle());
    }

    [Fact]
    public void The_plugin_files_are_ours_and_written_once_per_version()
    {
        foreach (var (name, text) in GodotAddon.Files)
        {
            Assert.Contains(GodotAddon.Header, text.Split('\n')[0]);
            Assert.DoesNotContain("\r", text);
            if (name.EndsWith(".gd", StringComparison.Ordinal))
            {
                // GDScript: indented with tabs only, and the import script reads the same keys the export writes.
                Assert.DoesNotContain(text.Split('\n'), l => l.StartsWith(' '));
                if (name == "noor_tree_import.gd")
                    foreach (var key in new[] { "noor_tree", "noor_lod", "noor_visible_from", "noor_visible_to", "noor_height", "noor_wind", "noor_sharp" }) Assert.Contains($"\"{key}\"", text);
            }
        }
        var shader = GodotAddon.Files.Single(f => f.Name.EndsWith(".gdshader", StringComparison.Ordinal)).Text;
        Assert.Equal(shader.Count(c => c == '{'), shader.Count(c => c == '}'));
        foreach (var uniform in new[] { "albedo_texture", "use_albedo_texture", "albedo_tint", "use_alpha_cutoff", "alpha_cutoff", "roughness", "metallic", "normal_texture", "use_normal_texture", "normal_strength", "orm_texture", "use_orm_texture", "emission", "wind_enabled", "wind_in_color", "vertex_shading", "tree_height", "sharp_pixels", "albedo_sharp", "normal_sharp", "orm_sharp", "keep_coverage", "backlight" })
            Assert.Contains($" {uniform} ", shader);

        var dir = Path.Combine(Path.GetTempPath(), "noormd-godot-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(Path.Combine(dir, "game", "art", "trees"));
            File.WriteAllText(Path.Combine(dir, "game", "project.godot"), "config_version=5\n");
            Assert.Equal(Path.Combine(dir, "game"), GodotAddon.ProjectOf(Path.Combine(dir, "game", "art", "trees")));
            var addons = Path.Combine(dir, "game", "addons");
            Assert.Equal(GodotAddon.Files.Count, GodotAddon.WriteTo(addons).Count);
            // Again: nothing to do. Your own change to a file (no header) is kept; one of ours from an older version is updated.
            Assert.Empty(GodotAddon.WriteTo(addons));
            var readme = Path.Combine(addons, GodotAddon.Folder, "README.txt");
            var cfg = Path.Combine(addons, GodotAddon.Folder, "plugin.cfg");
            File.WriteAllText(readme, "my notes");
            File.WriteAllText(cfg, "; NoorMD Asset Bench, Godot tree import v0\n");
            var again = GodotAddon.WriteTo(addons);
            Assert.Equal([cfg], again);
            Assert.Equal("my notes", File.ReadAllText(readme));
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void The_manifest_knows_the_bounds_and_each_maps_colour_space()
    {
        var build = Build();
        var (lo, hi) = TreeExport.Bounds(build.Lods[0]);
        Assert.InRange(hi.Y, TreeExport.Size(build) - 0.01f, TreeExport.Size(build) + 0.01f);
        Assert.True(lo.Y <= 0.05f && hi.X > 0 && lo.X < 0 && hi.Z > 0 && lo.Z < 0);
        var bark = build.Lods[0].Materials.First(m => m.Name == "Bark");
        var maps = JsonSerializer.Serialize(TreeExport.Maps(bark, 64));
        Assert.Contains("\"map\":\"baseColor\"", maps);
        Assert.Contains("\"colorSpace\":\"sRGB\"", maps);
        Assert.Contains("\"convention\":\"OpenGL (green \\u002BY), as glTF\"", maps);
        Assert.Contains("R occlusion, G roughness, B metallic", maps);
        var leaves = JsonSerializer.Serialize(TreeExport.Maps(build.Lods[0].Materials.First(m => m.Name == "Leaves"), 64));
        Assert.Contains("A coverage (alpha cut-out at 0.5)", leaves);
    }

    /// <summary>
    /// For the Godot check (CI and by hand): NOORMD_GODOT_OUT gets a Godot project with the plugin turned on and trees to
    /// import; tests/godot/check.gd then imports them in a headless Godot and checks what the plugin did.
    /// </summary>
    [Fact]
    public void Writes_a_godot_project_for_the_import_check()
    {
        var dir = Environment.GetEnvironmentVariable("NOORMD_GODOT_OUT");
        if (string.IsNullOrEmpty(dir)) return;
        Directory.CreateDirectory(Path.Combine(dir, "trees"));
        File.WriteAllText(Path.Combine(dir, "project.godot"), """
            config_version=5

            [application]

            config/name="NoorMD tree import check"

            [editor_plugins]

            enabled=PackedStringArray("res://addons/noor_trees/plugin.cfg")

            """);
        GodotAddon.WriteTo(Path.Combine(dir, "addons"));
        File.WriteAllBytes(Path.Combine(dir, "trees", "oak.glb"), GlbWriter.Write(TreeExport.OneFile(Build())));
        File.WriteAllBytes(Path.Combine(dir, "trees", "birch_colour.glb"), GlbWriter.Write(TreeExport.OneFile(Build("birch", billboard: false, windData: "color"))));
        var mushroom = Build("fly-agaric");
        File.WriteAllBytes(Path.Combine(dir, "trees", "fly_agaric_LOD2.glb"), GlbWriter.Write(TreeExport.Level(mushroom, 2)));
        var small = TreeBuilder.Build(TreePresets.Make("thornwake-pine"), new TreeBuilder.Options { TextureSize = 256 });
        File.WriteAllBytes(Path.Combine(dir, "trees", "pine_small_LOD0.glb"), GlbWriter.Write(TreeExport.Level(small, 0)));
        // Not a NoorMD tree: must come through untouched.
        File.WriteAllBytes(Path.Combine(dir, "trees", "plain.glb"), GlbWriter.Write(GlbWriterTests.Sample()));
        // A rock: three levels in one file, three convex collision pieces in the closest.
        var outcrop = RockBuilder.Build(RockPresets.Make("outcrop"), new RockBuilder.Options { TextureSize = 64 });
        File.WriteAllBytes(Path.Combine(dir, "trees", "outcrop.glb"), GlbWriter.Write(RockExport.OneFile(outcrop)));
        File.WriteAllText(Path.Combine(dir, "expected.json"), JsonSerializer.Serialize(new { oak = TreeExport.SwitchDistances(Build()), outcrop = RockExport.SwitchDistances(outcrop) }));
    }
}
