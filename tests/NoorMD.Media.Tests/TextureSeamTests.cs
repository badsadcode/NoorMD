using NoorMD.Media;
using Xunit;

namespace NoorMD.Media.Tests;

/// <summary>Pictures that don't tile made to tile: stitched along the least-different line (no see-through doubles),
/// or faded (the soft way); a slope of light across the picture evened out so the edges match.</summary>
public class TextureSeamTests
{
    private const int N = 128;

    /// <summary>Black and white blobs that don't continue across the edges (a stand-in for stones in a photo).</summary>
    private static TextureImage Blobs(int W = N, int H = N)
    {
        var rgb = new float[W * H * 3];
        var rnd = new Random(5);
        var centres = Enumerable.Range(0, 40).Select(_ => (X: rnd.NextDouble() * W, Y: rnd.NextDouble() * H, R: 5 + rnd.NextDouble() * 9)).ToArray();
        for (var y = 0; y < H; y++)
            for (var x = 0; x < W; x++)
            {
                var on = centres.Any(c => (x - c.X) * (x - c.X) + (y - c.Y) * (y - c.Y) < c.R * c.R); // no wrap: the edges don't meet
                var v = on ? 0.9f : 0.1f;
                for (var c = 0; c < 3; c++) rgb[(y * W + x) * 3 + c] = v;
            }
        return new TextureImage { Width = W, Height = H, Rgb = rgb, Id = $"blobs{W}x{H}" };
    }

    private static TextureMaps Render(TextureImage img, string mode, double width, double even = 0)
    {
        var r = new TextureRecipe { Name = "t", Layers = [new TextureLayer { Id = "L1", Type = "image", Path = "p", ImageName = "p.png", ScaleX = 1, ScaleY = 1, HandPainted = true, SeamBlend = width, SeamMode = mode, SeamEven = even, ColorAmount = 1, Opacity = 1 }] };
        r.Surface.Dirt = 0; r.Surface.ColorVariation = 0;
        return TextureEngine.Render(r.Clamped(), N, _ => img);
    }

    /// <summary>How much the picture jumps across its edges, against the average jump between neighbours inside it.</summary>
    private static double SeamRatio(byte[] rgb)
    {
        double V(int x, int y) => rgb[(y * N + x) * 3];
        double across = 0, inside = 0;
        for (var i = 0; i < N; i++) across += Math.Abs(V(N - 1, i) - V(0, i)) + Math.Abs(V(i, N - 1) - V(i, 0));
        for (var y = 0; y < N; y++)
            for (var x = 0; x + 1 < N; x++) inside += Math.Abs(V(x + 1, y) - V(x, y)) + Math.Abs(V(y, x + 1) - V(y, x)); // across and down
        return (across / (2.0 * N)) / Math.Max(1e-6, inside / (2.0 * N * (N - 1)));
    }

    [Fact]
    public void Smart_cut_makes_a_picture_tile_without_see_through_doubles()
    {
        var img = Blobs();
        var raw = Render(img, "cut", 0);
        var cut = Render(img, "cut", 0.2);
        var blend = Render(img, "blend", 0.2);
        Assert.True(SeamRatio(raw.Albedo) > 3, $"the picture doesn't tile as it is ({SeamRatio(raw.Albedo):0.0})");
        Assert.True(SeamRatio(cut.Albedo) < 1.6, $"cut: {SeamRatio(cut.Albedo):0.00} (as it is {SeamRatio(raw.Albedo):0.0})");
        // Each pixel comes from one place: nearly all stay black or white; the fade mixes many into greys.
        int Greys(byte[] a) => Enumerable.Range(0, N * N).Count(i => a[i * 3] is > 60 and < 195);
        Assert.True(Greys(cut.Albedo) < N * N / 25, $"cut greys {Greys(cut.Albedo)}");
        Assert.True(Greys(blend.Albedo) > Greys(cut.Albedo) * 2, $"blend greys {Greys(blend.Albedo)} vs cut {Greys(cut.Albedo)}");
        // The middle of the picture (away from the edges) is left as it was (give or take the gentle evening of the
        // small steps, spread over the whole tile): the framing is kept.
        Assert.InRange(cut.Albedo[(N / 2 * N + N / 2) * 3] - raw.Albedo[(N / 2 * N + N / 2) * 3], -8, 8);
    }

    [Fact]
    public void Pictures_of_any_size_are_stitched()
    {
        // 120 × 90: neither side a power of two (the smoothing of small steps then takes the longer way round).
        var img = Blobs(120, 90);
        var raw = Render(img, "cut", 0);
        var cut = Render(img, "cut", 0.2);
        Assert.True(SeamRatio(raw.Albedo) > 3);
        Assert.True(SeamRatio(cut.Albedo) < 1.6, $"cut: {SeamRatio(cut.Albedo):0.00}");
    }

    [Fact]
    public void A_slope_of_light_is_evened_out_so_opposite_edges_match()
    {
        // Lighter on the left, darker on the right, with a little texture.
        var rgb = new float[N * N * 3]; var rnd = new Random(2);
        for (var y = 0; y < N; y++)
            for (var x = 0; x < N; x++) { var v = (float)(0.8 - 0.5 * x / (N - 1.0) + rnd.NextDouble() * 0.06); for (var c = 0; c < 3; c++) rgb[(y * N + x) * 3 + c] = v; }
        var img = new TextureImage { Width = N, Height = N, Rgb = rgb, Id = "slope" };
        double EdgeGap(TextureMaps m) => Enumerable.Range(0, N).Average(y => (double)m.Albedo[(y * N) * 3] - m.Albedo[(y * N + N - 1) * 3]);
        Assert.True(EdgeGap(Render(img, "cut", 0)) > 100);
        Assert.InRange(EdgeGap(Render(img, "cut", 0, even: 1)), -12, 12);
    }

    [Fact]
    public void Old_recipes_keep_the_soft_fade_and_unknown_modes_fall_back_to_it()
    {
        var json = new TextureRecipe { Layers = [new TextureLayer { Id = "L", Type = "image" }] }.ToJson().Replace("\"seamMode\": \"blend\",", "");
        Assert.Equal("blend", TextureRecipe.FromJson(json).Layers[0].SeamMode);
        var r = new TextureRecipe { Layers = [new TextureLayer { Id = "L", Type = "image", SeamMode = "quilt" }] }.Clamped();
        Assert.Equal("blend", r.Layers[0].SeamMode);
    }
}
