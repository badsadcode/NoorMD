using System.Numerics;
using NoorMD.Media;
using NoorMD.Media.Forge;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>NoorForge image paint layers: pixels painted straight onto the model (as Blender's texture painting).</summary>
public class ForgeImageTests
{
    private static readonly ForgeModel Model = ForgeModel.ReadObj(ForgeModelTests.CubeOnFloor(), "Test");
    private const int Size = 256;
    private static readonly ForgeBake Paint = ForgeBake.Bake(Model, 1, Size, new ForgeBake.Settings(AoRays: 0));

    private static ForgeStroke Dab(Vector3 at, string? color, double radius = 0.15, bool erase = false) =>
        new ForgeStroke { Radius = radius, Hardness = 0.9, View = [0, -1, 0], Dabs = [at.X, at.Y, at.Z, 1, 1], Color = color, Erase = erase }.Clamped();

    /// <summary>The picture's colour and alpha at the texel of a bake nearest a point on the top of the cube.</summary>
    private static (byte R, byte G, byte B, byte A) At(byte[] px, ForgeBake b, Vector3 p)
    {
        var best = -1; var d = float.MaxValue;
        for (var i = 0; i < b.Size * b.Size; i++)
            if (b.Covered[i] == 1 && b.Normal[i].Y > 0.9f && (b.Position[i] - p).LengthSquared() is var dd && dd < d) { d = dd; best = i; }
        return (px[best * 4], px[best * 4 + 1], px[best * 4 + 2], px[best * 4 + 3]);
    }

    private static readonly Vector3 A = new(-0.25f, 1, 0), B2 = new(0.25f, 1, 0);

    [Fact]
    public void Paint_goes_into_the_pixels_and_keeps_its_colour_when_the_brush_colour_changes()
    {
        var store = new ForgeImageStore();
        var blank = store.Create(Size, ForgeImageStore.Blank(Size, Model.Sets.Count));
        var red = ForgeImagePaint.Apply(store, blank, 1, Paint, Dab(A, "#ff0000"), "#808080");
        var both = ForgeImagePaint.Apply(store, red, 1, Paint, Dab(B2, "#0000ff"), "#808080");
        var px = store.Get(both)!.Value.Pixels[1];
        Assert.Equal((255, 0, 0, 255), ((int)At(px, Paint, A).R, (int)At(px, Paint, A).G, (int)At(px, Paint, A).B, (int)At(px, Paint, A).A)); // still red
        Assert.Equal((0, 0, 255), ((int)At(px, Paint, B2).R, (int)At(px, Paint, B2).G, (int)At(px, Paint, B2).B));
        Assert.Equal(0, At(px, Paint, new Vector3(0, 1, 0.45f)).A); // nothing painted there
        Assert.All(store.Get(both)!.Value.Pixels[0], v => Assert.Equal(0, v)); // the floor's set: untouched (the brush didn't reach it)
    }

    [Fact]
    public void A_blend_mode_mixes_with_what_is_painted_and_paints_bare_texels_plainly()
    {
        var store = new ForgeImageStore();
        var blank = store.Create(Size, ForgeImageStore.Blank(Size, Model.Sets.Count));
        var red = ForgeImagePaint.Apply(store, blank, 1, Paint, Dab(A, "#ff0000"), "#808080");
        var mul = Dab(A, "#808080"); mul.Blend = "multiply"; mul.Dabs = [A.X, A.Y, A.Z, 1, 1, B2.X, B2.Y, B2.Z, 1, 1];
        var px = store.Get(ForgeImagePaint.Apply(store, red, 1, Paint, mul.Clamped(), "#808080"))!.Value.Pixels[1];
        Assert.InRange((int)At(px, Paint, A).R, 126, 130); Assert.Equal(0, At(px, Paint, A).G); // red × grey: darker red
        Assert.InRange((int)At(px, Paint, B2).R, 126, 130); Assert.InRange((int)At(px, Paint, B2).G, 126, 130); // nothing there: the grey itself
    }

    [Fact]
    public void Each_version_stays_so_undo_and_redo_work_and_the_eraser_takes_paint_away()
    {
        var store = new ForgeImageStore();
        var v0 = store.Create(Size, ForgeImageStore.Blank(Size, Model.Sets.Count));
        var v1 = ForgeImagePaint.Apply(store, v0, 1, Paint, Dab(A, "#ff0000"), "#808080");
        var v2 = ForgeImagePaint.Apply(store, v1, 1, Paint, Dab(B2, "#00ff00"), "#808080");
        var v3 = ForgeImagePaint.Apply(store, v2, 1, Paint, Dab(A, null, erase: true), "#808080");
        byte Alpha(string v, Vector3 p) => At(store.Get(v)!.Value.Pixels[1], Paint, p).A;
        Assert.Equal((0, 0), (Alpha(v0, A), Alpha(v0, B2)));
        Assert.Equal((255, 0), (Alpha(v1, A), Alpha(v1, B2)));
        Assert.Equal((255, 255), (Alpha(v2, A), Alpha(v2, B2)));
        Assert.Equal((0, 255), (Alpha(v3, A), Alpha(v3, B2)));
        // Back and forth (undo, redo), and a new branch from an older version.
        Assert.Equal(255, Alpha(v1, A)); Assert.Equal(0, Alpha(v3, A)); Assert.Equal(0, Alpha(v0, A));
        var branch = ForgeImagePaint.Apply(store, v1, 1, Paint, Dab(B2, "#0000ff"), "#808080");
        Assert.Equal(255, At(store.Get(branch)!.Value.Pixels[1], Paint, B2).B);
        Assert.Equal(255, At(store.Get(v2)!.Value.Pixels[1], Paint, B2).G); // the old branch is still there
    }

    [Fact]
    public void The_painting_shows_in_the_textures_at_any_size_over_the_layers_below()
    {
        var store = new ForgeImageStore();
        var image = ForgeImagePaint.Apply(store, store.Create(Size, ForgeImageStore.Blank(Size, Model.Sets.Count)), 1, Paint, Dab(A, "#ff0000"), "#808080");
        var recipe = new ForgeRecipe
        {
            Layers = [new ForgeLayer { Id = "base", Color = "#404040" }, new ForgeLayer { Id = "paint", Image = image, ImageSize = Size, UseRoughness = false, UseMetallic = false, UseHeight = false, UseNormal = false }],
        }.Clamped();
        foreach (var size in new[] { 128, 512 })
        {
            var bake = ForgeBake.Bake(Model, 1, size, new ForgeBake.Settings(AoRays: 0));
            var tex = ForgeCompositor.Compose(Model, 1, bake, recipe, _ => null, store.Get);
            var rgb = new byte[tex.BaseColor.Length / 3 * 4];
            for (var i = 0; i < tex.BaseColor.Length / 3; i++) { rgb[i * 4] = tex.BaseColor[i * 3]; rgb[i * 4 + 1] = tex.BaseColor[i * 3 + 1]; rgb[i * 4 + 2] = tex.BaseColor[i * 3 + 2]; }
            var painted = At(rgb, bake, A); var bare = At(rgb, bake, B2);
            Assert.True(painted.R > 240 && painted.G < 15, $"{size}: painted {painted}");
            Assert.InRange(bare.R, 0x3e, 0x42); // the layer below shows where nothing is painted
        }
        // An unknown painting (after NoorMD closed) shows nothing rather than failing.
        var lost = new ForgeRecipe { Layers = [new ForgeLayer { Color = "#404040" }, new ForgeLayer { Image = "igone" }] }.Clamped();
        Assert.NotNull(ForgeCompositor.Compose(Model, 1, Paint, lost, _ => null, store.Get));
    }

    [Fact]
    public void A_stroke_layer_keeps_each_strokes_colour_and_old_strokes_follow_the_layer()
    {
        var layer = new ForgeLayer { Color = "#00ff00", Mask = new ForgeMask { Kind = "none" }, Strokes = [Dab(A, "#ff0000"), Dab(B2, null)] }.Clamped();
        var recipe = new ForgeRecipe { Layers = [layer] }.Clamped();
        var tex = ForgeCompositor.Compose(Model, 1, Paint, recipe, _ => null);
        var rgb = new byte[tex.BaseColor.Length / 3 * 4];
        for (var i = 0; i < tex.BaseColor.Length / 3; i++) { rgb[i * 4] = tex.BaseColor[i * 3]; rgb[i * 4 + 1] = tex.BaseColor[i * 3 + 1]; rgb[i * 4 + 2] = tex.BaseColor[i * 3 + 2]; }
        Assert.True(At(rgb, Paint, A).R > 240 && At(rgb, Paint, A).G < 15);   // its own colour, not the layer's
        Assert.True(At(rgb, Paint, B2).G > 240 && At(rgb, Paint, B2).R < 15); // no colour of its own: the layer's
    }

    [Fact]
    public void A_glb_brings_its_colour_picture_and_recipes_keep_image_layers()
    {
        var sets = Enumerable.Range(0, Model.Sets.Count).Select(s => ForgeCompositor.Compose(Model, s, ForgeBake.Bake(Model, s, 64, new ForgeBake.Settings(AoRays: 0)), new ForgeRecipe { Layers = [new ForgeLayer { Color = "#806040" }] }.Clamped(), _ => null)).ToList();
        var back = ForgeModel.ReadGlb(ForgeExport.Glb(Model, sets), "Back");
        Assert.All(back.Sets, s => Assert.True(s.ColorTexture is { Length: > 8 } t && t[1] == 'P' && t[2] == 'N' && t[3] == 'G'));
        Assert.Null(Model.Sets[0].ColorTexture); // an OBJ: none
        var r = ForgeRecipe.FromJson(new ForgeRecipe { Layers = [new ForgeLayer { Image = "iabc123", ImageSize = 9999, ImageFiles = ["ok.png", "../bad.png", "C:\\x.png"] }] }.ToJson());
        Assert.Equal(("iabc123", ForgeImageStore.MaxSize), (r.Layers[0].Image, r.Layers[0].ImageSize));
        Assert.Equal(["ok.png"], r.Layers[0].ImageFiles);
    }
}
