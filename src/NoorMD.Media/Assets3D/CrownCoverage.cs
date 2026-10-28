using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// The crown drawn from four sides at low resolution (orthographic, leaf cards cut out by their alpha), the way the
/// fullness under the preview is measured: in each row, everything between the outermost leaf pixels is the crown,
/// and the pixels there that nothing covers are gaps (sky through the crown). Cards can be added and drawn in one at a
/// time, and a spot scored by how many gaps a card there would cover.
/// </summary>
internal sealed class CrownCoverage
{
    private const int Views = 4;
    private readonly int width, height;
    private readonly float scale, top;
    private readonly Vector3[] rights = new Vector3[Views];
    private readonly byte[][] cover = new byte[Views][];    // 0 nothing, 1 wood, 2 leaf
    private readonly bool[][] gap = new bool[Views][];

    public CrownCoverage(float halfWidth, float top, int height = 128)
    {
        this.height = height;
        this.top = top;
        scale = height / MathF.Max(0.1f, top);
        width = Math.Max(8, (int)MathF.Ceiling(halfWidth * 2 * scale)) + 2;
        for (var v = 0; v < Views; v++)
        {
            var angle = MathF.PI * v / Views;
            rights[v] = new Vector3(MathF.Cos(angle), 0, -MathF.Sin(angle));
            cover[v] = new byte[width * height];
            gap[v] = new bool[width * height];
        }
    }

    private Vector2 Screen(int view, Vector3 p) => new(width / 2f + Vector3.Dot(p, rights[view]) * scale, (top - p.Y) * scale);

    /// <summary>Draws a triangle into every view; with a picture, only where its alpha passes the cutoff.</summary>
    public void Draw(Vector3 pa, Vector3 pb, Vector3 pc, Vector2 ua, Vector2 ub, Vector2 uc, RawImage? alpha, float cutoff, bool leaf)
    {
        for (var view = 0; view < Views; view++)
        {
            Vector2 a = Screen(view, pa), b = Screen(view, pb), c = Screen(view, pc);
            var area = (b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X);
            if (MathF.Abs(area) < 1e-9f) continue;
            int minX = Math.Max(0, (int)MathF.Floor(MathF.Min(a.X, MathF.Min(b.X, c.X)))), maxX = Math.Min(width - 1, (int)MathF.Ceiling(MathF.Max(a.X, MathF.Max(b.X, c.X))));
            int minY = Math.Max(0, (int)MathF.Floor(MathF.Min(a.Y, MathF.Min(b.Y, c.Y)))), maxY = Math.Min(height - 1, (int)MathF.Ceiling(MathF.Max(a.Y, MathF.Max(b.Y, c.Y))));
            var px = cover[view];
            for (var y = minY; y <= maxY; y++)
                for (var x = minX; x <= maxX; x++)
                {
                    float fx = x + 0.5f, fy = y + 0.5f;
                    var w0 = ((b.X - fx) * (c.Y - fy) - (b.Y - fy) * (c.X - fx)) / area;
                    var w1 = ((c.X - fx) * (a.Y - fy) - (c.Y - fy) * (a.X - fx)) / area;
                    var w2 = 1 - w0 - w1;
                    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    if (alpha != null && Billboard.Sample(alpha, ua * w0 + ub * w1 + uc * w2).W < cutoff) continue;
                    var i = y * width + x;
                    if (leaf) px[i] = 2;
                    else if (px[i] == 0) px[i] = 1;
                }
        }
    }

    /// <summary>Finds the gaps again and returns how full the crown is (0–1).</summary>
    public double Refresh()
    {
        double span = 0, filled = 0;
        for (var view = 0; view < Views; view++)
        {
            var px = cover[view];
            var g = gap[view];
            Array.Clear(g);
            for (var y = 0; y < height; y++)
            {
                int first = -1, last = -1;
                for (var x = 0; x < width; x++)
                    if (px[y * width + x] == 2) { if (first < 0) first = x; last = x; }
                if (first < 0) continue;
                for (var x = first; x <= last; x++)
                {
                    span++;
                    if (px[y * width + x] != 0) filled++;
                    else g[y * width + x] = true;
                }
            }
        }
        return span > 0 ? filled / span : 1;
    }

    /// <summary>How many gaps (sampled in a 3 × 3 pattern in each view) a card of this radius centred here would cover.</summary>
    public int Score(Vector3 centre, float radius)
    {
        var r = radius * scale * 0.6f;
        var score = 0;
        for (var view = 0; view < Views; view++)
        {
            var c = Screen(view, centre);
            var g = gap[view];
            for (var dy = -1; dy <= 1; dy++)
                for (var dx = -1; dx <= 1; dx++)
                {
                    int x = (int)(c.X + dx * r), y = (int)(c.Y + dy * r);
                    if (x >= 0 && y >= 0 && x < width && y < height && g[y * width + x]) score++;
                }
        }
        return score;
    }
}
