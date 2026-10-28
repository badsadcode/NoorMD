using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// One tapered limb of an implicit shape: a cone between two spheres (radius Ra at A, Rb at B). Blend is how far (in
/// metres) it melts into the shapes added before it: a branch's first segment blends widely (the collar where it leaves
/// its parent), the following ones just enough to hide the joints. Owner tells which branch the surface belongs to.
/// </summary>
public readonly record struct SdfSegment(Vector3 A, Vector3 B, float Ra, float Rb, float Blend, int Owner);

/// <summary>
/// A signed distance field made of segments joined with a smooth union, sampled on a sparse grid (only blocks near the
/// segments exist), and turned into a closed triangle mesh with surface nets. Branches, forks, collars and root flares
/// come out as one welded organic surface, not as cylinders pushed into each other.
/// </summary>
public sealed class ImplicitField
{
    private const int B = 8;                        // grid points per block side
    private readonly List<SdfSegment> _segs;
    private readonly Dictionary<long, Block> _blocks = [];
    public float Cell { get; }
    public IReadOnlyList<SdfSegment> Segments => _segs;

    private sealed class Block
    {
        public int Bx, By, Bz;
        public int[] Segs = [];
        public float[] Values = [];
    }

    public ImplicitField(IEnumerable<SdfSegment> segments, float cell)
    {
        if (cell <= 0) throw new ArgumentOutOfRangeException(nameof(cell));
        Cell = cell;
        _segs = segments.Where(s => s.Ra > 0 || s.Rb > 0).ToList();
        // Which segments touch which blocks (each block keeps only the segments that can reach it).
        var lists = new Dictionary<long, List<int>>();
        var blockSize = B * cell;
        for (var s = 0; s < _segs.Count; s++)
        {
            var g = _segs[s];
            var margin = MathF.Max(g.Ra, g.Rb) + g.Blend + 3 * cell;
            var lo = Vector3.Min(g.A, g.B) - new Vector3(margin);
            var hi = Vector3.Max(g.A, g.B) + new Vector3(margin);
            int x0 = Floor(lo.X / blockSize), y0 = Floor(lo.Y / blockSize), z0 = Floor(lo.Z / blockSize);
            int x1 = Floor(hi.X / blockSize), y1 = Floor(hi.Y / blockSize), z1 = Floor(hi.Z / blockSize);
            for (var bz = z0; bz <= z1; bz++)
                for (var by = y0; by <= y1; by++)
                    for (var bx = x0; bx <= x1; bx++)
                    {
                        // Skip blocks of a long diagonal segment's box that the segment never comes near.
                        var centre = (new Vector3(bx, by, bz) + new Vector3(0.5f)) * blockSize;
                        if (SegmentDistance(centre, g.A, g.B) > margin + blockSize * 0.87f) continue;
                        var key = Key(bx, by, bz);
                        if (!lists.TryGetValue(key, out var l)) lists[key] = l = [];
                        l.Add(s);
                    }
        }
        foreach (var (key, l) in lists)
        {
            var (bx, by, bz) = Unkey(key);
            _blocks[key] = new Block { Bx = bx, By = by, Bz = bz, Segs = l.ToArray() };
        }
        Parallel.ForEach(_blocks.Values, block =>
        {
            var v = new float[B * B * B];
            for (var z = 0; z < B; z++)
                for (var y = 0; y < B; y++)
                    for (var x = 0; x < B; x++)
                        v[(z * B + y) * B + x] = Eval(new Vector3(block.Bx * B + x, block.By * B + y, block.Bz * B + z) * cell, block.Segs, out _);
            block.Values = v;
        });
    }

    public int BlockCount => _blocks.Count;

    /// <summary>The field at any point (negative inside), and the segment nearest the surface there.</summary>
    public float Sample(Vector3 p, out int owner)
    {
        var blockSize = B * Cell;
        if (_blocks.TryGetValue(Key(Floor(p.X / blockSize), Floor(p.Y / blockSize), Floor(p.Z / blockSize)), out var block))
            return Eval(p, block.Segs, out owner);
        owner = -1;
        return Cell * 4;
    }

    public Vector3 Gradient(Vector3 p)
    {
        var e = Cell * 0.25f;
        var g = new Vector3(
            Sample(p + new Vector3(e, 0, 0), out _) - Sample(p - new Vector3(e, 0, 0), out _),
            Sample(p + new Vector3(0, e, 0), out _) - Sample(p - new Vector3(0, e, 0), out _),
            Sample(p + new Vector3(0, 0, e), out _) - Sample(p - new Vector3(0, 0, e), out _));
        return g.LengthSquared() > 1e-20f ? Vector3.Normalize(g) : Vector3.UnitY;
    }

    private float Eval(Vector3 p, int[] segs, out int owner)
    {
        var d = float.MaxValue;
        var best = float.MaxValue;
        owner = -1;
        foreach (var i in segs)
        {
            var s = _segs[i];
            var di = RoundCone(p, s.A, s.B, s.Ra, s.Rb);
            if (di < best) { best = di; owner = i; }
            d = d == float.MaxValue ? di : SmoothMin(d, di, s.Blend);
        }
        // Far from every segment: a capped positive value (outside) keeps the grid well behaved.
        return MathF.Min(d, Cell * 4);
    }

    /// <summary>Polynomial smooth minimum: like min, but rounds the crease within k of where the shapes meet.</summary>
    public static float SmoothMin(float a, float b, float k)
    {
        if (k <= 0) return MathF.Min(a, b);
        var h = MathF.Max(k - MathF.Abs(a - b), 0) / k;
        return MathF.Min(a, b) - h * h * k * 0.25f;
    }

    /// <summary>Exact distance to a cone capped by spheres (Inigo Quilez's round cone).</summary>
    public static float RoundCone(Vector3 p, Vector3 a, Vector3 b, float r1, float r2)
    {
        var ba = b - a;
        var l2 = Vector3.Dot(ba, ba);
        var rr = r1 - r2;
        var a2 = l2 - rr * rr;
        // Degenerate (one sphere contains the other, or no length): the bigger sphere.
        if (l2 < 1e-12f || a2 <= 1e-12f) return MathF.Min(Vector3.Distance(p, a) - r1, Vector3.Distance(p, b) - r2);
        var il2 = 1 / l2;
        var pa = p - a;
        var y = Vector3.Dot(pa, ba);
        var z = y - l2;
        var x2 = (pa * l2 - ba * y).LengthSquared();
        var y2 = y * y * l2;
        var z2 = z * z * l2;
        var k = MathF.Sign(rr) * rr * rr * x2;
        if (MathF.Sign(z) * a2 * z2 > k) return MathF.Sqrt(x2 + z2) * il2 - r2;
        if (MathF.Sign(y) * a2 * y2 < k) return MathF.Sqrt(x2 + y2) * il2 - r1;
        return (MathF.Sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
    }

    private static float SegmentDistance(Vector3 p, Vector3 a, Vector3 b)
    {
        var ab = b - a;
        var t = ab.LengthSquared() < 1e-12f ? 0 : Math.Clamp(Vector3.Dot(p - a, ab) / ab.LengthSquared(), 0, 1);
        return Vector3.Distance(p, a + ab * t);
    }

    /// <summary>
    /// Extracts the surface as a closed, manifold mesh. Each grid cell the surface passes through holds one or more
    /// patches; a patch is the loop of edge crossings that the contours on the cell's faces join up (an ambiguous face is
    /// decided from that face alone, so both cells sharing it agree). Every patch becomes a small polygon whose corners
    /// are the crossings, shared with the neighbouring cells, so the mesh is welded by construction. Vertices are pulled
    /// onto the true surface; the simplifier later turns the dense, uneven triangles into an even, budgeted mesh.
    /// </summary>
    public Mesh3D Extract(string name = "Surface", int material = 0)
    {
        var mesh = new Mesh3D { Name = name };
        var crossingVertex = new[] { new Dictionary<long, int>(), new Dictionary<long, int>(), new Dictionary<long, int>() };
        var sub = mesh.Sub(material);
        var f = new float[8];
        var next = new int[12];
        var loop = new List<int>(12);

        int Crossing(int i, int j, int k, int e)
        {
            // The cell edge as a grid edge: its lower corner and its axis.
            var (a, b) = Edges[e];
            var axis = (a ^ b) switch { 1 => 0, 2 => 1, _ => 2 };
            int gi = i + (a & 1), gj = j + ((a >> 1) & 1), gk = k + (a >> 2);
            var key = Key(gi, gj, gk);
            if (crossingVertex[axis].TryGetValue(key, out var v)) return v;
            float fa = f[a], fb = f[b];
            var t = Math.Clamp(fa / (fa - fb), 0.02f, 0.98f);
            var p0 = new Vector3(gi, gj, gk);
            var p1 = p0 + (axis == 0 ? Vector3.UnitX : axis == 1 ? Vector3.UnitY : Vector3.UnitZ);
            mesh.Positions.Add((p0 + (p1 - p0) * t) * Cell);
            return crossingVertex[axis][key] = mesh.Positions.Count - 1;
        }

        foreach (var block in _blocks.Values)
            for (var z = 0; z < B; z++)
                for (var y = 0; y < B; y++)
                    for (var x = 0; x < B; x++)
                    {
                        int i = block.Bx * B + x, j = block.By * B + y, k = block.Bz * B + z;
                        var mask = 0;
                        for (var c = 0; c < 8; c++)
                        {
                            f[c] = Get(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2));
                            if (f[c] < 0) mask |= 1 << c;
                        }
                        if (mask == 0 || mask == 255) continue;
                        Array.Fill(next, -1);
                        // On each face (corners counter-clockwise seen from outside the cell), every contour segment runs
                        // from a crossing where the walk leaves the inside to one where it enters it: inside on the left.
                        foreach (var face in Faces)
                        {
                            Span<int> edge = stackalloc int[4];
                            Span<int> kind = stackalloc int[4];     // +1 leaving the inside, -1 entering, 0 none
                            var n = 0;
                            for (var c = 0; c < 4; c++)
                            {
                                int ca = face[c], cb = face[(c + 1) & 3];
                                edge[c] = EdgeOf[ca, cb];
                                kind[c] = f[ca] < 0 == f[cb] < 0 ? 0 : f[ca] < 0 ? 1 : -1;
                                if (kind[c] != 0) n++;
                            }
                            if (n == 2)
                            {
                                int from = -1, to = -1;
                                for (var c = 0; c < 4; c++) { if (kind[c] == 1) from = edge[c]; else if (kind[c] == -1) to = edge[c]; }
                                next[from] = to;
                            }
                            else if (n == 4)
                            {
                                // Alternating corners: the face centre decides which corners the contour cuts off.
                                var centreInside = f[face[0]] + f[face[1]] + f[face[2]] + f[face[3]] < 0;
                                // Cut off the corners unlike the centre: each segment joins the two edges at one such corner.
                                for (var c = 0; c < 4; c++)
                                {
                                    var corner = face[c];
                                    if (f[corner] < 0 == centreInside) continue;
                                    int before = (c + 3) & 3, after = c;     // edges into and out of this corner
                                    if (kind[after] == 1) next[edge[after]] = edge[before]; else next[edge[before]] = edge[after];
                                }
                            }
                        }
                        // Walk each loop and fan it into triangles.
                        var used = 0;
                        for (var e0 = 0; e0 < 12; e0++)
                        {
                            if (next[e0] < 0 || (used & (1 << e0)) != 0) continue;
                            loop.Clear();
                            var e = e0;
                            while ((used & (1 << e)) == 0 && e >= 0)
                            {
                                used |= 1 << e;
                                loop.Add(Crossing(i, j, k, e));
                                e = next[e];
                            }
                            if (loop.Count == 3) { sub.Indices.AddRange([loop[0], loop[2], loop[1]]); continue; }
                            // Larger patches get a centre vertex of their own: a fan's diagonals could repeat a diagonal
                            // the neighbouring cell draws across the same face.
                            var centre = Vector3.Zero;
                            foreach (var v in loop) centre += mesh.Positions[v];
                            mesh.Positions.Add(centre / loop.Count);
                            var ci = mesh.Positions.Count - 1;
                            for (var t = 0; t < loop.Count; t++) sub.Indices.AddRange([ci, loop[(t + 1) % loop.Count], loop[t]]);
                        }
                    }

        // Pull each vertex onto the true surface (two Newton steps along the gradient, staying near its grid edge).
        Parallel.For(0, mesh.Positions.Count, v =>
        {
            var p = mesh.Positions[v];
            var start = p;
            for (var it = 0; it < 2; it++) p -= Gradient(p) * Sample(p, out _);
            if (Vector3.Distance(p, start) < Cell * 0.75f) mesh.Positions[v] = p;
        });
        return mesh;
    }

    /// <summary>Smooth normals from the field's gradient (better than from the triangles, also after simplifying).</summary>
    public void FieldNormals(Mesh3D mesh)
    {
        var normals = new Vector3[mesh.VertexCount];
        Parallel.For(0, mesh.VertexCount, v => normals[v] = Gradient(mesh.Positions[v]));
        mesh.Normals.Clear();
        mesh.Normals.AddRange(normals);
    }

    /// <summary>The segment each vertex belongs to (the nearest one), for UVs, wind data and splitting into branches.</summary>
    public int[] Owners(Mesh3D mesh)
    {
        var owners = new int[mesh.VertexCount];
        Parallel.For(0, mesh.VertexCount, v => { Sample(mesh.Positions[v], out owners[v]); });
        return owners;
    }

    private float Get(int i, int j, int k)
    {
        int bx = FloorDiv(i), by = FloorDiv(j), bz = FloorDiv(k);
        if (!_blocks.TryGetValue(Key(bx, by, bz), out var block)) return Cell * 4;
        return block.Values[((k - bz * B) * B + (j - by * B)) * B + (i - bx * B)];
    }

    // Cell corners are numbered x + 2y + 4z; edges by their two corners; faces by their corners in order around them.
    private static readonly (int, int)[] Edges = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)];
    private static readonly int[][] Faces = OrientFaces([[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]);
    private static readonly int[,] EdgeOf = BuildEdgeOf();

    /// <summary>Orders each face's corners counter-clockwise as seen from outside the cell.</summary>
    private static int[][] OrientFaces(int[][] faces)
    {
        static Vector3 P(int c) => new(c & 1, (c >> 1) & 1, c >> 2);
        return faces.Select(face =>
        {
            var normal = Vector3.Cross(P(face[1]) - P(face[0]), P(face[2]) - P(face[1]));
            var outward = (P(face[0]) + P(face[2])) / 2 - new Vector3(0.5f);
            return Vector3.Dot(normal, outward) > 0 ? face : face.Reverse().ToArray();
        }).ToArray();
    }

    private static int[,] BuildEdgeOf()
    {
        var t = new int[8, 8];
        for (var e = 0; e < Edges.Length; e++) { t[Edges[e].Item1, Edges[e].Item2] = e; t[Edges[e].Item2, Edges[e].Item1] = e; }
        return t;
    }

    private static int Floor(float v) => (int)MathF.Floor(v);
    private static int FloorDiv(int v) => v >= 0 ? v / B : -((-v + B - 1) / B);
    private static long Key(int x, int y, int z) => ((long)(x + (1 << 20)) << 42) | ((long)(y + (1 << 20)) << 21) | (long)(z + (1 << 20));
    private static (int, int, int) Unkey(long k) => ((int)(k >> 42) - (1 << 20), (int)((k >> 21) & 0x1FFFFF) - (1 << 20), (int)(k & 0x1FFFFF) - (1 << 20));
}
