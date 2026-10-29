using System.Numerics;
using NoorMD.Media;
using NoorMD.Media.Forge;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>NoorForge stage 3: masks that follow another layer's, chipped edges, drips, and decals.</summary>
public class ForgeMaskTests
{
    private static readonly ForgeModel Model = ForgeModel.ReadObj(ForgeModelTests.CubeOnFloor(), "Test");
    private static readonly ForgeBake Bake = ForgeBake.Bake(Model, 1, 128, new ForgeBake.Settings(AoRays: 0));

    private static float[] Masks(ForgeRecipe recipe, string id)
    {
        recipe.Clamped();
        var masks = new Dictionary<string, float[]>();
        foreach (var l in recipe.Layers) masks[l.Id] = ForgePaint.LayerMask(Bake, l, 1, recipe.Picture, k => masks.GetValueOrDefault(k));
        return masks[id];
    }

    private static double Avg(float[] v, Func<Vector3, Vector3, bool> where) =>
        Enumerable.Range(0, Bake.Size * Bake.Size).Where(i => Bake.Covered[i] == 1 && where(Bake.Position[i], Bake.Normal[i])).Average(i => (double)v[i]);

    /// <summary>A layer painted on the cube's top middle (a disc, radius 0.15).</summary>
    private static ForgeLayer Spot(string id = "spot") => new()
    {
        Id = id, Mask = new ForgeMask { Kind = "none" },
        Strokes = [new ForgeStroke { Radius = 0.15, Hardness = 1, View = [0, -1, 0], Dabs = [0, 1, 0, 1, 1] }],
    };

    private static bool OnTop(Vector3 p, Vector3 n) => p.Y > 0.99f;

    [Fact]
    public void A_mask_can_follow_another_layer_spread_turned_round_or_as_a_rim()
    {
        double At(float[] v, float r0, float r1) => Avg(v, (p, n) => OnTop(p, n) && MathF.Sqrt(p.X * p.X + p.Z * p.Z) is var d && d >= r0 && d < r1);
        var same = Masks(new ForgeRecipe { Layers = [Spot(), new ForgeLayer { Id = "f", Mask = new ForgeMask { Kind = "layer", Layer = "spot", Amount = 0.5, Noise = 0 } }] }, "f");
        Assert.True(At(same, 0, 0.1f) > 0.95 && At(same, 0.25f, 0.35f) < 0.05);
        // Spread: grows past the spot.
        var spread = Masks(new ForgeRecipe { Layers = [Spot(), new ForgeLayer { Id = "f", Mask = new ForgeMask { Kind = "layer", Layer = "spot", Spread = 0.12, Amount = 0.5, Noise = 0 } }] }, "f");
        Assert.True(At(spread, 0.17f, 0.21f) > 0.5, $"{At(spread, 0.17f, 0.21f)}");
        Assert.True(At(spread, 0.4f, 0.48f) < 0.1);
        // A rim: around it, not in it.
        var rim = Masks(new ForgeRecipe { Layers = [Spot(), new ForgeLayer { Id = "f", Mask = new ForgeMask { Kind = "layer", Layer = "spot", Spread = 0.12, Ring = true, Amount = 0.5, Noise = 0 } }] }, "f");
        Assert.True(At(rim, 0, 0.08f) < 0.05 && At(rim, 0.17f, 0.21f) > 0.5);
        // Turned round: where that layer isn't.
        var not = Masks(new ForgeRecipe { Layers = [Spot(), new ForgeLayer { Id = "f", Mask = new ForgeMask { Kind = "layer", Layer = "spot", Invert = true, Amount = 0.5, Noise = 0 } }] }, "f");
        Assert.True(At(not, 0, 0.1f) < 0.05 && At(not, 0.3f, 0.45f) > 0.95);
        // Only layers below count: one above (or missing) gives nothing.
        var above = Masks(new ForgeRecipe { Layers = [new ForgeLayer { Id = "f", Mask = new ForgeMask { Kind = "layer", Layer = "spot", Noise = 0 } }, Spot()] }, "f");
        Assert.True(above.Max() == 0);
    }

    [Fact]
    public void Chips_follow_the_edges_in_lumps_and_drips_run_down_from_them()
    {
        var edges = Masks(new ForgeRecipe { Layers = [new ForgeLayer { Id = "e", Mask = new ForgeMask { Kind = "edges", Amount = 0.3, Noise = 0 } }] }, "e");
        var chips = Masks(new ForgeRecipe { Layers = [new ForgeLayer { Id = "c", Mask = new ForgeMask { Kind = "chips", Amount = 0.3, Noise = 0.8, NoiseScale = 0.08 } }] }, "c");
        bool TopEdge(Vector3 p, Vector3 n) => p.Y > 0.97f && (MathF.Abs(p.X) > 0.45f || MathF.Abs(p.Z) > 0.45f);
        bool Middle(Vector3 p, Vector3 n) => OnTop(p, n) && MathF.Abs(p.X) < 0.2f && MathF.Abs(p.Z) < 0.2f;
        Assert.True(Avg(chips, TopEdge) > 0.2 && Avg(chips, Middle) < 0.02, $"edge {Avg(chips, TopEdge)} middle {Avg(chips, Middle)}");
        // In lumps: along the edge (a little less of it) some is chipped, some isn't (unlike the even worn edge).
        chips = Masks(new ForgeRecipe { Layers = [new ForgeLayer { Id = "c", Mask = new ForgeMask { Kind = "chips", Amount = 0.2, Noise = 0.8, NoiseScale = 0.08 } }] }, "c");
        var along = Enumerable.Range(0, Bake.Size * Bake.Size).Where(i => Bake.Covered[i] == 1 && Bake.Position[i].Y > 0.96f && Bake.Position[i].X > 0.45f).Select(i => chips[i]).ToList();
        Assert.True(along.Count(v => v > 0.8) > along.Count / 10 && along.Count(v => v < 0.2) > along.Count / 10, $"{along.Count(v => v > 0.8)} / {along.Count(v => v < 0.2)} of {along.Count}");
        Assert.True(Avg(edges, TopEdge) > 0.5);
        // Drips from the spot on top… on top there's no "down"; from the worn top edges, down the sides, fading.
        var drips = Masks(new ForgeRecipe { Layers = [new ForgeLayer { Id = "d", Mask = new ForgeMask { Kind = "drips", Length = 0.6, Amount = 0.7, Noise = 0, Softness = 0.2 } }] }, "d");
        bool Side(Vector3 p, Vector3 n, float y0, float y1) => p.X > 0.495f && p.Y >= y0 && p.Y < y1;
        var high = Avg(drips, (p, n) => Side(p, n, 0.75f, 0.9f)); var low = Avg(drips, (p, n) => Side(p, n, 0.05f, 0.2f));
        Assert.True(high > 0.3 && low < high * 0.5, $"high {high}, low {low}");
        // From another layer: a band painted round the top of the sides runs down below it.
        var band = new ForgeLayer { Id = "band", Mask = new ForgeMask { Kind = "none" }, Strokes = [new ForgeStroke { Radius = 0.12, Hardness = 1, View = [-1, 0, 0], Dabs = [0.5f, 0.85f, 0, 1, 1] }] };
        var fromBand = Masks(new ForgeRecipe { Layers = [band, new ForgeLayer { Id = "d", Mask = new ForgeMask { Kind = "drips", Layer = "band", Length = 0.5, Amount = 0.7, Noise = 0, Softness = 0.2 } }] }, "d");
        Assert.True(Avg(fromBand, (p, n) => p.X > 0.495f && p.Y > 0.5f && p.Y < 0.68f && MathF.Abs(p.Z) < 0.05f) > 0.3);
        Assert.True(Avg(fromBand, (p, n) => p.X > 0.495f && p.Y > 0.5f && p.Y < 0.68f && MathF.Abs(p.Z) > 0.3f) < 0.05);
    }

    [Fact]
    public void Layers_get_ids_of_their_own_and_masks_name_them()
    {
        var r = new ForgeRecipe { Layers = [new ForgeLayer { Id = "a" }, new ForgeLayer { Id = "a" }, new ForgeLayer(), new ForgeLayer { Id = "bad id!" }, new ForgeLayer { Id = "L3" }] }.Clamped();
        Assert.Equal(r.Layers.Count, r.Layers.Select(l => l.Id).Distinct().Count());
        Assert.Equal("a", r.Layers[0].Id);
        Assert.All(r.Layers, l => Assert.Matches("^[A-Za-z0-9_-]+$", l.Id));
        var back = ForgeRecipe.FromJson(new ForgeRecipe { Layers = [new ForgeLayer { Id = "x", Mask = new ForgeMask { Kind = "layer", Layer = "y", Spread = 0.2, Ring = true } }] }.Clamped().ToJson());
        Assert.Equal(("layer", "y", 0.2, true), (back.Layers[0].Mask.Kind, back.Layers[0].Mask.Layer, back.Layers[0].Mask.Spread, back.Layers[0].Mask.Ring));
        Assert.Equal("", new ForgeMask { Layer = "../x" }.Clamped().Layer);
    }

    [Fact]
    public void A_decal_keeps_its_pictures_proportions()
    {
        // A wide white picture (4:1) stamped flat on the top: as wide as four times its half-height, as tall as two.
        var wide = ForgePicture.From("dwide", "Wide", 8, 2, Enumerable.Repeat((byte)255, 16).ToArray());
        var recipe = new ForgeRecipe { Pictures = [wide], Layers = [new ForgeLayer { Id = "d", Mask = new ForgeMask { Kind = "none" },
            Strokes = [new ForgeStroke { Radius = 0.1, View = [0, -1, 0], Tip = "dwide", Dabs = [0, 1, 0, 1, 1] }] }] };
        var v = Masks(recipe, "d");
        Assert.True(Avg(v, (p, n) => OnTop(p, n) && MathF.Abs(p.X) < 0.35f && MathF.Abs(p.Z) < 0.07f) > 0.95);
        Assert.True(Avg(v, (p, n) => OnTop(p, n) && MathF.Abs(p.X) > 0.45f) < 0.05);   // past its ends
        Assert.True(Avg(v, (p, n) => OnTop(p, n) && MathF.Abs(p.Z) > 0.14f) < 0.05);   // above and below it
    }
}
