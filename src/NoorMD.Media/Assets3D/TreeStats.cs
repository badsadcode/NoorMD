using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>What a level of detail costs and how full its crown looks.</summary>
public sealed record TreeStats(
    int Triangles, int WoodTriangles, int LeafTriangles, int DrawCalls,
    /// <summary>Share of the crown's outline filled (0–1): sky seen through the crown lowers it. Null when there are no leaves.</summary>
    double? Fullness,
    /// <summary>Leaf pixels drawn per leaf pixel seen (cut-out pixels included: the GPU pays for them too).</summary>
    double? Overdraw,
    /// <summary>Share of the drawn card area that is see-through (cut out by the alpha).</summary>
    double? EmptyCardArea);

/// <summary>
/// Measures a level of detail as a game would draw it: the tree rendered from four sides at low resolution (orthographic,
/// cards cut out by their alpha). Fullness is how much of the crown's outline (row by row, between the outermost leaves)
/// is covered; overdraw counts every leaf pixel drawn, including the see-through ones, against the leaf pixels seen.
/// </summary>
public static class TreeStatsMeter
{
    private const int Views = 4;
    private const int Height = 160;

    public static TreeStats Measure(Asset3D lod)
    {
        var tris = Billboard.Triangles(lod);
        var drawCalls = lod.Root.All().Where(n => n.Mesh != null).Sum(n => n.Mesh!.Submeshes.Count(s => s.Indices.Count >= 3));
        int wood = 0, leaf = 0;
        foreach (var t in tris) { if (IsWood(t.Mat)) wood++; else leaf++; }
        if (leaf == 0 || tris.Count == 0) return new TreeStats(tris.Count, wood, leaf, drawCalls, null, null, null);

        float halfWidth = 0.1f, top = 0.1f;
        foreach (var t in tris)
            foreach (var p in new[] { t.A, t.B, t.C })
            {
                halfWidth = MathF.Max(halfWidth, MathF.Max(MathF.Abs(p.X), MathF.Abs(p.Z)));
                top = MathF.Max(top, p.Y);
            }
        var scale = Height / top;
        var width = Math.Max(8, (int)MathF.Ceiling(halfWidth * 2 * scale)) + 2;
        double spanPixels = 0, filledPixels = 0, leafSeen = 0, leafDrawn = 0, leafPassed = 0;
        var covered = new byte[width * Height];     // 0 nothing, 1 wood, 2 leaf
        for (var view = 0; view < Views; view++)
        {
            Array.Clear(covered);
            var angle = MathF.PI * view / Views;
            var right = new Vector3(MathF.Cos(angle), 0, -MathF.Sin(angle));
            Vector2 Screen(Vector3 p) => new(width / 2f + Vector3.Dot(p, right) * scale, (top - p.Y) * scale);
            foreach (var t in tris)
            {
                Vector2 a = Screen(t.A), b = Screen(t.B), c = Screen(t.C);
                var area = (b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X);
                if (MathF.Abs(area) < 1e-9f) continue;
                var isLeaf = !IsWood(t.Mat);
                int minX = Math.Max(0, (int)MathF.Floor(MathF.Min(a.X, MathF.Min(b.X, c.X)))), maxX = Math.Min(width - 1, (int)MathF.Ceiling(MathF.Max(a.X, MathF.Max(b.X, c.X))));
                int minY = Math.Max(0, (int)MathF.Floor(MathF.Min(a.Y, MathF.Min(b.Y, c.Y)))), maxY = Math.Min(Height - 1, (int)MathF.Ceiling(MathF.Max(a.Y, MathF.Max(b.Y, c.Y))));
                for (var y = minY; y <= maxY; y++)
                    for (var x = minX; x <= maxX; x++)
                    {
                        float px = x + 0.5f, py = y + 0.5f;
                        var w0 = ((b.X - px) * (c.Y - py) - (b.Y - py) * (c.X - px)) / area;
                        var w1 = ((c.X - px) * (a.Y - py) - (c.Y - py) * (a.X - px)) / area;
                        var w2 = 1 - w0 - w1;
                        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                        var pass = t.Mat.Alpha != "mask" || Billboard.Sample(t.Mat.BaseColorPixels, t.Ua * w0 + t.Ub * w1 + t.Uc * w2).W >= t.Mat.AlphaCutoff;
                        if (isLeaf)
                        {
                            // Cards have a front and a back; a GPU draws one of the two.
                            leafDrawn += 0.5;
                            if (pass) leafPassed += 0.5;
                        }
                        if (!pass) continue;
                        var i = y * width + x;
                        if (isLeaf) covered[i] = 2;
                        else if (covered[i] == 0) covered[i] = 1;
                    }
            }
            // The crown's outline: in each row with leaves, everything between the outermost leaf pixels.
            for (var y = 0; y < Height; y++)
            {
                int first = -1, last = -1;
                for (var x = 0; x < width; x++)
                    if (covered[y * width + x] == 2) { if (first < 0) first = x; last = x; }
                if (first < 0) continue;
                for (var x = first; x <= last; x++)
                {
                    spanPixels++;
                    if (covered[y * width + x] != 0) filledPixels++;
                    if (covered[y * width + x] == 2) leafSeen++;
                }
            }
        }
        return new TreeStats(tris.Count, wood, leaf, drawCalls,
            spanPixels > 0 ? filledPixels / spanPixels : null,
            leafSeen > 0 ? leafPassed / leafSeen : null,
            leafDrawn > 0 ? 1 - leafPassed / leafDrawn : null);
    }

    private static bool IsWood(Material3D m) => m.Name == "Bark";
}
