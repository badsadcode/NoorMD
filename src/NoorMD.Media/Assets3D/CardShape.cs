using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// Leaf cards cut to their leaves: for a sprite (an atlas cell, or a whole picture), the convex outline of its opaque
/// pixels, cut down to a few corners while still holding every leaf. A card drawn as that outline instead of a rectangle
/// draws far fewer see-through pixels (which the GPU pays for) for the same triangles.
/// </summary>
public static class CardShape
{
    /// <summary>
    /// The outline of the sprite in the UV rectangle <paramref name="cell"/> (u0, v0, u1, v1) of <paramref name="img"/>:
    /// up to <paramref name="corners"/> points in the cell's own 0–1 coordinates (u across, v down), counter-clockwise as
    /// seen with v up. Null when the sprite is (nearly) empty.
    /// </summary>
    public static Vector2[]? Outline(RawImage img, Vector4 cell, int corners = 6, byte alphaCut = 64)
    {
        int x0 = (int)(cell.X * img.Width), y0 = (int)(cell.Y * img.Height), x1 = (int)(cell.Z * img.Width), y1 = (int)(cell.W * img.Height);
        int w = x1 - x0, h = y1 - y0;
        if (w < 2 || h < 2) return null;
        // Each opaque pixel's corners (so thin stems are held too), in cell coordinates.
        var points = new List<Vector2>();
        for (var y = y0; y < y1; y++)
        {
            int first = -1, last = -1;
            for (var x = x0; x < x1; x++)
                if (img.Rgba[(y * img.Width + x) * 4 + 3] >= alphaCut) { if (first < 0) first = x; last = x; }
            if (first < 0) continue;
            float v0 = (y - y0) / (float)h, v1 = (y + 1 - y0) / (float)h;
            points.Add(new((first - x0) / (float)w, v0)); points.Add(new((first - x0) / (float)w, v1));
            points.Add(new((last + 1 - x0) / (float)w, v0)); points.Add(new((last + 1 - x0) / (float)w, v1));
        }
        if (points.Count < 3) return null;
        var hull = Hull(points);
        if (hull.Count < 3) return null;
        // Without corners that lie on a straight edge (they would make empty triangles); the clamp only tidies
        // rounding at the cell's border.
        var poly = Reduce(hull, Math.Max(3, corners)).Select(p => Vector2.Clamp(p, Vector2.Zero, Vector2.One)).ToList();
        for (var changed = true; changed && poly.Count > 3;)
        {
            changed = false;
            for (var i = 0; i < poly.Count && poly.Count > 3; i++)
            {
                Vector2 a = poly[(i - 1 + poly.Count) % poly.Count], b = poly[i], c = poly[(i + 1) % poly.Count];
                if (MathF.Abs((b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X)) < 1e-5f) { poly.RemoveAt(i); changed = true; break; }
            }
        }
        return poly.Count >= 3 ? poly.ToArray() : null;
    }

    /// <summary>The convex hull (monotone chain), counter-clockwise with v pointing up (clockwise in image rows).</summary>
    private static List<Vector2> Hull(List<Vector2> pts)
    {
        var p = pts.Distinct().OrderBy(a => a.X).ThenBy(a => a.Y).ToList();
        if (p.Count < 3) return p;
        static float Cross(Vector2 o, Vector2 a, Vector2 b) => (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X);
        var hull = new List<Vector2>();
        foreach (var pass in new[] { p, Enumerable.Reverse(p).ToList() })
        {
            var start = hull.Count;
            foreach (var q in pass)
            {
                while (hull.Count >= start + 2 && Cross(hull[^2], hull[^1], q) <= 0) hull.RemoveAt(hull.Count - 1);
                hull.Add(q);
            }
            hull.RemoveAt(hull.Count - 1);
        }
        return hull;
    }

    /// <summary>
    /// Fewer corners, still enclosing everything: an edge is replaced by the point where its neighbours' lines meet,
    /// always the one adding the least area, until <paramref name="corners"/> are left.
    /// </summary>
    private static List<Vector2> Reduce(List<Vector2> hull, int corners)
    {
        var poly = new List<Vector2>(hull);
        while (poly.Count > corners)
        {
            int best = -1;
            var bestArea = float.MaxValue;
            var bestPoint = Vector2.Zero;
            for (var i = 0; i < poly.Count; i++)
            {
                Vector2 a = poly[(i - 1 + poly.Count) % poly.Count], b = poly[i], c = poly[(i + 1) % poly.Count], d = poly[(i + 2) % poly.Count];
                if (!Meet(a, b, c, d, out var m)) continue;
                // The triangle b–m–c is what the polygon grows by.
                var area = MathF.Abs((m.X - b.X) * (c.Y - b.Y) - (m.Y - b.Y) * (c.X - b.X)) / 2;
                if (area < bestArea) { bestArea = area; best = i; bestPoint = m; }
            }
            if (best < 0) break;
            poly[best] = bestPoint;
            poly.RemoveAt((best + 1) % poly.Count);
        }
        return poly;
    }

    /// <summary>Where the line a→b, carried on past b, meets the line d→c, carried on past c (both going forward).</summary>
    private static bool Meet(Vector2 a, Vector2 b, Vector2 c, Vector2 d, out Vector2 m)
    {
        m = default;
        var r = b - a;
        var s = c - d;
        var den = r.X * s.Y - r.Y * s.X;
        if (MathF.Abs(den) < 1e-9f) return false;
        var t = ((d.X - a.X) * s.Y - (d.Y - a.Y) * s.X) / den;
        var u = ((d.X - a.X) * r.Y - (d.Y - a.Y) * r.X) / den;
        if (t < 1 || u < 1) return false;      // the lines would meet behind the edge: no enclosing corner there
        m = a + r * t;
        // Only inside the sprite's cell: a corner outside would sample the next sprite (and clamping it back would
        // cut leaves off).
        return m.X is >= -1e-4f and <= 1 + 1e-4f && m.Y is >= -1e-4f and <= 1 + 1e-4f;
    }
}
