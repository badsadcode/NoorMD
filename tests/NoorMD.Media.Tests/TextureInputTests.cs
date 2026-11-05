using NoorMD.Media;
using NoorMD.Media.Forge;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>A material's inputs: the standard ones and its own, put into the recipe; NoorForge's layers keep their values.</summary>
public class TextureInputTests
{
    [Fact]
    public void Every_material_has_the_standard_inputs_and_some_their_own()
    {
        var plain = TexturePresets.Make("stone-cobbles");
        Assert.Contains(TextureInputs.All(plain), i => i.Id == "dirt" && i.Target == "surface.dirt");
        var mossy = TexturePresets.Make("stone-mossy");
        var moss = Assert.Single(mossy.Inputs);
        Assert.Equal(0.9, TextureInputs.Get(mossy, moss.Target)); // the preset's own moss
        Assert.Equal(2, mossy.InputPresets.Count);
        // Every built-in input points at something real.
        foreach (var p in TexturePresets.All) { var r = TexturePresets.Make(p.Id); Assert.All(TextureInputs.All(r), i => Assert.NotNull(TextureInputs.Get(r, i.Target))); }
    }

    [Fact]
    public void Values_go_into_a_copy_held_in_range_and_change_the_maps()
    {
        var r = TexturePresets.Make("stone-mossy");
        var dry = TextureInputs.Apply(r, new Dictionary<string, double> { ["moss"] = 0, ["dirt"] = 5 });
        Assert.Equal(0, TextureInputs.Get(dry, "layer.T3.tintAmount"));
        Assert.Equal(1, dry.Surface.Dirt);               // held within its range
        Assert.Equal(0.9, TextureInputs.Get(r, "layer.T3.tintAmount")); // the original untouched
        var a = TextureEngine.Render(r, 64); var b = TextureEngine.Render(dry, 64);
        Assert.NotEqual(a.Albedo, b.Albedo);
        // Targets that aren't number properties are refused (no strings, no unknown names).
        Assert.False(TextureInputs.Valid("surface.rampMode")); Assert.False(TextureInputs.Valid("layer.T1.type")); Assert.False(TextureInputs.Valid("system.exit"));
        Assert.True(TextureInputs.Valid("layer.T1.variation"));
        var bad = new TextureRecipe { Inputs = [new TextureInput { Id = "x", Target = "surface.rampMode" }] }.Clamped();
        Assert.Empty(bad.Inputs);
    }

    [Fact]
    public void A_forge_layer_keys_its_material_by_its_inputs()
    {
        var l = new ForgeLayer { Material = "stone-mossy" };
        Assert.Equal("stone-mossy", l.MaterialKey);
        l.Inputs = new() { ["moss"] = 0.25, ["dirt"] = 0.5 };
        Assert.Equal("stone-mossy?dirt=0.5&moss=0.25", l.MaterialKey); // sorted: the same values, the same key
        l.Inputs["bad name!"] = 1; l.Clamped();
        Assert.Equal(2, l.Inputs!.Count);
    }
}
