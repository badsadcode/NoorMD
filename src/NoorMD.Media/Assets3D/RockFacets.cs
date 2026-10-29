using System.Diagnostics;
using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// The faceted look (as in many stylized games): every chunk built exactly from planes — a box (or a faceted ball)
/// cut by its chips — so its faces are truly flat; every edge chamfered with a narrow face painted bright, the line of
/// light along each edge that the style is known for; chunks overlapping as they are kitbashed, with the triangles
/// buried inside other chunks left out and the stone darkened where chunks meet. Collision is exact (each chunk is
/// convex). The farther levels drop the chamfers, then the small chunks.
/// </summary>
public static partial class RockBuilder
{
    /// <summary>A convex polyhedron as flat faces (each a convex polygon, counter-clockwise seen from outside).</summary>
    private sealed class Poly
    {
        public readonly List<List<Vector3>> Faces = [];
        public readonly List<Vector3> Normals = [];
        /// <summary>0 a face, 1 a chamfer, 2 cut by the ground.</summary>
        public readonly List<byte> Kinds = [];

        public static Poly Box(Vector3 h)
        {
            var p = new Poly();
            void F(Vector3 n, Vector3 a, Vector3 b, Vector3 c, Vector3 d) { p.Faces.Add([a, b, c, d]); p.Normals.Add(n); p.Kinds.Add(0); }
            float x = h.X, y = h.Y, z = h.Z;
            F(Vector3.UnitX, new(x, -y, -z), new(x, y, -z), new(x, y, z), new(x, -y, z));
            F(-Vector3.UnitX, new(-x, -y, z), new(-x, y, z), new(-x, y, -z), new(-x, -y, -z));
            F(Vector3.UnitY, new(-x, y, -z), new(-x, y, z), new(x, y, z), new(x, y, -z));
            F(-Vector3.UnitY, new(-x, -y, z), new(-x, -y, -z), new(x, -y, -z), new(x, -y, z));
            F(Vector3.UnitZ, new(-x, -y, z), new(x, -y, z), new(x, y, z), new(-x, y, z));
            F(-Vector3.UnitZ, new(x, -y, -z), new(-x, -y, -z), new(-x, y, -z), new(x, y, -z));
            return p;
        }

        public Poly Clone()
        {
            var c = new Poly();
            foreach (var f in Faces) c.Faces.Add([.. f]);
            c.Normals.AddRange(Normals);
            c.Kinds.AddRange(Kinds);
            return c;
        }

        public IEnumerable<Vector3> Corners => Faces.SelectMany(f => f);

        /// <summary>Keeps the side where dot(p, n) ≤ d, closing the cut with a new face.</summary>
        public void Clip(Vector3 n, float d, byte kind)
        {
            const float eps = 1e-6f;
            var cap = new List<Vector3>();
            for (var f = Faces.Count - 1; f >= 0; f--)
            {
                var poly = Faces[f];
                var kept = new List<Vector3>();
                for (var i = 0; i < poly.Count; i++)
                {
                    Vector3 a = poly[i], b = poly[(i + 1) % poly.Count];
                    float da = Vector3.Dot(a, n) - d, db = Vector3.Dot(b, n) - d;
                    if (da <= eps) { kept.Add(a); if (da > -eps) cap.Add(a); }
                    if ((da < -eps && db > eps) || (da > eps && db < -eps))
                    {
                        var p = a + (b - a) * (da / (da - db));
                        kept.Add(p);
                        cap.Add(p);
                    }
                }
                kept = Dedupe(kept, true);
                if (kept.Count >= 3) Faces[f] = kept;
                else { Faces.RemoveAt(f); Normals.RemoveAt(f); Kinds.RemoveAt(f); }
            }
            cap = Dedupe(cap, false);
            if (cap.Count < 3) return;
            var c = cap.Aggregate(Vector3.Zero, (s, p) => s + p) / cap.Count;
            var u = Vector3.Normalize(Vector3.Cross(n, MathF.Abs(n.Y) < 0.9f ? Vector3.UnitY : Vector3.UnitX));
            var v = Vector3.Cross(n, u);
            cap.Sort((a, b) => MathF.Atan2(Vector3.Dot(a - c, v), Vector3.Dot(a - c, u)).CompareTo(MathF.Atan2(Vector3.Dot(b - c, v), Vector3.Dot(b - c, u))));
            Faces.Add(cap);
            Normals.Add(n);
            Kinds.Add(kind);
        }

        private static List<Vector3> Dedupe(List<Vector3> pts, bool ring)
        {
            var o = new List<Vector3>();
            foreach (var p in pts)
            {
                if (ring) { if (o.Count == 0 || Vector3.DistanceSquared(o[^1], p) > 1e-12f) o.Add(p); }
                else if (!o.Any(q => Vector3.DistanceSquared(q, p) < 1e-10f)) o.Add(p);
            }
            if (ring && o.Count > 1 && Vector3.DistanceSquared(o[0], o[^1]) < 1e-12f) o.RemoveAt(o.Count - 1);
            return o;
        }

        /// <summary>Every edge with the normals of the two faces that meet there.</summary>
        public List<(Vector3 A, Vector3 B, Vector3 N1, Vector3 N2)> Edges()
        {
            static (long, long, long) K(Vector3 p) => ((long)MathF.Round(p.X * 1e5f), (long)MathF.Round(p.Y * 1e5f), (long)MathF.Round(p.Z * 1e5f));
            var directed = new Dictionary<((long, long, long), (long, long, long)), int>();
            for (var f = 0; f < Faces.Count; f++)
                for (var i = 0; i < Faces[f].Count; i++)
                    directed[(K(Faces[f][i]), K(Faces[f][(i + 1) % Faces[f].Count]))] = f;
            var edges = new List<(Vector3, Vector3, Vector3, Vector3)>();
            for (var f = 0; f < Faces.Count; f++)
                for (var i = 0; i < Faces[f].Count; i++)
                {
                    Vector3 a = Faces[f][i], b = Faces[f][(i + 1) % Faces[f].Count];
                    if (directed.TryGetValue((K(b), K(a)), out var g) && f < g) edges.Add((a, b, Normals[f], Normals[g]));
                }
            return edges;
        }

        public Poly Moved(Quaternion q, Vector3 c)
        {
            var m = new Poly();
            foreach (var f in Faces) m.Faces.Add(f.Select(p => Vector3.Transform(p, q) + c).ToList());
            m.Normals.AddRange(Normals.Select(n => Vector3.Normalize(Vector3.Transform(n, q))));
            m.Kinds.AddRange(Kinds);
            return m;
        }

        /// <summary>How far a point is outside (its furthest face plane; negative inside).</summary>
        public float Outside(Vector3 p)
        {
            var worst = float.MinValue;
            for (var f = 0; f < Faces.Count; f++) worst = MathF.Max(worst, Vector3.Dot(p - Faces[f][0], Normals[f]));
            return worst;
        }

        public int Triangles => Faces.Sum(f => f.Count - 2);
    }

    /// <summary>One chunk's polyhedron in its own frame: its body (a box, or a faceted ball when round) cut by its chips and wear.</summary>
    private static Poly Body(Chunk c, Random rng, float wear)
    {
        var p = Poly.Box(c.H);
        if (c.Round >= 0.4f)
        {
            // A ball of facets: planes all round, each as far out as the ellipsoid reaches that way (a little less).
            var n = 12 + rng.Next(5);
            for (var i = 0; i < n; i++)
            {
                var y = 1 - 2 * (i + 0.5f) / n;
                var r = MathF.Sqrt(MathF.Max(0, 1 - y * y));
                var a = i * 2.39996f + R(rng, -0.3f, 0.3f);
                var dir = Vector3.Normalize(new Vector3(MathF.Cos(a) * r, y, MathF.Sin(a) * r) + new Vector3(R(rng, -0.15f, 0.15f), R(rng, -0.15f, 0.15f), R(rng, -0.15f, 0.15f)));
                var reach = MathF.Sqrt(Sq(c.H.X * dir.X) + Sq(c.H.Y * dir.Y) + Sq(c.H.Z * dir.Z));
                p.Clip(dir, reach * R(rng, 0.86f, 0.96f), 0);
            }
        }
        foreach (var (n, o) in c.Cuts) p.Clip(n, o, 0);
        // Worn corners: small chips knocked off.
        var chips = (int)MathF.Round(wear * 4 * R(rng, 0.6f, 1.4f));
        var size = MathF.Min(c.H.X, MathF.Min(c.H.Y, c.H.Z));
        for (var k = 0; k < chips; k++)
        {
            var corners = p.Corners.ToList();
            if (corners.Count == 0) break;
            var v = corners[rng.Next(corners.Count)];
            var dir = Vector3.Normalize(Vector3.Normalize(v) + new Vector3(R(rng, -0.5f, 0.5f), R(rng, -0.5f, 0.5f), R(rng, -0.5f, 0.5f)));
            p.Clip(dir, Vector3.Dot(v, dir) - size * R(rng, 0.12f, 0.3f), 0);
        }
        return p;
    }

    /// <summary>
    /// Edges cut by narrow faces (the bright line along them), chiselled by hand rather than machined: each edge its
    /// own width, one to three cuts tilted along it so the bevel widens and narrows, and now and then an edge left sharp.
    /// </summary>
    private static Poly Chamfered(Poly body, float width, Random rng)
    {
        var c = body.Clone();
        foreach (var (a, b, n1, n2) in body.Edges())
        {
            var cos = Vector3.Dot(n1, n2);
            if (cos > 0.94f || rng.NextDouble() < 0.12) continue;
            var nb = Vector3.Normalize(n1 + n2);
            var along = b - a;
            var length = along.Length();
            if (length < 1e-6f) continue;
            along /= length;
            // Tilting the cut about this axis makes it bite deeper at one end of the edge than the other.
            var tiltAxis = Vector3.Normalize(Vector3.Cross(along, nb));
            var cuts = 1 + (rng.NextDouble() < 0.45 ? 1 : 0) + (rng.NextDouble() < 0.2 ? 1 : 0);
            var baseDepth = width * 0.35f * MathF.Sqrt(1 - cos) * R(rng, 0.6f, 1.6f);
            for (var k = 0; k < cuts; k++)
            {
                var n = Vector3.Normalize(Vector3.Transform(nb, Quaternion.CreateFromAxisAngle(tiltAxis, Deg(R(rng, -6, 6))))
                    + (n1 - n2) * R(rng, -0.12f, 0.12f));
                var anchor = a + along * length * R(rng, 0.15f, 0.85f);
                c.Clip(n, Vector3.Dot(anchor, n) - baseDepth * (k == 0 ? 1 : R(rng, 0.6f, 1.2f)), 1);
            }
        }
        return c;
    }

    /// <summary>The chunks of a single rock (stone, rock, boulder): a faceted ball with its broken faces, lumps melted in.</summary>
    private static List<Chunk> SingleChunks(RockRecipe r, Random rng)
    {
        var ax = (float)r.Size / 2;
        var az = ax / (1 + (float)r.Elongation);
        var ay = (float)(r.Size * r.Height) / 2;
        var chunks = new List<Chunk>();
        var main = new Chunk { C = new Vector3(0, ay * 0.9f, 0), H = new Vector3(ax, ay, az) * 0.95f, Round = 1, Q = Turn(R(rng, 0, MathF.Tau)) };
        for (var i = 0; i < r.Fractures; i++)
        {
            var n = Vector3.Normalize(new Vector3(R(rng, -1, 1), R(rng, -0.35f, 0.95f), R(rng, -1, 1)));
            var reach = MathF.Sqrt(Sq(main.H.X * n.X) + Sq(main.H.Y * n.Y) + Sq(main.H.Z * n.Z));
            main.Cuts.Add((n, reach * R(rng, 0.55f, 0.82f)));
        }
        chunks.Add(main);
        var extra = r.Kind switch { "boulder" => 1 + rng.Next(2), "rock" => rng.Next(2), _ => 0 };
        for (var i = 0; i < extra; i++)
        {
            var s = R(rng, 0.45f, 0.7f);
            var k = new Chunk { C = new Vector3(R(rng, -0.55f, 0.55f) * ax, ay * R(rng, 0.5f, 0.8f), R(rng, -0.45f, 0.45f) * az), H = new Vector3(ax, ay, az) * s, Round = 1, Q = Turn(R(rng, 0, MathF.Tau)) };
            k.Chip(rng, 3, 0.6f, 0.85f);
            chunks.Add(k);
        }
        return chunks;
    }

    /// <summary>Small faceted stones round a footprint (or over a patch, for scree): chunks sitting a quarter sunk.</summary>
    private static List<Chunk> StoneChunks(RockRecipe r, Random rng, int count, Func<Random, (Vector2 At, float Size)> place)
    {
        var stones = new List<Chunk>();
        for (var i = 0; i < count; i++)
        {
            var (at, size) = place(rng);
            var h = new Vector3(size * 0.5f, size * R(rng, 0.18f, 0.35f), size * 0.5f / (1 + R(rng, 0, 0.6f)));
            var k = new Chunk { C = new Vector3(at.X, h.Y * 0.6f, at.Y), H = h, Round = 1, Q = Turn(R(rng, 0, MathF.Tau), Deg(R(rng, -12, 12)), Deg(R(rng, -12, 12))) };
            k.Chip(rng, 2 + rng.Next(3), 0.55f, 0.85f);
            stones.Add(k);
        }
        return stones;
    }

    private static RockBuild BuildFaceted(RockRecipe recipe, Options options, RockBuild build, Stopwatch watch, CancellationToken ct)
    {
        var rng = new Random(recipe.Seed * 7919 + 29);
        var levels = Math.Min(recipe.Lods, options.MaxLods ?? 3);
        var wear = (float)recipe.EdgeWear;
        List<Chunk> chunks;
        if (recipe.Kind == "scree")
            chunks = StoneChunks(recipe, rng, recipe.Stones, g =>
            {
                var a = (float)(g.NextDouble() * Math.Tau);
                var d = (float)(recipe.Size * 0.5 * Math.Pow(g.NextDouble(), 0.8));
                return (new Vector2(MathF.Cos(a), MathF.Sin(a)) * d, (float)(recipe.Size * (0.05 + 0.12 * Math.Pow(g.NextDouble(), 2))));
            });
        else if (recipe.IsFormation) { chunks = []; Layout(recipe, rng, chunks); }
        else chunks = SingleChunks(recipe, rng);
        ct.ThrowIfCancellationRequested();

        // Each chunk's body, with and without its chamfers, in place and cut at the ground.
        var bodies = new List<(Poly Plain, Poly Bevelled, float Size)>();
        foreach (var c in chunks)
        {
            var body = Body(c, rng, wear);
            var size = MathF.Max(c.H.X, MathF.Max(c.H.Y, c.H.Z));
            var width = MathF.Min(c.H.X, MathF.Min(c.H.Y, c.H.Z)) * (0.16f + 0.2f * wear);
            var plain = body.Moved(c.Q, c.C);
            var bevelled = Chamfered(body, width, rng).Moved(c.Q, c.C);
            plain.Clip(-Vector3.UnitY, 0, 2);
            bevelled.Clip(-Vector3.UnitY, 0, 2);
            if (plain.Faces.Count >= 4) bodies.Add((plain, bevelled, size));
        }
        if (bodies.Count == 0) throw new InvalidOperationException("The rock came out empty.");

        // Fallen stones round the foot.
        var stoneBodies = new List<(Poly Plain, float Size)>();
        if (recipe.Debris > 0 && recipe.Kind != "scree")
        {
            var foot = bodies.SelectMany(b => b.Plain.Corners).Where(p => p.Y < 0.05f * (float)recipe.Size).ToList();
            if (foot.Count < 3) foot = bodies.SelectMany(b => b.Plain.Corners).ToList();
            var count = (int)Math.Round(4 + recipe.Debris * (recipe.IsFormation ? 14 : 8));
            var drng = new Random(recipe.Seed * 31 + 7);
            foreach (var s in StoneChunks(recipe, drng, count, g =>
            {
                var ang = (float)(g.NextDouble() * Math.Tau);
                var dir = new Vector2(MathF.Cos(ang), MathF.Sin(ang));
                var reach = foot.Max(p => Vector2.Dot(new Vector2(p.X, p.Z), dir));
                var size = (float)(recipe.Size * (0.04 + 0.08 * Math.Pow(g.NextDouble(), 1.5)) * (recipe.Kind == "pillar" ? 1.6 : 1));
                return (dir * (reach + size * (0.1f + 0.6f * (float)g.NextDouble())), size);
            }))
            {
                var poly = Body(s, drng, wear).Moved(s.Q, s.C);
                poly.Clip(-Vector3.UnitY, 0, 2);
                if (poly.Faces.Count >= 4) stoneBodies.Add((poly, MathF.Max(s.H.X, s.H.Z)));
            }
        }

        // Each level: which chunks, bevelled or not, within the budget.
        var (rock, snow, moss) = Materials(recipe, options, build);
        var snowIndex = recipe.Snow > 0 ? 1 : -1;
        var mossIndex = recipe.Moss > 0 ? (recipe.Snow > 0 ? 2 : 1) : -1;
        var order = Enumerable.Range(0, bodies.Count).OrderByDescending(i => bodies[i].Size).ToList();
        var meshes = new List<Mesh3D>();
        for (var level = 0; level < levels; level++)
        {
            ct.ThrowIfCancellationRequested();
            var budget = recipe.LevelTriangles(level);
            // The farthest level leaves out the small chunks.
            var keep = level < 2 ? order.ToList() : order.Where(i => bodies[i].Size >= bodies[order[0]].Size * 0.3f).ToList();
            var stones = level == 0 ? stoneBodies : level == 1 ? stoneBodies.OrderByDescending(s => s.Size).Take(stoneBodies.Count / 2).ToList() : [];
            var stoneTris = stones.Sum(s => s.Plain.Triangles);
            // The closest level bevels the biggest chunks first, as many as the budget allows.
            var bevel = new bool[bodies.Count];
            var tris = keep.Sum(i => bodies[i].Plain.Triangles) + stoneTris;
            if (level == 0)
                foreach (var i in keep)
                {
                    var more = bodies[i].Bevelled.Triangles - bodies[i].Plain.Triangles;
                    if (tris + more > budget) continue;
                    bevel[i] = true;
                    tris += more;
                }
            // Still over: leave out the smallest chunks (never the biggest).
            while (tris > budget && keep.Count > 1)
            {
                var last = keep[^1];
                tris -= bevel[last] ? bodies[last].Bevelled.Triangles : bodies[last].Plain.Triangles;
                keep.RemoveAt(keep.Count - 1);
            }
            var polys = keep.Select(i => bevel[i] ? bodies[i].Bevelled : bodies[i].Plain).ToList();
            meshes.Add(FacetMesh(polys, stones.Select(s => s.Plain).ToList(), recipe, snowIndex, mossIndex));
        }

        // The pivot: the middle of the ground contact, the base reaching Sink × height below it.
        var (lo, hi) = meshes[0].Bounds();
        var h = hi.Y - lo.Y;
        var low = meshes[0].Positions.Where(p => p.Y < lo.Y + h * 0.1f).ToList();
        var centre = low.Count > 0 ? (low.Aggregate(new Vector3(float.MaxValue), Vector3.Min) + low.Aggregate(new Vector3(float.MinValue), Vector3.Max)) / 2 : (lo + hi) / 2;
        var shift = new Vector3(-centre.X, -lo.Y - (float)recipe.Sink * h, -centre.Z);
        foreach (var m in meshes) for (var i = 0; i < m.VertexCount; i++) m.Positions[i] += shift;

        foreach (var mesh in meshes)
        {
            mesh.ComputeTangents();
            var asset = new Asset3D { Name = recipe.Name };
            asset.Materials.Add(rock);
            if (recipe.Snow > 0) asset.Materials.Add(snow);
            if (recipe.Moss > 0) asset.Materials.Add(moss);
            asset.Root = new Node3D { Name = GameProfile.Species(recipe.Name) };
            asset.Root.Children.Add(new Node3D { Name = mesh.Name, Mesh = mesh });
            build.Lods.Add(asset);
        }

        // Collision: the chunks are convex already; neighbours gathered into the pieces asked for.
        if (recipe.CollisionPieces > 0 && recipe.Kind != "scree")
        {
            var k = Math.Min(recipe.CollisionPieces, bodies.Count);
            var centres = bodies.Select(b => b.Plain.Corners.Aggregate(Vector3.Zero, (s, p) => s + p) / b.Plain.Corners.Count()).ToList();
            var seeds = Farthest(centres, k);
            var group = new int[bodies.Count];
            for (var round = 0; round < 12; round++)
            {
                for (var i = 0; i < bodies.Count; i++) group[i] = Enumerable.Range(0, seeds.Count).MinBy(g => Vector3.DistanceSquared(centres[i], seeds[g]));
                for (var g = 0; g < seeds.Count; g++)
                {
                    var members = Enumerable.Range(0, bodies.Count).Where(i => group[i] == g).ToList();
                    if (members.Count > 0) seeds[g] = members.Aggregate(Vector3.Zero, (s, i) => s + centres[i] * bodies[i].Size) / members.Sum(i => bodies[i].Size);
                }
            }
            for (var g = 0; g < seeds.Count; g++)
            {
                var pts = Enumerable.Range(0, bodies.Count).Where(i => group[i] == g).SelectMany(i => bodies[i].Plain.Corners).Select(p => p + shift).Distinct().ToList();
                if (pts.Count < 4 || Hull34(pts) is not { } hull) continue;
                hull.Name = build.Collision.Count == 0 ? "Collision" : $"Collision{build.Collision.Count + 1}";
                build.Collision.Add(hull);
                build.Lods[0].Root.Children.Add(new Node3D { Name = hull.Name + "-convcolonly", Mesh = hull, Extras = new() { ["noor_collision"] = "convex" } });
            }
        }

        var (blo, bhi) = meshes[0].Bounds();
        build.Height = bhi.Y - blo.Y;
        build.Width = MathF.Max(bhi.X - blo.X, bhi.Z - blo.Z);
        build.Seconds = watch.Elapsed.TotalSeconds;
        return build;
    }

    /// <summary>
    /// The faceted level's mesh: flat faces (each its own corners and normal), UVs projected in metres, snow and moss on
    /// faces that look up, the faces buried inside other chunks left out, and painted light — each face its own shade,
    /// lighter towards the top, the chamfers bright, darker where chunks meet and at the foot.
    /// </summary>
    private static Mesh3D FacetMesh(List<Poly> polys, List<Poly> stones, RockRecipe r, int snowIndex, int mossIndex)
    {
        var all = polys.Concat(stones).ToList();
        var lo = new Vector3(float.MaxValue);
        var hi = new Vector3(float.MinValue);
        foreach (var p in all.SelectMany(x => x.Corners)) { lo = Vector3.Min(lo, p); hi = Vector3.Max(hi, p); }
        var height = MathF.Max(hi.Y - lo.Y, 1e-4f);
        var size = MathF.Max(hi.X - lo.X, MathF.Max(height, hi.Z - lo.Z));
        var eps = size * 0.002f;
        var contact = size * 0.035f;
        var tile = (float)r.TileMetres;
        var noise = new Noise(r.Seed + 77);
        var snowLimit = 0.97f - 0.5f * (float)r.Snow;
        var mossLimit = 0.98f - 0.42f * (float)r.Moss;
        var wear = (float)r.EdgeWear;
        var shadeRng = new Random(r.Seed * 13 + 5);

        var mesh = new Mesh3D { Name = r.Kind == "scree" ? "Scree" : "Rock" };
        var sub = mesh.Sub(0);
        var snowSub = snowIndex >= 0 ? mesh.Sub(snowIndex) : null;
        var mossSub = mossIndex >= 0 ? mesh.Sub(mossIndex) : null;
        for (var pi = 0; pi < all.Count; pi++)
        {
            var poly = all[pi];
            var others = all.Where((_, j) => j != pi).ToList();
            for (var f = 0; f < poly.Faces.Count; f++)
            {
                var face = poly.Faces[f];
                var n = poly.Normals[f];
                var kind = poly.Kinds[f];
                var faceShade = R(shadeRng, -0.045f, 0.045f);
                // Each chamfer catches the light a little differently, and leans its normal up a little to catch more of it.
                var glint = R(shadeRng, 0.45f, 1f);
                var lit = Vector3.Normalize(n + Vector3.UnitY * 0.45f);
                var abs = Vector3.Abs(n);
                var axis = abs.X >= abs.Y && abs.X >= abs.Z ? 0 : abs.Y >= abs.Z ? 1 : 2;
                for (var t = 1; t + 1 < face.Count; t++)
                {
                    Vector3 a = face[0], b = face[t], c = face[t + 1];
                    // Buried: all three corners inside one other chunk.
                    if (others.Any(o => o.Outside(a) < -eps && o.Outside(b) < -eps && o.Outside(c) < -eps)) continue;
                    var mid = (a + b + c) / 3;
                    var patch = (noise.At(mid / size * 6f) + 0.5f * noise.At(mid / size * 15f + new Vector3(9))) * 0.25f;
                    var target = snowSub != null && n.Y > snowLimit ? snowSub
                        : mossSub != null && n.Y > mossLimit + patch && mid.Y > lo.Y + height * 0.12f ? mossSub
                        : sub;
                    foreach (var p in new[] { a, b, c })
                    {
                        var uv = axis switch
                        {
                            0 => new Vector2(p.Z * MathF.Sign(n.X), -p.Y),
                            1 => new Vector2(p.X, p.Z * MathF.Sign(n.Y)),
                            _ => new Vector2(-p.X * MathF.Sign(n.Z), -p.Y),
                        } / tile;
                        var up = Math.Clamp((p.Y - lo.Y) / height, 0, 1);
                        var light = 0.66f + 0.18f * up + 0.08f * Math.Clamp(n.Y, 0, 1) + faceShade;
                        // The chamfers: the line of light along every edge, near white.
                        if (kind == 1) light = MathF.Max(light + 0.25f + 0.12f * glint, 0.9f + 0.08f * glint + 0.02f * wear);
                        // Where another chunk is near, the stone is in its shadow (the crack between them).
                        var gap = others.Count == 0 ? contact : MathF.Max(0, others.Min(o => o.Outside(p)));
                        light -= 0.32f * (1 - Math.Clamp(gap / contact, 0, 1));
                        light *= 0.75f + 0.25f * Math.Clamp(up / 0.3f, 0, 1);
                        light = Math.Clamp(light, 0.3f, 1);
                        var facing = Math.Clamp((n.Y - 0.25f) / 0.5f, 0, 1);
                        var cover = (float)r.Moss * facing * facing * Math.Clamp(up * 2.5f, 0, 1) * 0.7f;
                        var mossTint = Vector3.Min(LeafAtlas.Hex(r.MossColor) * 1.7f, Vector3.One);
                        var col = Vector3.Lerp(Vector3.One, mossTint, cover) * light;
                        target.Indices.Add(mesh.AddVertex(p, kind == 1 ? lit : n, uv, new Vector4(col, kind == 1 ? Math.Clamp(0.4f + wear, 0, 1) : 0)));
                    }
                }
            }
        }
        mesh.Submeshes.RemoveAll(x => x.Indices.Count == 0);
        return mesh;
    }
}
