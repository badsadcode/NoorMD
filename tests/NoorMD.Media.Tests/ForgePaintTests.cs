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

    // ---------------------------------------------------------------- tips and stencils

    private static float[] Paint(ForgeBake bake, ForgeStroke stroke, ForgeRecipe? recipe = null) =>
        ForgePaint.LayerMask(bake, new ForgeLayer { Mask = new ForgeMask { Kind = "none" }, Strokes = [stroke.Clamped()] }.Clamped(), 1, recipe == null ? null : recipe.Picture);

    private static float At(ForgeBake b, float[] v, float x, float z) =>
        v[Enumerable.Range(0, b.Size * b.Size).Where(i => b.Covered[i] == 1 && b.Normal[i].Y > 0.9f).MinBy(i => MathF.Abs(b.Position[i].X - x) + MathF.Abs(b.Position[i].Z - z))];

    [Fact]
    public void A_tip_gives_the_dab_its_shape_turned_by_its_angle()
    {
        var bake = Cube(128);
        ForgeStroke Dab(string tip, double angle = 0) => new() { Radius = 0.3, View = [0, -1, 0], Tip = tip, Angle = angle, Dabs = [0, 1, 0, 1, 1] };
        // Round misses the square's corner; the square tip covers it.
        Assert.True(At(bake, Paint(bake, Dab("")), 0.24f, 0.24f) < 0.01);
        Assert.True(At(bake, Paint(bake, Dab("square")), 0.24f, 0.24f) > 0.95);
        // A picture: a tall bar. Looking down, the screen's up is −z: the bar runs along z, then along x turned 90°.
        var bar = new byte[16 * 16];
        for (var y = 0; y < 16; y++) for (var x = 6; x < 10; x++) bar[y * 16 + x] = 255;
        var recipe = new ForgeRecipe { Pictures = [ForgePicture.From("tbar", "Bar", 16, 16, bar)] }.Clamped();
        var upright = Paint(bake, Dab("tbar"), recipe);
        Assert.True(At(bake, upright, 0, -0.2f) > 0.9 && At(bake, upright, 0.2f, 0) < 0.05);
        var turned = Paint(bake, Dab("tbar", 90), recipe);
        Assert.True(At(bake, turned, 0.2f, 0) > 0.9 && At(bake, turned, 0, -0.2f) < 0.05);
        // A tip the recipe no longer has: painted round.
        Assert.Equal(Paint(bake, Dab("")), Paint(bake, Dab("tnothere")));
    }

    [Fact]
    public void Each_dab_turns_at_random_the_same_way_each_time_and_as_the_page_does()
    {
        Assert.Equal(0.18398142559453845, ForgePaint.Hash(5, 12345), 6);
        Assert.Equal(0.6490454191807657, ForgePaint.Hash(1234567, 987654321), 6);
        Assert.Equal(0.8289233199320734, ForgePaint.Hash(77, -5), 6);
        var bake = Cube(96);
        var st = new ForgeStroke { Radius = 0.2, View = [0, -1, 0], Tip = "scratches", Jitter = 1, Seed = 42, Dabs = [-0.2f, 1, 0, 1, 1, 0.2f, 1, 0, 1, 1] };
        Assert.Equal(Paint(bake, st), Paint(bake, st));
        Assert.NotEqual(Paint(bake, st), Paint(bake, new ForgeStroke { Radius = 0.2, View = [0, -1, 0], Tip = "scratches", Jitter = 1, Seed = 43, Dabs = st.Dabs }));
    }

    [Fact]
    public void A_stencil_lets_paint_through_where_it_is_white_as_it_lay_over_the_view()
    {
        var bake = Cube(128);
        // Seen straight down: u runs with x, v with z, across the cube's top (w = 1).
        float[] rows = [1, 0, 0, 0.5f, 0, 0, 1, 0.5f, 0, 0, 0, 1];
        var half = ForgePicture.From("shalf", "Half", 2, 1, [255, 0]); // white left, black right
        var recipe = new ForgeRecipe { Pictures = [half] }.Clamped();
        ForgeStroke Big(bool invert = false, bool tile = false, float[]? r = null) => new()
        {
            Radius = 0.8, Hardness = 1, View = [0, -1, 0], Dabs = [0, 1, 0, 1, 1], Stencil = new ForgeStencil { Picture = "shalf", Rows = r ?? rows, Invert = invert, Tile = tile },
        };
        var v = Paint(bake, Big(), recipe);
        Assert.True(At(bake, v, -0.35f, 0) > 0.95 && At(bake, v, 0.35f, 0) < 0.05);
        var inv = Paint(bake, Big(invert: true), recipe);
        Assert.True(At(bake, inv, -0.35f, 0) < 0.05 && At(bake, inv, 0.35f, 0) > 0.95);
        // Smaller than the top (u = 2x + 0.5): outside it nothing, unless it repeats.
        float[] small = [2, 0, 0, 0.5f, 0, 0, 2, 0.5f, 0, 0, 0, 1];
        Assert.True(At(bake, Paint(bake, Big(r: small), recipe), 0.4f, 0) < 0.05);
        Assert.True(At(bake, Paint(bake, Big(tile: true, r: small), recipe), 0.375f, 0) > 0.85); // u = 1.25 → 0.25: white, repeated
        // A stencil the recipe lost paints nothing; bad rows are dropped (no stencil).
        Assert.True(Paint(bake, Big()).Max() == 0);
        Assert.Null(new ForgeStroke { Stencil = new ForgeStencil { Picture = "shalf", Rows = [1, 2] } }.Clamped().Stencil);
    }

    [Fact]
    public void Pictures_become_tips_and_stencils_and_stay_in_the_recipe()
    {
        // Dark marks on a light page: turned around (the mark paints). Fitted into a square for a tip.
        var rgb = new float[40 * 20 * 3];
        for (var i = 0; i < 40 * 20; i++) { var dark = i % 40 is > 15 and < 25; rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = dark ? 0.05f : 0.95f; }
        var tip = ForgePicture.FromImage("t1", "Mark", 40, 20, rgb, null, 128, square: true);
        Assert.Equal((128, 128), (tip.Width, tip.Height));
        Assert.True(tip.Sample(0.5f, 0.5f) > 0.9 && tip.Sample(0.1f, 0.5f) < 0.1 && tip.Sample(0.5f, 0.1f) == 0); // the mark; its page; the padding
        // A painting's transparency is its shape; a stencil keeps its proportions.
        var alpha = Enumerable.Range(0, 40 * 20).Select(i => i % 40 < 20 ? 1f : 0f).ToArray();
        var st = ForgePicture.FromImage("s1", "Painting", 40, 20, rgb, alpha, 1024, square: false);
        Assert.Equal((40, 20), (st.Width, st.Height));
        Assert.True(st.Sample(0.2f, 0.5f) > 0.95 && st.Sample(0.8f, 0.5f) < 0.05);
        // Kept in the recipe and read back; bad ones dropped.
        var recipe = new ForgeRecipe { Pictures = [tip, st, new ForgePicture { Id = "../x", Width = 2, Height = 2, Data = "AAAA" }, new ForgePicture { Id = "big", Width = 5000, Height = 1 }] }.Clamped();
        Assert.Equal(["t1", "s1"], recipe.Pictures.Select(p => p.Id));
        var back = ForgeRecipe.FromJson(recipe.ToJson());
        Assert.Equal(tip.Gray, back.Picture("t1")!.Gray);
        Assert.Equal("Painting", back.Picture("s1")!.Name);
        Assert.Contains("\"seed\"", new ForgeRecipe { Layers = [new ForgeLayer { Strokes = [new ForgeStroke { Tip = "chalk" }] }] }.Clamped().ToJson());
        // NoorForge's own tips are drawn the same each time.
        Assert.Equal(ForgeTips.Get("splatter")!.Gray, ForgeTips.Get("splatter")!.Gray);
        Assert.All(ForgeTips.All, t => Assert.True(ForgeTips.Get(t.Id)!.Gray.Count(b => b > 128) > 200, t.Id));
    }
}
