using System.Numerics;
using NoorMD.Media;
using NoorMD.Media.Forge;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>NoorForge exports: every texture set in one atlas (one material), and smaller copies for lower levels.</summary>
public class ForgeAtlasTests
{
    private static readonly ForgeModel Model = ForgeModel.ReadObj(ForgeModelTests.CubeOnFloor(), "Test");

    private static ForgeTextures Set(int s, int size, string colour)
    {
        var bake = ForgeBake.Bake(Model, s, size, new ForgeBake.Settings(AoRays: 0));
        return ForgeCompositor.Compose(Model, s, bake, new ForgeRecipe { Layers = [new ForgeLayer { Color = colour }] }.Clamped(), _ => null);
    }

    [Fact]
    public void Texture_sets_share_one_atlas_and_the_model_finds_its_colours_in_it()
    {
        // The floor red, the stone blue: two sets in a 2×2 atlas (a cell left over).
        var cells = new[] { Set(0, 64, "#d02020"), Set(1, 64, "#2020d0") };
        var atlas = ForgeExport.Atlas(cells);
        Assert.Equal(2, ForgeExport.AtlasGrid(2));
        Assert.Equal(128, atlas.Size);
        Assert.Equal((0, 0), ForgeExport.AtlasCell(0, 2));
        Assert.Equal((1, 0), ForgeExport.AtlasCell(1, 2));
        Assert.Equal(new Vector2(0.75f, 0.75f), ForgeExport.AtlasUv(new Vector2(0.5f, 0.5f), 1, 2));
        // The GLB has one material and every corner's UV points at its own set's colour.
        var glb = ForgeExport.Glb(Model, [atlas], atlasGrid: 2);
        var back = ForgeModel.ReadGlb(glb, "Back");
        Assert.Single(back.Sets);
        var set = back.Sets[0];
        Assert.False(set.Unwrapped);
        for (var t = 0; t < set.TriangleCount; t++)
        {
            var c = (set.Uvs[t * 3] + set.Uvs[t * 3 + 1] + set.Uvs[t * 3 + 2]) / 3;
            int x = Math.Clamp((int)(c.X * atlas.Size), 0, atlas.Size - 1), y = Math.Clamp((int)((1 - c.Y) * atlas.Size), 0, atlas.Size - 1);
            var i = y * atlas.Size + x;
            var floor = set.Positions[t * 3].Y + set.Positions[t * 3 + 1].Y + set.Positions[t * 3 + 2].Y == 0 && MathF.Abs(set.Positions[t * 3].X) > 1;
            if (floor) Assert.True(atlas.BaseColor[i * 3] > 150 && atlas.BaseColor[i * 3 + 2] < 80, $"floor triangle {t}");
            else Assert.True(atlas.BaseColor[i * 3 + 2] > 150 && atlas.BaseColor[i * 3] < 80, $"stone triangle {t}");
        }
        // The empty cell is flat and plain.
        var empty = (100 * atlas.Size + 30) * 3;
        Assert.Equal((128, 128, 255), (atlas.Normal[empty], atlas.Normal[empty + 1], atlas.Normal[empty + 2]));
    }

    [Fact]
    public void Smaller_copies_and_an_atlas_are_kept_in_the_recipe()
    {
        var r = ForgeRecipe.FromJson(new ForgeRecipe { Atlas = true, LodCopies = 2 }.ToJson());
        Assert.True(r.Atlas);
        Assert.Equal(2, r.LodCopies);
        Assert.Equal(2, new ForgeRecipe { LodCopies = 9 }.Clamped().LodCopies);
        // Copies get the level in their names, for the engine to pair them with a level.
        var small = Set(1, 32, "#808080");
        Assert.Contains("Crate_LOD1_ORM.png", ForgeExport.SetFiles("Crate_LOD1", small, "unreal").Select(f => f.File));
        Assert.Throws<ArgumentException>(() => ForgeExport.Atlas([Set(0, 32, "#fff000"), Set(1, 64, "#000fff")]));
    }
}
