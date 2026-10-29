using System.Numerics;

namespace NoorMD.Media.Forge;

/// <summary>
/// A mask on the model as a grid of little boxes in space (each keeping the most of the texels in it, so a thin edge
/// isn't averaged away), so it can be grown, blurred and looked up anywhere on the model — across UV seams and charts,
/// which a blur in the texture would cut.
/// </summary>
public sealed class ForgeVoxels
{
    private readonly Vector3 _min;
    private readonly float _cell;
    private readonly int _nx, _ny, _nz;
    private float[] _value;   // the average in each box
    private float[] _weight;  // how much of the model is in it (0 where there's none)

    public ForgeVoxels(ForgeBake bake, float[] values, float cell)
    {
        var span = bake.BoundsMax - bake.BoundsMin;
        _cell = MathF.Max(cell, MathF.Max(span.X, MathF.Max(span.Y, span.Z)) / 160);
        _min = bake.BoundsMin - new Vector3(_cell);
        _nx = (int)(span.X / _cell) + 3; _ny = (int)(span.Y / _cell) + 3; _nz = (int)(span.Z / _cell) + 3;
        _value = new float[_nx * _ny * _nz]; _weight = new float[_value.Length];
        for (var i = 0; i < values.Length; i++)
        {
            if (bake.Covered[i] == 0) continue;
            var c = Index(bake.Position[i]);
            _value[c] = MathF.Max(_value[c], values[i]); _weight[c] = 1;
        }
    }

    private int Index(Vector3 p)
    {
        int x = Math.Clamp((int)((p.X - _min.X) / _cell), 0, _nx - 1), y = Math.Clamp((int)((p.Y - _min.Y) / _cell), 0, _ny - 1), z = Math.Clamp((int)((p.Z - _min.Z) / _cell), 0, _nz - 1);
        return (z * _ny + y) * _nx + x;
    }

    /// <summary>Blurs the mask over a distance in metres (three box passes along each axis; empty boxes don't count).</summary>
    public ForgeVoxels Blur(float metres)
    {
        var r = (int)MathF.Round(metres / _cell / 2);
        if (r < 1) return this;
        for (var pass = 0; pass < 3; pass++)
            for (var axis = 0; axis < 3; axis++)
            {
                var v = new float[_value.Length]; var w = new float[_value.Length];
                int len = axis == 0 ? _nx : axis == 1 ? _ny : _nz, stride = axis == 0 ? 1 : axis == 1 ? _nx : _nx * _ny;
                for (var c = 0; c < _value.Length; c++)
                {
                    var pos = c / stride % len;
                    float sv = 0, sw = 0;
                    for (var k = Math.Max(0, pos - r); k <= Math.Min(len - 1, pos + r); k++) { var j = c + (k - pos) * stride; sv += _value[j] * _weight[j]; sw += _weight[j]; }
                    v[c] = sw > 0 ? sv / sw : 0; w[c] = sw > 0 ? 1 : 0;
                }
                _value = v; _weight = w;
            }
        return this;
    }

    /// <summary>The mask at a point (trilinear between the boxes that hold some of the model; 0 away from it).</summary>
    public float At(Vector3 p)
    {
        var f = (p - _min) / _cell - new Vector3(0.5f);
        int x0 = (int)MathF.Floor(f.X), y0 = (int)MathF.Floor(f.Y), z0 = (int)MathF.Floor(f.Z);
        float ax = f.X - x0, ay = f.Y - y0, az = f.Z - z0, sv = 0, sw = 0;
        for (var k = 0; k < 8; k++)
        {
            int x = x0 + (k & 1), y = y0 + ((k >> 1) & 1), z = z0 + (k >> 2);
            if (x < 0 || y < 0 || z < 0 || x >= _nx || y >= _ny || z >= _nz) continue;
            var c = (z * _ny + y) * _nx + x;
            if (_weight[c] <= 0) continue;
            var w = ((k & 1) == 1 ? ax : 1 - ax) * (((k >> 1) & 1) == 1 ? ay : 1 - ay) * ((k >> 2) == 1 ? az : 1 - az);
            sv += _value[c] * w; sw += w;
        }
        return sw > 1e-6f ? sv / sw : 0;
    }
}

/// <summary>The smart masks that need the whole model at once: another layer's mask spread, and drips running down.</summary>
public static class ForgeMasks
{
    /// <summary>
    /// Another layer's mask (or where it isn't), spread (grown and softened) over a distance on the model, per texel;
    /// with ring, only the spread around it (a rim), not the mask itself.
    /// </summary>
    public static float[] Follow(ForgeBake bake, float[] anchor, ForgeMask mask)
    {
        var src = mask.Invert ? anchor.Select((v, i) => bake.Covered[i] == 0 ? 0 : 1 - v).ToArray() : anchor;
        var metres = (float)mask.Spread;
        if (metres <= 0) return mask.Ring ? new float[src.Length] : src;
        var grid = new ForgeVoxels(bake, src, metres / 3).Blur(metres);
        var outV = new float[src.Length];
        Parallel.For(0, outV.Length, i =>
        {
            if (bake.Covered[i] == 0) return;
            var spread = MathF.Max(src[i], Math.Clamp(grid.At(bake.Position[i]) * 2, 0, 1));
            outV[i] = mask.Ring ? Math.Clamp(spread - src[i], 0, 1) : spread;
        });
        return outV;
    }

    /// <summary>
    /// Drips: what is above each point (a source mask: worn top edges, or another layer's) running down over a length,
    /// fading as it goes, in streaks (narrow across, long down) on the sides of the model.
    /// </summary>
    public static float[] Drips(ForgeBake bake, float[]? source, ForgeMask mask)
    {
        var n = bake.Covered.Length;
        var src = source ?? Enumerable.Range(0, n).Select(i => bake.Covered[i] == 0 ? 0 : Math.Clamp(bake.Curvature[i] * 1.5f, 0, 1) * (bake.Normal[i].Y > -0.2f ? 1 : 0)).ToArray();
        var length = (float)Math.Max(0.01, mask.Length);
        var grid = new ForgeVoxels(bake, src, length / 10);
        var width = (float)mask.NoiseScale;
        var outV = new float[n];
        Parallel.For(0, n, i =>
        {
            if (bake.Covered[i] == 0) return;
            var p = bake.Position[i];
            var best = src[i];
            for (var k = 1; k <= 10; k++)
            {
                var d = length * k / 10;
                best = MathF.Max(best, grid.At(p + new Vector3(0, d, 0)) * (1 - 0.8f * k / 10));
            }
            // Streaks: noise stretched down the model, narrow across.
            var streak = ForgeCompositor.Fbm(new Vector3(p.X / width, p.Y / (width * 10), p.Z / width));
            var s = Smooth(0.35f, 0.65f, streak);
            var side = 1 - MathF.Abs(bake.Normal[i].Y) * 0.7f;
            outV[i] = best * (1 + ((float)mask.Noise) * (s - 1)) * side;
        });
        return outV;
    }

    /// <summary>Chips: worn edges broken into chunks (cells of a few centimetres, each in or out).</summary>
    public static float Chips(ForgeBake bake, int i, ForgeMask mask)
    {
        var p = bake.Position[i] / (float)mask.NoiseScale;
        // Ragged cells: the point moved about by noise first, so chips don't have straight sides.
        p += new Vector3(ForgeCompositor.Fbm(p * 1.7f) - 0.5f, ForgeCompositor.Fbm(p * 1.7f + new Vector3(5.2f, 1.3f, 7.7f)) - 0.5f, ForgeCompositor.Fbm(p * 1.7f + new Vector3(9.1f, 4.4f, 2.6f)) - 0.5f) * 1.2f;
        var cell = Cell(p);
        // The worn-edge value, pushed out or in by a whole cell at a time (so the border goes in lumps), near edges only.
        var edge = Math.Clamp(bake.Curvature[i], 0, 1);
        return edge + (cell - 0.5f) * (float)Math.Max(0.15, mask.Noise) * Smooth(0.03f, 0.3f, edge);
    }

    /// <summary>A value 0–1 that is the same across each Voronoi cell (the nearest of one random point in each box).</summary>
    private static float Cell(Vector3 p)
    {
        int bx = (int)MathF.Floor(p.X), by = (int)MathF.Floor(p.Y), bz = (int)MathF.Floor(p.Z);
        var best = float.MaxValue; var value = 0f;
        for (var dz = -1; dz <= 1; dz++)
            for (var dy = -1; dy <= 1; dy++)
                for (var dx = -1; dx <= 1; dx++)
                {
                    int x = bx + dx, y = by + dy, z = bz + dz;
                    var h = Hash3(x, y, z);
                    var point = new Vector3(x + Frac(h * 13.1f), y + Frac(h * 71.7f), z + Frac(h * 37.3f));
                    var d = Vector3.DistanceSquared(point, p);
                    if (d < best) { best = d; value = Frac(h * 5.3f); }
                }
        return value;
    }

    private static float Frac(float v) => v - MathF.Floor(v);

    private static float Hash3(int x, int y, int z)
    {
        var h = unchecked((uint)(x * 374761393 + y * 668265263 + z * 1274126177));
        h = unchecked((h ^ (h >> 13)) * 1274126177u);
        return ((h ^ (h >> 16)) & 0xFFFFFF) / (float)0xFFFFFF;
    }

    private static float Smooth(float e0, float e1, float x) { var t = Math.Clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
}
