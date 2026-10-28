using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// Quadric error simplification (Garland and Heckbert): repeatedly collapses the edge whose removal changes the shape
/// least, until the mesh fits a triangle budget. Collapses that would fold a triangle over, pinch the surface (the link
/// condition) or tear an open border are refused, so a closed manifold mesh stays closed and manifold. A small length
/// term keeps triangles evenly sized on flat stretches. Works on positions only: normals, UVs and colours are cleared
/// and made again afterwards (from the field and the skeleton), which is both simpler and better than carrying them.
/// </summary>
public static class Simplifier
{
    private struct Quadric
    {
        public double A, B, C, D, E, F, G, H, I, J;     // xx xy xz xw yy yz yw zz zw ww

        public static Quadric Plane(double a, double b, double c, double d, double w) => new()
        {
            A = a * a * w, B = a * b * w, C = a * c * w, D = a * d * w,
            E = b * b * w, F = b * c * w, G = b * d * w,
            H = c * c * w, I = c * d * w, J = d * d * w,
        };

        public void Add(in Quadric q)
        {
            A += q.A; B += q.B; C += q.C; D += q.D; E += q.E; F += q.F; G += q.G; H += q.H; I += q.I; J += q.J;
        }

        public readonly double Error(double x, double y, double z) =>
            A * x * x + 2 * B * x * y + 2 * C * x * z + 2 * D * x + E * y * y + 2 * F * y * z + 2 * G * y + H * z * z + 2 * I * z + J;

        /// <summary>The point of least error, or false when the quadric is too flat to say (then an edge point is used).</summary>
        public readonly bool Optimum(out double x, out double y, out double z)
        {
            var det = A * (E * H - F * F) - B * (B * H - F * C) + C * (B * F - E * C);
            x = y = z = 0;
            if (Math.Abs(det) < 1e-18) return false;
            var inv = 1 / det;
            x = -inv * (D * (E * H - F * F) - B * (G * H - F * I) + C * (G * F - E * I));
            y = -inv * (A * (G * H - I * F) - D * (B * H - F * C) + C * (B * I - G * C));
            z = -inv * (A * (E * I - G * F) - B * (B * I - G * C) + D * (B * F - E * C));
            return double.IsFinite(x) && double.IsFinite(y) && double.IsFinite(z);
        }
    }

    /// <summary>Simplifies in place to at most <paramref name="targetTriangles"/> (fewer only when no collapse is allowed).</summary>
    public static void Simplify(Mesh3D mesh, int targetTriangles)
    {
        var vCount = mesh.VertexCount;
        var pos = new Vector3d[vCount];
        for (var i = 0; i < vCount; i++) pos[i] = new Vector3d(mesh.Positions[i]);
        var tris = new List<int>();
        var mats = new List<int>();
        foreach (var s in mesh.Submeshes)
            for (var i = 0; i + 2 < s.Indices.Count; i += 3) { tris.AddRange([s.Indices[i], s.Indices[i + 1], s.Indices[i + 2]]); mats.Add(s.Material); }
        var tCount = mats.Count;
        var live = tCount;
        if (live <= targetTriangles) return;
        var removed = new bool[tCount];
        var vTris = new List<int>[vCount];
        for (var i = 0; i < vCount; i++) vTris[i] = [];
        for (var t = 0; t < tCount; t++) for (var c = 0; c < 3; c++) vTris[tris[t * 3 + c]].Add(t);

        // Quadrics from the triangles' planes, weighted by area; open borders get a stiff plane across them.
        var q = new Quadric[vCount];
        var edgeUse = new Dictionary<(int, int), int>();
        double totalArea = 0;
        for (var t = 0; t < tCount; t++)
        {
            int a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
            var n = Vector3d.Cross(pos[b] - pos[a], pos[c] - pos[a]);
            var len = n.Length;
            if (len > 1e-20)
            {
                var u = n / len;
                var pl = Quadric.Plane(u.X, u.Y, u.Z, -Vector3d.Dot(u, pos[a]), len / 2);
                q[a].Add(pl); q[b].Add(pl); q[c].Add(pl);
                totalArea += len / 2;
            }
            for (var e = 0; e < 3; e++)
            {
                int x = tris[t * 3 + e], y = tris[t * 3 + (e + 1) % 3];
                var key = x < y ? (x, y) : (y, x);
                edgeUse[key] = edgeUse.GetValueOrDefault(key) + 1;
            }
        }
        var border = new bool[vCount];
        for (var t = 0; t < tCount; t++)
            for (var e = 0; e < 3; e++)
            {
                int x = tris[t * 3 + e], y = tris[t * 3 + (e + 1) % 3];
                if (edgeUse[x < y ? (x, y) : (y, x)] != 1) continue;
                border[x] = border[y] = true;
                var c = tris[t * 3 + (e + 2) % 3];
                var faceN = Vector3d.Cross(pos[y] - pos[x], pos[c] - pos[x]);
                var side = Vector3d.Cross(pos[y] - pos[x], faceN);
                if (side.Length < 1e-20) continue;
                side /= side.Length;
                var w = (pos[y] - pos[x]).LengthSquared * 100;
                var pl = Quadric.Plane(side.X, side.Y, side.Z, -Vector3d.Dot(side, pos[x]), w);
                q[x].Add(pl); q[y].Add(pl);
            }
        // Length term scale: about the mean triangle area, so it only matters where the shape term is near zero.
        var lengthWeight = 0.02 / Math.Max(1e-12, totalArea / Math.Max(1, tCount));

        var version = new int[vCount];
        var dead = new bool[vCount];
        var heap = new PriorityQueue<(int A, int B, int VA, int VB, Vector3d P), double>();

        (double Cost, Vector3d P) Cost(int a, int b)
        {
            var qq = q[a];
            qq.Add(q[b]);
            Vector3d best;
            double err;
            if (qq.Optimum(out var x, out var y, out var z) && Vector3d.DistanceSquared(new Vector3d(x, y, z), (pos[a] + pos[b]) * 0.5) < (pos[a] - pos[b]).LengthSquared * 4)
            {
                best = new Vector3d(x, y, z);
                err = qq.Error(x, y, z);
            }
            else
            {
                best = pos[a]; err = qq.Error(best.X, best.Y, best.Z);
                foreach (var cand in new[] { pos[b], (pos[a] + pos[b]) * 0.5 })
                {
                    var e = qq.Error(cand.X, cand.Y, cand.Z);
                    if (e < err) { err = e; best = cand; }
                }
            }
            // Keep border vertices on their border.
            if (border[a] && !border[b]) best = pos[a];
            else if (border[b] && !border[a]) best = pos[b];
            err = Math.Max(0, qq.Error(best.X, best.Y, best.Z));
            var l2 = (pos[a] - pos[b]).LengthSquared;
            return (err + lengthWeight * l2 * l2, best);
        }

        void Push(int a, int b)
        {
            var (cost, p) = Cost(a, b);
            heap.Enqueue((a, b, version[a], version[b], p), cost);
        }

        foreach (var (a, b) in edgeUse.Keys) Push(a, b);

        var neighboursA = new HashSet<int>();
        var neighboursB = new HashSet<int>();
        while (live > targetTriangles && heap.TryDequeue(out var item, out _))
        {
            var (a, b, va, vb, p) = item;
            if (dead[a] || dead[b] || version[a] != va || version[b] != vb) continue;
            // An edge between two border vertices that is not itself a border would pinch the surface.
            var shared = vTris[a].Where(t => !removed[t] && Has(t, b)).ToList();
            if (shared.Count == 0) continue;
            if (border[a] && border[b] && shared.Count != 1) continue;
            // Link condition: the only vertices both ends share are the ones across the shared triangles.
            neighboursA.Clear(); neighboursB.Clear();
            foreach (var t in vTris[a]) if (!removed[t]) for (var c = 0; c < 3; c++) neighboursA.Add(tris[t * 3 + c]);
            foreach (var t in vTris[b]) if (!removed[t]) for (var c = 0; c < 3; c++) neighboursB.Add(tris[t * 3 + c]);
            neighboursA.IntersectWith(neighboursB);
            neighboursA.Remove(a); neighboursA.Remove(b);
            if (neighboursA.Count != shared.Count) continue;
            // No triangle may flip or collapse to nothing.
            if (Folds(a, b, p) || Folds(b, a, p)) continue;

            // Collapse a into b.
            pos[b] = p;
            q[b].Add(q[a]);
            border[b] |= border[a];
            foreach (var t in vTris[a])
            {
                if (removed[t]) continue;
                if (Has(t, b))
                {
                    removed[t] = true;
                    live--;
                    for (var c = 0; c < 3; c++) { var v = tris[t * 3 + c]; if (v != a) vTris[v].Remove(t); }
                }
                else
                {
                    for (var c = 0; c < 3; c++) if (tris[t * 3 + c] == a) tris[t * 3 + c] = b;
                    vTris[b].Add(t);
                }
            }
            vTris[a].Clear();
            dead[a] = true;
            version[b]++;
            var around = new HashSet<int>();
            foreach (var t in vTris[b]) for (var c = 0; c < 3; c++) around.Add(tris[t * 3 + c]);
            around.Remove(b);
            foreach (var w in around) Push(Math.Min(b, w), Math.Max(b, w));
        }

        // Rebuild the mesh from what is left.
        var remap = new int[vCount];
        Array.Fill(remap, -1);
        var newPos = new List<Vector3>();
        var subs = new Dictionary<int, Submesh>();
        foreach (var s in mesh.Submeshes) subs[s.Material] = new Submesh { Material = s.Material };
        for (var t = 0; t < tCount; t++)
        {
            if (removed[t]) continue;
            var sub = subs[mats[t]];
            for (var c = 0; c < 3; c++)
            {
                var v = tris[t * 3 + c];
                if (remap[v] < 0) { remap[v] = newPos.Count; newPos.Add(pos[v].ToVector3()); }
                sub.Indices.Add(remap[v]);
            }
        }
        mesh.Positions.Clear(); mesh.Positions.AddRange(newPos);
        mesh.Normals.Clear(); mesh.UV0.Clear(); mesh.Colors.Clear();
        mesh.Submeshes.Clear(); mesh.Submeshes.AddRange(subs.Values.Where(s => s.Indices.Count > 0));
        return;

        bool Has(int t, int v) => tris[t * 3] == v || tris[t * 3 + 1] == v || tris[t * 3 + 2] == v;

        bool Folds(int moving, int other, Vector3d to)
        {
            foreach (var t in vTris[moving])
            {
                if (removed[t] || Has(t, other)) continue;
                var c = tris[t * 3] == moving ? 0 : tris[t * 3 + 1] == moving ? 1 : 2;
                var p0 = pos[tris[t * 3]]; var p1 = pos[tris[t * 3 + 1]]; var p2 = pos[tris[t * 3 + 2]];
                var before = Vector3d.Cross(p1 - p0, p2 - p0);
                if (c == 0) p0 = to; else if (c == 1) p1 = to; else p2 = to;
                var after = Vector3d.Cross(p1 - p0, p2 - p0);
                var la = after.Length;
                if (la < 1e-14) return true;
                if (Vector3d.Dot(before, after) < 0.2 * before.Length * la) return true;
            }
            return false;
        }
    }

    /// <summary>Double-precision vector for the quadric arithmetic.</summary>
    private readonly record struct Vector3d(double X, double Y, double Z)
    {
        public Vector3d(Vector3 v) : this(v.X, v.Y, v.Z) { }
        public static Vector3d operator +(Vector3d a, Vector3d b) => new(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
        public static Vector3d operator -(Vector3d a, Vector3d b) => new(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
        public static Vector3d operator *(Vector3d a, double s) => new(a.X * s, a.Y * s, a.Z * s);
        public static Vector3d operator /(Vector3d a, double s) => new(a.X / s, a.Y / s, a.Z / s);
        public double LengthSquared => X * X + Y * Y + Z * Z;
        public double Length => Math.Sqrt(LengthSquared);
        public static double Dot(Vector3d a, Vector3d b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;
        public static Vector3d Cross(Vector3d a, Vector3d b) => new(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X);
        public static double DistanceSquared(Vector3d a, Vector3d b) => (a - b).LengthSquared;
        public Vector3 ToVector3() => new((float)X, (float)Y, (float)Z);
    }
}
