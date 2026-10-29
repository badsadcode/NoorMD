using System.Text;
using NoorMD.Media;
using NoorMD.Media.Forge;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>NoorForge's outputs past the first cut: height, a layer's mask, the Godot material, smart materials of your own.</summary>
public class ForgeOutputTests
{
    private static readonly ForgeModel Model = ForgeModel.ReadObj(ForgeModelTests.CubeOnFloor(), "Test");
    private static TextureMaps? Materials(string id) => TextureEngine.Render(TexturePresets.Make(id), 128);

    private static (ForgeBake Bake, ForgeTextures Tex) Run(params ForgeLayer[] layers)
    {
        var bake = ForgeBake.Bake(Model, 1, 96, new ForgeBake.Settings(AoRays: 0));
        return (bake, ForgeCompositor.Compose(Model, 1, bake, new ForgeRecipe { Layers = [.. layers] }.Clamped(), Materials));
    }

    private static double Covered(ForgeBake b, byte[] px) => Enumerable.Range(0, b.Size * b.Size).Where(i => b.Covered[i] == 1).Average(i => (double)px[i]);

    [Fact]
    public void Height_comes_from_the_layers()
    {
        // Nothing: flat (mid grey). A plain layer: its height. A material: its own relief, varied.
        Assert.InRange(Covered(Run().Bake, Run().Tex.Height), 127, 129);
        var (b, t) = Run(new ForgeLayer { Color = "#808080", Height = 0.9 });
        Assert.InRange(Covered(b, t.Height), 225, 232);
        var (b2, t2) = Run(new ForgeLayer { Color = "#808080", Height = 0.9, UseHeight = false });
        Assert.InRange(Covered(b2, t2.Height), 127, 129);
        var (mb, mt) = Run(new ForgeLayer { Material = "bricks-red", Scale = 0.5 });
        var values = Enumerable.Range(0, mb.Size * mb.Size).Where(i => mb.Covered[i] == 1).Select(i => (int)mt.Height[i]).ToList();
        Assert.True(values.Max() - values.Min() > 60, $"{values.Min()}–{values.Max()}");
        Assert.Equal(new byte[] { 137, 80, 78, 71 }, mt.Png("height")[..4]);
    }

    [Fact]
    public void A_layers_mask_shows_where_it_paints()
    {
        var bake = ForgeBake.Bake(Model, 1, 96, new ForgeBake.Settings(AoRays: 0));
        var top = ForgeCompositor.Mask(bake, new ForgeLayer { Mask = new ForgeMask { Kind = "top", Amount = 0.3, Noise = 0 } }.Clamped(), 1);
        double Avg(Func<System.Numerics.Vector3, bool> where) => Enumerable.Range(0, bake.Size * bake.Size).Where(i => bake.Covered[i] == 1 && where(bake.Normal[i])).Average(i => (double)top[i]);
        Assert.True(Avg(n => n.Y > 0.9f) > 240 && Avg(n => MathF.Abs(n.X) > 0.9f) < 15);
        var half = ForgeCompositor.Mask(bake, new ForgeLayer { Opacity = 0.5 }.Clamped(), 1);
        Assert.InRange(Covered(bake, half), 126, 129);
    }

    [Fact]
    public void The_export_names_each_map_and_a_godot_material_that_uses_them()
    {
        var (_, t) = Run(new ForgeLayer { Color = "#806040" });
        var files = ForgeExport.SetFiles("Rock \"big\"", t).ToDictionary(f => f.File, f => f.Data);
        Assert.Equal(["Rock \"big\"_BaseColor.png", "Rock \"big\"_Normal.png", "Rock \"big\"_ORM.png", "Rock \"big\"_Roughness.png", "Rock \"big\"_Metallic.png", "Rock \"big\"_AO.png", "Rock \"big\"_Height.png", "Rock \"big\".tres"], files.Keys);
        var tres = Encoding.UTF8.GetString(files["Rock \"big\".tres"]);
        Assert.StartsWith("[gd_resource type=\"ORMMaterial3D\" load_steps=5 format=3]", tres);
        Assert.Contains("path=\"Rock \\\"big\\\"_ORM.png\"", tres);           // beside the material, quotes escaped
        Assert.Contains("resource_name = \"Rock \\\"big\\\"\"", tres);
        foreach (var key in new[] { "albedo_texture = ExtResource(\"1_color\")", "orm_texture = ExtResource(\"3_orm\")", "normal_enabled = true", "normal_texture = ExtResource(\"2_normal\")", "heightmap_texture = ExtResource(\"4_height\")" })
            Assert.Contains(key, tres);
    }

    [Fact]
    public void Smart_materials_of_your_own_are_saved_listed_replaced_and_removed()
    {
        var folder = Path.Combine(Path.GetTempPath(), "noorforge-smart-" + Guid.NewGuid().ToString("N"));
        try
        {
            Assert.Empty(ForgeUserSmart.Load(folder));
            var id = ForgeUserSmart.Save(folder, "Old bronze", "Green in the cracks", [new ForgeLayer { Name = "Bronze", Color = "#a07030", Metallic = 1 }, new ForgeLayer { Name = "Verdigris", Color = "#40a080", Mask = new ForgeMask { Kind = "cavity" } }]);
            Assert.Equal("mine:old bronze", id);
            var all = ForgeUserSmart.Load(folder);
            Assert.Single(all);
            Assert.Equal("Old bronze", all[0].Smart.Name);
            Assert.Equal(["Bronze", "Verdigris"], all[0].Smart.Layers.Select(l => l.Name));
            Assert.Equal("cavity", all[0].Smart.Layers[1].Mask.Kind);
            // The same name replaces it; another name adds one.
            ForgeUserSmart.Save(folder, "old bronze", "", [new ForgeLayer { Name = "Only" }]);
            ForgeUserSmart.Save(folder, "Wet/../stone", "", [new ForgeLayer { Name = "Wet" }]);
            all = ForgeUserSmart.Load(folder);
            Assert.Equal(2, all.Count);
            Assert.Equal(["Only"], all.Single(s => s.Id == id).Smart.Layers.Select(l => l.Name));
            Assert.All(Directory.GetFiles(folder), f => Assert.Equal(folder, Path.GetDirectoryName(f)));
            Assert.Throws<ArgumentException>(() => ForgeUserSmart.Save(folder, "  ", "", [new ForgeLayer()]));
            // Removing: only ids it made, nothing outside the folder.
            Assert.False(ForgeUserSmart.Delete(folder, "mine:../x"));
            Assert.False(ForgeUserSmart.Delete(folder, "mossy-stone"));
            Assert.True(ForgeUserSmart.Delete(folder, id));
            Assert.Single(ForgeUserSmart.Load(folder));
        }
        finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
    }
}
