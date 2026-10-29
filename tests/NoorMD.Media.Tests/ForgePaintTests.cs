using System.Numerics;
using NoorMD.Media;
using NoorMD.Media.Forge;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>NoorForge stage 2: strokes painted on the model, into a layer's mask, at any texture size.</summary>
public class ForgePaintTests
{
    private static readonly ForgeModel Model = ForgeModel.ReadObj(FlatCubeOnFloor(), "Test");

    /// <summary>The floor and cube of ForgeModelTests, each face with its own normal (hard edges, as a crate).</summary>
    private static string FlatCubeOnFloor()
    {
        var sb = new System.Text.StringBuilder("o Floor\nusemtl Ground\nv -2 0 -2\nv 2 0 -2\nv 2 0 2\nv -2 0 2\nvn 0 1 0\nf 1//1 3//1 2//1\nf 1//1 4//1 3//1\no Cube\nusemtl Stone\n");
        foreach (var (x, y, z) in new[] { (-0.5, 0, -0.5), (0.5, 0, -0.5), (0.5, 1, -0.5), (-0.5, 1, -0.5), (-0.5, 0, 0.5), (0.5, 0, 0.5), (0.5, 1, 0.5), (-0.5, 1, 0.5) })
            sb.Append(FormattableString.Invariant($"v {x} {y} {z}\n"));
        var faces = new[] { ("5 8 7 6", "0 0 -1"), ("9 10 11 12", "0 0 1"), ("5 6 10 9", "0 -1 0"), ("8 12 11 7", "0 1 0"), ("5 9 12 8", "-1 0 0"), ("6 7 11 10", "1 0 0") };
        for (var f = 0; f < faces.Length; f++)
        {
            sb.Append("vn ").Append(faces[f].Item2).Append('\n');
            sb.Append("f ").Append(string.Join(' ', faces[f].Item1.Split(' ').Select(v => $"{v}//{f + 2}"))).Append('\n');
        }
        return sb.ToString();
    }

    private static ForgeBake Cube(int size = 96) => ForgeBake.Bake(Model, 1, size, new ForgeBake.Settings(AoRays: 0));

    private static ForgeStroke Dab(Vector3 at, double radius, float[]? view = null, double flow = 1, bool erase = false, double hardness = 0.8) =>
        new ForgeStroke { Radius = radius, Hardness = hardness, Flow = flow, Erase = erase, View = view ?? [0, -1, 0], Dabs = [at.X, at.Y, at.Z, 1, 1] }.Clamped();

    private static double Avg(ForgeBake b, float[] v, Func<Vector3, Vector3, bool> where) =>
        Enumerable.Range(0, b.Size * b.Size).Where(i => b.Covered[i] == 1 && where(b.Position[i], b.Normal[i])).Average(i => (double)v[i]);

    [Fact]
    public void A_dab_paints_round_where_it_touched_and_only_what_faces_the_painter()
    {
        var bake = Cube();
        var layer = new ForgeLayer { Mask = new ForgeMask { Kind = "none" }, Strokes = [Dab(new Vector3(0, 1, 0), 0.25)] }.Clamped();
        var v = ForgePaint.LayerMask(bake, layer, 1);
        Assert.True(Avg(bake, v, (p, n) => n.Y > 0.9f && p.X * p.X + p.Z * p.Z < 0.15f * 0.15f) > 0.95);
        Assert.True(Avg(bake, v, (p, n) => n.Y > 0.9f && MathF.Abs(p.X) > 0.4f) < 0.01);       // outside the brush
        // At the top edge, painted from above: the top, hardly the side.
        var edge = ForgePaint.LayerMask(bake, new ForgeLayer { Mask = new ForgeMask { Kind = "none" }, Strokes = [Dab(new Vector3(0.5f, 1, 0), 0.2)] }.Clamped(), 1);
        var top = Avg(bake, edge, (p, n) => n.Y > 0.9f && p.X > 0.42f && MathF.Abs(p.Z) < 0.05f);
        var side = Avg(bake, edge, (p, n) => n.X > 0.9f && p.Y > 0.92f && MathF.Abs(p.Z) < 0.05f);
        Assert.True(top > 0.8 && side < 0.15, $"top {top}, side {side}");
        // …but painted from the side, the side.
        var fromSide = ForgePaint.LayerMask(bake, new ForgeLayer { Mask = new ForgeMask { Kind = "none" }, Strokes = [Dab(new Vector3(0.5f, 0.9f, 0), 0.2, view: [-1, 0, 0])] }.Clamped(), 1);
        Assert.True(Avg(bake, fromSide, (p, n) => n.X > 0.9f && p.Y > 0.85f && MathF.Abs(p.Z) < 0.05f) > 0.8);
    }

    [Fact]
    public void Flow_builds_up_the_eraser_takes_away_and_a_fill_takes_a_whole_part()
    {
        var bake = Cube();
        bool Middle(Vector3 p, Vector3 n) => n.Y > 0.9f && p.X * p.X + p.Z * p.Z < 0.05f * 0.05f;
        var once = ForgePaint.LayerMask(bake, new ForgeLayer { Mask = new ForgeMask { Kind = "none" }, Strokes = [Dab(Vector3.UnitY, 0.25, flow: 0.5)] }.Clamped(), 1);
        var twice = ForgePaint.LayerMask(bake, new ForgeLayer { Mask = new ForgeMask { Kind = "none" }, Strokes = [Dab(Vector3.UnitY, 0.25, flow: 0.5), Dab(Vector3.UnitY, 0.25, flow: 0.5)] }.Clamped(), 1);
        Assert.InRange(Avg(bake, once, Middle), 0.47, 0.53);
        Assert.InRange(Avg(bake, twice, Middle), 0.72, 0.78);
        // The eraser takes from a smart mask too (here: everywhere).
        var erased = ForgePaint.LayerMask(bake, new ForgeLayer { Strokes = [Dab(Vector3.UnitY, 0.25, erase: true)] }.Clamped(), 1);
        Assert.True(Avg(bake, erased, Middle) < 0.02 && Avg(bake, erased, (p, n) => n.X > 0.9f) > 0.99);
        // A fill: one part whole (the floor is part 0, in its own texture set).
        var floor = ForgeBake.Bake(Model, 0, 64, new ForgeBake.Settings(AoRays: 0));
        var filled = ForgePaint.LayerMask(floor, new ForgeLayer { Mask = new ForgeMask { Kind = "none" }, Strokes = [new ForgeStroke { Part = 0 }.Clamped()] }.Clamped(), 0);
        Assert.True(Avg(floor, filled, (p, n) => true) > 0.99);
        Assert.True(Avg(bake, ForgePaint.LayerMask(bake, new ForgeLayer { Mask = new ForgeMask { Kind = "none" }, Strokes = [new ForgeStroke { Part = 0 }.Clamped()] }.Clamped(), 1), (p, n) => true) < 0.01);
    }

    [Fact]
    public void Strokes_paint_the_same_at_every_texture_size_and_into_the_textures()
    {
        var stroke = new ForgeStroke { Radius = 0.12, Hardness = 0.6, View = [0, -1, 0], Dabs = [-0.3f, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0.3f, 1, 0, 1, 1] }.Clamped();
        double Share(int size)
        {
            var b = Cube(size);
            var v = ForgePaint.LayerMask(b, new ForgeLayer { Mask = new ForgeMask { Kind = "none" }, Strokes = [stroke] }.Clamped(), 1);
            return Avg(b, v, (p, n) => n.Y > 0.9f);
        }
        var small = Share(64); var big = Share(160);
        Assert.True(small > 0.05 && Math.Abs(small - big) < small * 0.15, $"64: {small}, 160: {big}");
        // Into the textures: the paint layer's colour where painted.
        var bake = Cube();
        var tex = ForgeCompositor.Compose(Model, 1, bake, new ForgeRecipe { Layers = [new ForgeLayer { Color = "#202020" }, new ForgeLayer { Color = "#f0f0f0", Mask = new ForgeMask { Kind = "none" }, Strokes = [stroke] }] }.Clamped(), _ => null);
        double Red(Func<Vector3, Vector3, bool> where) => Enumerable.Range(0, bake.Size * bake.Size).Where(i => bake.Covered[i] == 1 && where(bake.Position[i], bake.Normal[i])).Average(i => (double)tex.BaseColor[i * 3]);
        Assert.True(Red((p, n) => n.Y > 0.9f && MathF.Abs(p.Z) < 0.04f && MathF.Abs(p.X) < 0.05f) > 200 && Red((p, n) => n.Y > 0.9f && MathF.Abs(p.Z) > 0.35f) < 60);
        Assert.True(ForgeCompositor.Mask(bake, new ForgeLayer { Mask = new ForgeMask { Kind = "none" }, Strokes = [stroke] }.Clamped(), 1).Max() > 250);
    }

    [Fact]
    public void Strokes_go_into_the_recipe_and_are_kept_in_bounds()
    {
        var r = new ForgeRecipe
        {
            Layers = [new ForgeLayer { Mask = new ForgeMask { Kind = "none" }, Strokes = [new ForgeStroke { Radius = -1, Flow = 7, View = [0, 0, 0], Dabs = [1, 2, 3, 0.5f, float.NaN, 9, 9] }] }],
        }.Clamped();
        var st = r.Layers[0].Strokes[0];
        Assert.Equal(0.0001, st.Radius);
        Assert.Equal(1, st.Flow);
        Assert.Equal([0f, 0, -1], st.View);
        Assert.Equal([1f, 2, 3, 0.5f, 0], st.Dabs); // whole dabs only, numbers made safe
        var back = ForgeRecipe.FromJson(r.ToJson());
        Assert.Equal("none", back.Layers[0].Mask.Kind);
        Assert.Equal(st.Dabs, back.Layers[0].Strokes[0].Dabs);
        var many = new ForgeLayer { Strokes = Enumerable.Range(0, ForgeLayer.MaxStrokes + 5).Select(_ => new ForgeStroke()).ToList() }.Clamped();
        Assert.Equal(ForgeLayer.MaxStrokes, many.Strokes.Count);
    }
}
