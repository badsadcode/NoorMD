using System.Diagnostics;
using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>A built rock: one asset per level of detail (closest first), the first with its collision pieces.</summary>
public sealed class RockBuild
{
    public required RockRecipe Recipe { get; init; }
    public List<Asset3D> Lods { get; } = [];
    /// <summary>Convex collision pieces (also in the first level's file, as "-convcolonly" nodes).</summary>
    public List<Mesh3D> Collision { get; } = [];
    public List<string> Notes { get; } = [];
    /// <summary>The rock's height and widest width above and below the ground, in metres.</summary>
    public float Height { get; set; }
    public float Width { get; set; }
    public double Seconds { get; set; }
}

/// <summary>
/// Turns a rock recipe into game-ready meshes. The shape is a signed distance field (a lumpy ellipsoid, or several
/// melted together for boulders and outcrops, cut by flat fracture planes, with layers, surface noise and a flat
/// base), sampled on a grid and extracted with surface nets, then simplified to each level's triangle budget. Normals
/// are smooth within a face and split at hard edges (faceted when stylized), UVs are projected from the side each face
/// looks to (in metres, so every rock shares one texel density), and moss sits in the vertex colours on upward faces.
/// The pivot is the middle of where it meets the ground; the base reaches a little below it.
/// </summary>
public static class RockBuilder
{
    public sealed class Options
    {
        /// <summary>Texture size in pixels (0 = no textures, plain colour).</summary>
        public int TextureSize { get; init; } = 512;
        /// <summary>Build only the first N levels (the preview needs one).</summary>
        public int? MaxLods { get; init; }
    }

    public static RockBuild Build(RockRecipe recipe, Options? options = null, CancellationToken ct = default)
    {
        options ??= new Options();
        recipe = recipe.Clone();
        var watch = Stopwatch.StartNew();
        var build = new RockBuild { Recipe = recipe };
        var stylized = recipe.Style == "stylized";
        var levels = Math.Min(recipe.Lods, options.MaxLods ?? 3);

        // Dense meshes, then each level simplified from them.
        List<(Mesh3D Mesh, float Scale)> pieces = [];
        if (recipe.Kind == "scree")
        {
            var rng = new Random(recipe.Seed);
            var placed = new List<(Vector2 At, float R)>();
            for (var i = 0; i < recipe.Stones * 6 && placed.Count < recipe.Stones; i++)
            {
                ct.ThrowIfCancellationRequested();
                // Many small, a few larger; denser in the middle of the patch.
                var size = (float)(recipe.Size * (0.05 + 0.12 * Math.Pow(rng.NextDouble(), 2)));
                var a = rng.NextDouble() * Math.Tau;
                var d = (float)(recipe.Size * 0.5 * Math.Pow(rng.NextDouble(), 0.8));
                var at = new Vector2(MathF.Cos((float)a) * d, MathF.Sin((float)a) * d);
                if (placed.Any(p => Vector2.Distance(p.At, at) < (p.R + size * 0.5f) * 0.8f)) continue;
                placed.Add((at, size * 0.5f));
                var stone = new RockRecipe
                {
                    Kind = "stone", Style = recipe.Style, Seed = rng.Next(), Size = size, Height = 0.35 + 0.4 * rng.NextDouble(), Elongation = rng.NextDouble() * 0.6,
                    Roughness = recipe.Roughness, Fractures = 2 + rng.Next(4), FlatBase = true, Sink = 0.25,
                }.Clamped();
                var dense = Dense(stone, 14);
                Place(dense, stone, new Vector3(at.X, 0, at.Y), (float)(rng.NextDouble() * Math.Tau));
                pieces.Add((dense, size));
            }
        }
        else pieces.Add((Dense(recipe, stylized ? 40 : recipe.Kind switch { "stone" => 30, "rock" => 46, _ => 60 }), (float)recipe.Size));
        ct.ThrowIfCancellationRequested();

        // The pivot: the middle of the ground contact, the base reaching Sink × height below it.
        if (recipe.Kind != "scree")
        {
            var m = pieces[0].Mesh;
            var (lo, hi) = m.Bounds();
            var h = hi.Y - lo.Y;
            var low = m.Positions.Where(p => p.Y < lo.Y + h * 0.1f).ToList();
            var c = low.Count > 0 ? low.Aggregate(Vector3.Zero, (s, p) => s + p) / low.Count : (lo + hi) / 2;
            var shift = new Vector3(-c.X, -lo.Y - (float)recipe.Sink * h, -c.Z);
            for (var i = 0; i < m.VertexCount; i++) m.Positions[i] += shift;
        }

        // Materials.
        var rock = new Material3D { Name = "Rock", BaseColor = Color(recipe.Color), Roughness = 0.9f };
        if (options.TextureSize > 0 && recipe.Material != "")
        {
            try
            {
                var maps = TextureEngine.Render(RockTextures.For(recipe.Material, recipe.Color) ?? TexturePresets.Make(recipe.Material), options.TextureSize);
                rock.BaseColor = Vector4.One;
                rock.BaseColorPng = maps.Png("albedo");
                rock.NormalPng = maps.Png("normal");
                rock.OcclusionRoughnessMetallicPng = maps.Packed("ao", "roughness", "metallic");
                rock.Roughness = 1;
            }
            catch (ArgumentException) { build.Notes.Add($"The material \"{recipe.Material}\" was not found; a plain colour is used."); }
        }

        // Snow lies on the faces that look up (its own material, so it stays white whatever the rock's texture).
        var snow = new Material3D { Name = "Snow", BaseColor = Color(recipe.SnowColor), Roughness = 0.65f };

        for (var level = 0; level < levels; level++)
        {
            ct.ThrowIfCancellationRequested();
            var budget = recipe.LevelTriangles(level);
            // Stylized rocks read best as a few big facets: a third of the budget unless the levels are set by hand.
            if (stylized && recipe.LodTriangles.Count <= level) budget = Math.Max(recipe.Kind == "stone" ? 20 : 40, budget / 3);
            var mesh = new Mesh3D { Name = recipe.Kind == "scree" ? "Scree" : "Rock" };
            if (recipe.Kind == "scree")
            {
                // Share the budget by size; the far levels leave out the smallest stones.
                var keep = pieces.OrderByDescending(p => p.Scale).Take(level switch { 0 => pieces.Count, 1 => Math.Max(3, pieces.Count * 2 / 3), _ => Math.Max(3, pieces.Count / 3) }).ToList();
                var total = keep.Sum(p => p.Scale * p.Scale);
                foreach (var (dense, scale) in keep)
                {
                    var part = Copy(dense);
                    Simplifier.Simplify(part, Math.Max(8, (int)(budget * scale * scale / total)));
                    TreeBuilder.Append(mesh, Finish(part, recipe, stylized));
                }
            }
            else
            {
                var part = Copy(pieces[0].Mesh);
                Simplifier.Simplify(part, budget);
                TreeBuilder.Append(mesh, Finish(part, recipe, stylized));
            }
            mesh.ComputeTangents();
            var asset = new Asset3D { Name = recipe.Name };
            asset.Materials.Add(rock);
            if (recipe.Snow > 0) asset.Materials.Add(snow);
            asset.Root = new Node3D { Name = GameProfile.Species(recipe.Name) };
            asset.Root.Children.Add(new Node3D { Name = mesh.Name, Mesh = mesh });
            build.Lods.Add(asset);
        }

        // Collision: convex hulls of the closest level, ≤ 64 triangles each, named for Godot's importer.
        if (recipe.CollisionPieces > 0 && recipe.Kind != "scree" && build.Lods.Count > 0)
        {
            var src = build.Lods[0].Root.Children[0].Mesh!.Positions;
            foreach (var hull in Hulls(src, recipe.CollisionPieces))
            {
                hull.Name = build.Collision.Count == 0 ? "Collision" : $"Collision{build.Collision.Count + 1}";
                build.Collision.Add(hull);
                build.Lods[0].Root.Children.Add(new Node3D { Name = hull.Name + "-convcolonly", Mesh = hull, Extras = new() { ["noor_collision"] = "convex" } });
            }
        }

        var (blo, bhi) = build.Lods[0].Root.Children[0].Mesh!.Bounds();
        build.Height = bhi.Y - blo.Y;
        build.Width = MathF.Max(bhi.X - blo.X, bhi.Z - blo.Z);
        build.Seconds = watch.Elapsed.TotalSeconds;
        return build;
    }

    // ---- The shape ----

    /// <summary>The rock's signed distance field (metres, negative inside), in its own frame: base near y = 0.</summary>
    private sealed class Shape
    {
        private readonly List<(Vector3 C, Vector3 R)> _blobs = [];
        private readonly List<(Vector3 N, float D)> _cuts = [];
        private readonly Noise _noise;
        private readonly float _rough, _strata, _layer, _base, _small, _blend, _edge;
        private readonly bool _flat, _stylized;
        public Vector3 Lo, Hi;

        public Shape(RockRecipe r)
        {
            var rng = new Random(r.Seed * 7919 + 13);
            _noise = new Noise(r.Seed);
            _stylized = r.Style == "stylized";
            var outcrop = r.Kind == "outcrop";
            // Half-sizes: X the long side, Z the short one, Y the height.
            var ax = (float)r.Size / 2;
            var az = ax / (1 + (float)r.Elongation);
            var ay = (float)(r.Size * r.Height) / 2 * (outcrop ? 0.8f : 1);
            _small = MathF.Min(ax, MathF.Min(ay, az));
            var main = new Vector3(ax, ay, az) * (outcrop ? 0.62f : 0.9f);
            _blobs.Add((new Vector3(0, ay, 0), main));
            // Boulders and outcrops are lumpier: a few more pieces melted in, along the long side mostly.
            var extra = r.Kind switch { "outcrop" => 4 + rng.Next(3), "boulder" => 1 + rng.Next(2), "rock" => rng.Next(2), _ => 0 };
            for (var i = 0; i < extra; i++)
            {
                var along = (float)(rng.NextDouble() * 2 - 1);
                var c = new Vector3(along * ax * 0.55f, ay * (outcrop ? 0.55f + 0.5f * (float)rng.NextDouble() : 0.8f + 0.3f * (float)rng.NextDouble()), (float)(rng.NextDouble() * 2 - 1) * az * 0.45f);
                var s = 0.45f + 0.3f * (float)rng.NextDouble();
                _blobs.Add((c, new Vector3(ax, ay, az) * new Vector3(s, s * (outcrop ? 1.1f : 0.9f), s)));
            }
            _blend = _small * 0.45f;
            // Fracture planes: flat broken faces, more on the sides and top than below.
            for (var i = 0; i < r.Fractures; i++)
            {
                var n = new Vector3((float)(rng.NextDouble() * 2 - 1), (float)(rng.NextDouble() * 1.3 - 0.35), (float)(rng.NextDouble() * 2 - 1));
                if (n.LengthSquared() < 1e-4f) n = Vector3.UnitX;
                n = Vector3.Normalize(n);
                // How far the shape reaches that way (the ellipsoid's support), and a cut 55–85 % of it.
                var e = MathF.Sqrt(Sq(ax * n.X) + Sq(ay * n.Y) + Sq(az * n.Z));
                var depth = _stylized ? 0.55f + 0.25f * (float)rng.NextDouble() : 0.5f + 0.3f * (float)rng.NextDouble();
                _cuts.Add((n, Vector3.Dot(new Vector3(0, ay, 0), n) + e * depth));
            }
            _rough = (float)r.Roughness;
            _strata = (float)r.Strata;
            _layer = MathF.Max(ay * 2 / (5 + rng.Next(5)), 0.02f);
            _flat = r.FlatBase;
            _base = ay * 0.12f;
            _edge = _stylized ? _small * 0.01f : _small * 0.06f * (1 - _rough * 0.6f);
            Lo = new Vector3(-ax * 1.25f, -ay * 0.2f, -az * 1.35f);
            Hi = new Vector3(ax * 1.25f, ay * 2.3f, az * 1.35f);
        }

        public float Eval(Vector3 p)
        {
            // Warp the space a little so nothing is a perfect ellipsoid.
            var w = p + new Vector3(_noise.At(p / _small * 0.7f), _noise.At(p / _small * 0.7f + new Vector3(31, 7, 3)), _noise.At(p / _small * 0.7f + new Vector3(5, 19, 47))) * _small * 0.3f;
            var d = float.MaxValue;
            foreach (var (c, r) in _blobs) d = SmoothMin(d, Ellipsoid(w - c, r), _blend);
            // Big lumps, then fine grit (both scaled by roughness).
            if (!_stylized) d += _noise.Fbm(p / _small * 1.6f, 4) * _small * 0.13f * (0.25f + _rough);
            foreach (var (n, o) in _cuts) d = SmoothMax(d, Vector3.Dot(w, n) - o, _edge);
            if (_strata > 0)
            {
                // Ledges: each layer sticks out or steps in by its own amount, with a sharp lip.
                var t = p.Y / _layer;
                var layer = MathF.Floor(t);
                var lip = t - layer;
                var step = _noise.At(new Vector3(layer * 3.7f, 0.5f, 1.3f)) * 0.5f + 0.5f;
                d += _strata * _small * 0.16f * (step + 0.6f * Smooth(0.7f, 1f, lip)) - _strata * _small * 0.1f;
            }
            if (!_stylized) d += _noise.Fbm(p / _small * 7f + new Vector3(11), 3) * _small * 0.035f * _rough;
            if (_flat) d = SmoothMax(d, _base - p.Y, _small * 0.04f);
            return d;
        }

        private static float Sq(float v) => v * v;
        private static float Smooth(float a, float b, float x) { var t = Math.Clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

        /// <summary>An ellipsoid's distance (Inigo Quilez's bound: good near the surface).</summary>
        private static float Ellipsoid(Vector3 p, Vector3 r)
        {
            var k0 = (p / r).Length();
            var k1 = (p / (r * r)).Length();
            return k1 < 1e-9f ? -MathF.Min(r.X, MathF.Min(r.Y, r.Z)) : k0 * (k0 - 1) / k1;
        }

        private static float SmoothMin(float a, float b, float k)
        {
            if (a == float.MaxValue) return b;
            var h = Math.Clamp(0.5f + 0.5f * (b - a) / k, 0, 1);
            return b + (a - b) * h - k * h * (1 - h);
        }

        private static float SmoothMax(float a, float b, float k) => k <= 1e-6f ? MathF.Max(a, b) : -SmoothMin(-a, -b, k);
    }

    /// <summary>The rock's dense surface, about <paramref name="cells"/> grid cells across its widest side.</summary>
    private static Mesh3D Dense(RockRecipe r, int cells)
    {
        var shape = new Shape(r);
        var span = shape.Hi - shape.Lo;
        var cell = MathF.Max(span.X, MathF.Max(span.Y, span.Z)) / cells;
        int nx = (int)MathF.Ceiling(span.X / cell) + 3, ny = (int)MathF.Ceiling(span.Y / cell) + 3, nz = (int)MathF.Ceiling(span.Z / cell) + 3;
        var origin = shape.Lo - new Vector3(cell);
        var v = new float[nx * ny * nz];
        Parallel.For(0, nz, z =>
        {
            for (var y = 0; y < ny; y++)
                for (var x = 0; x < nx; x++)
                {
                    // The outermost layer is always outside, so the surface is closed.
                    var edge = x == 0 || y == 0 || z == 0 || x == nx - 1 || y == ny - 1 || z == nz - 1;
                    v[(z * ny + y) * nx + x] = edge ? cell : shape.Eval(origin + new Vector3(x, y, z) * cell);
                }
        });
        return SurfaceNets(v, nx, ny, nz, origin, cell, "Rock");
    }

    /// <summary>Surface nets: a vertex in every cell the surface crosses, a quad across every crossed grid edge.</summary>
    internal static Mesh3D SurfaceNets(float[] v, int nx, int ny, int nz, Vector3 origin, float cell, string name)
    {
        var mesh = new Mesh3D { Name = name };
        var sub = mesh.Sub(0);
        var index = new Dictionary<int, int>();
        int Id(int x, int y, int z) => (z * ny + y) * nx + x;
        float At(int x, int y, int z) => v[Id(x, y, z)];
        (int, int, int, int, int, int)[] edges =
        [
            (0, 0, 0, 1, 0, 0), (0, 1, 0, 1, 1, 0), (0, 0, 1, 1, 0, 1), (0, 1, 1, 1, 1, 1),
            (0, 0, 0, 0, 1, 0), (1, 0, 0, 1, 1, 0), (0, 0, 1, 0, 1, 1), (1, 0, 1, 1, 1, 1),
            (0, 0, 0, 0, 0, 1), (1, 0, 0, 1, 0, 1), (0, 1, 0, 0, 1, 1), (1, 1, 0, 1, 1, 1),
        ];
        int Vertex(int x, int y, int z)
        {
            var key = Id(x, y, z);
            if (index.TryGetValue(key, out var i)) return i;
            var sum = Vector3.Zero;
            var count = 0;
            foreach (var (ax, ay, az, bx, by, bz) in edges)
            {
                float a = At(x + ax, y + ay, z + az), b = At(x + bx, y + by, z + bz);
                if (a < 0 == b < 0) continue;
                var t = a / (a - b);
                sum += Vector3.Lerp(new Vector3(x + ax, y + ay, z + az), new Vector3(x + bx, y + by, z + bz), t);
                count++;
            }
            var p = origin + (count > 0 ? sum / count : new Vector3(x + 0.5f, y + 0.5f, z + 0.5f)) * cell;
            i = mesh.AddVertex(p, Vector3.UnitY, Vector2.Zero);
            index[key] = i;
            return i;
        }
        void Quad(int a, int b, int c, int d, bool flip)
        {
            if (flip) sub.Indices.AddRange([a, c, b, a, d, c]);
            else sub.Indices.AddRange([a, b, c, a, c, d]);
        }
        for (var z = 1; z < nz - 1; z++)
            for (var y = 1; y < ny - 1; y++)
                for (var x = 1; x < nx - 1; x++)
                {
                    var inside = At(x, y, z) < 0;
                    // The +X edge from (x,y,z): the four cells around it share it.
                    if (inside != At(x + 1, y, z) < 0)
                        Quad(Vertex(x, y - 1, z - 1), Vertex(x, y, z - 1), Vertex(x, y, z), Vertex(x, y - 1, z), !inside);
                    if (inside != At(x, y + 1, z) < 0)
                        Quad(Vertex(x - 1, y, z - 1), Vertex(x - 1, y, z), Vertex(x, y, z), Vertex(x, y, z - 1), !inside);
                    if (inside != At(x, y, z + 1) < 0)
                        Quad(Vertex(x - 1, y - 1, z), Vertex(x, y - 1, z), Vertex(x, y, z), Vertex(x - 1, y, z), !inside);
                }
        return mesh;
    }

    /// <summary>Turns and moves a stone into a scree patch.</summary>
    private static void Place(Mesh3D m, RockRecipe stone, Vector3 at, float yaw)
    {
        var (lo, hi) = m.Bounds();
        var sink = (hi.Y - lo.Y) * (float)stone.Sink;
        var centre = new Vector3((lo.X + hi.X) / 2, lo.Y + sink, (lo.Z + hi.Z) / 2);
        var q = Quaternion.CreateFromAxisAngle(Vector3.UnitY, yaw);
        for (var i = 0; i < m.VertexCount; i++) m.Positions[i] = Vector3.Transform(m.Positions[i] - centre, q) + at;
    }

    // ---- Surface: normals, UVs, colours ----

    /// <summary>
    /// The finished level: normals smooth across gentle bends and split at hard edges (every face its own when
    /// stylized), UVs projected from the side a face looks to, moss and a darker foot in the vertex colours.
    /// </summary>
    private static Mesh3D Finish(Mesh3D m, RockRecipe r, bool stylized)
    {
        var faces = new List<(int A, int B, int C, Vector3 N)>();
        foreach (var s in m.Submeshes)
            for (var i = 0; i + 2 < s.Indices.Count; i += 3)
            {
                int a = s.Indices[i], b = s.Indices[i + 1], c = s.Indices[i + 2];
                var n = Vector3.Cross(m.Positions[b] - m.Positions[a], m.Positions[c] - m.Positions[a]);
                faces.Add((a, b, c, n));
            }
        var around = new List<int>[m.VertexCount];
        for (var f = 0; f < faces.Count; f++)
            foreach (var v in new[] { faces[f].A, faces[f].B, faces[f].C }) (around[v] ??= []).Add(f);
        var (lo, hi) = m.Bounds();
        var height = MathF.Max(hi.Y - lo.Y, 1e-4f);
        var tile = (float)r.TileMetres;
        var moss = LeafAtlas.Hex(r.MossColor) * 1.7f;
        // Hard edges: faces bent further than this from each other don't share a normal.
        var crease = MathF.Cos((stylized ? 0 : 48) * MathF.PI / 180);

        var outMesh = new Mesh3D { Name = m.Name };
        var sub = outMesh.Sub(0);
        var snowSub = r.Snow > 0 ? outMesh.Sub(1) : null;
        // Faces steeper than this from straight up stay bare (more snow, flatter limit).
        var snowLimit = 0.97f - 0.5f * (float)r.Snow;
        var made = new Dictionary<(int V, int Axis, Vector3 N), int>();
        foreach (var (a, b, c, fn) in faces)
        {
            var unit = fn.LengthSquared() > 1e-24f ? Vector3.Normalize(fn) : Vector3.UnitY;
            // The side this face looks to picks its projection; the whole triangle uses the same one.
            var abs = Vector3.Abs(unit);
            var axis = abs.X >= abs.Y && abs.X >= abs.Z ? 0 : abs.Y >= abs.Z ? 1 : 2;
            var target = snowSub != null && unit.Y > snowLimit ? snowSub : sub;
            foreach (var v in new[] { a, b, c })
            {
                var n = Vector3.Zero;
                if (stylized) n = unit;
                else
                    foreach (var f in around[v])
                    {
                        var other = faces[f].N;
                        if (other.LengthSquared() < 1e-24f) continue;
                        if (Vector3.Dot(Vector3.Normalize(other), unit) >= crease) n += other;
                    }
                n = n.LengthSquared() > 1e-24f ? Vector3.Normalize(n) : unit;
                // Round so corners whose normals came out the same share a vertex.
                var key = (v, axis, new Vector3(MathF.Round(n.X, 3), MathF.Round(n.Y, 3), MathF.Round(n.Z, 3)));
                if (!made.TryGetValue(key, out var id))
                {
                    var p = m.Positions[v];
                    var uv = axis switch
                    {
                        0 => new Vector2(p.Z * MathF.Sign(unit.X), -p.Y),
                        1 => new Vector2(p.X, p.Z * MathF.Sign(unit.Y)),
                        _ => new Vector2(-p.X * MathF.Sign(unit.Z), -p.Y),
                    } / tile;
                    // Moss on what faces up, thinning towards the ground; the foot a little darker (dirt, shade).
                    var up = Math.Clamp((n.Y - 0.35f) / 0.5f, 0, 1);
                    var cover = (float)r.Moss * up * up * Math.Clamp((p.Y - lo.Y) / height * 2.5f, 0, 1);
                    var foot = 0.72f + 0.28f * Math.Clamp((p.Y - lo.Y) / (height * 0.35f), 0, 1);
                    var col = Vector3.Lerp(Vector3.One, Vector3.Min(moss, Vector3.One), cover) * foot;
                    id = outMesh.AddVertex(p, n, uv, new Vector4(col, 1));
                    made[key] = id;
                }
                target.Indices.Add(id);
            }
        }
        if (snowSub is { Indices.Count: 0 }) outMesh.Submeshes.Remove(snowSub);
        return outMesh;
    }

    // ---- Collision ----

    /// <summary>Convex pieces covering the points: slices along the longest side, each a hull of at most 34 points (≤ 64 triangles).</summary>
    internal static List<Mesh3D> Hulls(IReadOnlyList<Vector3> points, int pieces)
    {
        var result = new List<Mesh3D>();
        if (points.Count < 4) return result;
        var lo = points.Aggregate(new Vector3(float.MaxValue), Vector3.Min);
        var hi = points.Aggregate(new Vector3(float.MinValue), Vector3.Max);
        var span = hi - lo;
        var axis = span.X >= span.Z ? Vector3.UnitX : Vector3.UnitZ;
        var a0 = Vector3.Dot(lo, axis);
        var len = MathF.Max(Vector3.Dot(span, axis), 1e-4f);
        for (var k = 0; k < pieces; k++)
        {
            // Each slice overlaps its neighbours a little, so the pieces leave no gaps.
            var from = a0 + len * k / pieces - len * 0.04f;
            var to = a0 + len * (k + 1) / pieces + len * 0.04f;
            var slice = points.Where(p => { var t = Vector3.Dot(p, axis); return t >= from && t <= to; }).Distinct().ToList();
            // The full hull, cut down to at most 34 of its own corners: from a few spread ones, the corner sticking out
            // furthest is added until none sticks out by more than a hair (each corner kept is where it matters most).
            var full = ConvexHull(slice);
            if (full == null) continue;
            var all = full.Positions.ToList();
            var size = (all.Aggregate(new Vector3(float.MinValue), Vector3.Max) - all.Aggregate(new Vector3(float.MaxValue), Vector3.Min)).Length();
            var corners = Farthest(all, Math.Min(6, all.Count));
            var hull = ConvexHull(corners);
            while (hull != null && corners.Count < Math.Min(34, all.Count))
            {
                var worst = all.MaxBy(q => Outside(hull, q));
                if (Outside(hull, worst) < size * 0.004f) break;
                corners.Add(worst);
                hull = ConvexHull(corners) ?? hull;
            }
            if (hull == null) continue;
            result.Add(hull);
        }
        return result;
    }

    /// <summary>How far a point is outside a convex hull (its furthest face plane; 0 or less inside).</summary>
    private static float Outside(Mesh3D hull, Vector3 p)
    {
        var worst = float.MinValue;
        var s = hull.Submeshes[0].Indices;
        for (var t = 0; t + 2 < s.Count; t += 3)
        {
            Vector3 a = hull.Positions[s[t]], b = hull.Positions[s[t + 1]], c = hull.Positions[s[t + 2]];
            var n = Vector3.Cross(b - a, c - a);
            if (n.LengthSquared() < 1e-20f) continue;
            worst = MathF.Max(worst, Vector3.Dot(p - a, Vector3.Normalize(n)));
        }
        return worst;
    }

    /// <summary>The <paramref name="count"/> points that spread furthest (the first the furthest from the middle).</summary>
    private static List<Vector3> Farthest(List<Vector3> points, int count)
    {
        var distinct = points.Distinct().ToList();
        if (distinct.Count <= count) return distinct;
        var centre = distinct.Aggregate(Vector3.Zero, (s, p) => s + p) / distinct.Count;
        var chosen = new List<Vector3> { distinct.MaxBy(p => Vector3.DistanceSquared(p, centre)) };
        var near = distinct.Select(p => Vector3.DistanceSquared(p, chosen[0])).ToArray();
        while (chosen.Count < count)
        {
            var best = 0;
            for (var i = 1; i < near.Length; i++) if (near[i] > near[best]) best = i;
            chosen.Add(distinct[best]);
            for (var i = 0; i < near.Length; i++) near[i] = MathF.Min(near[i], Vector3.DistanceSquared(distinct[i], distinct[best]));
        }
        return chosen;
    }

    /// <summary>A convex hull (incremental: each point removes the faces it sees and closes the hole with new ones).</summary>
    internal static Mesh3D? ConvexHull(List<Vector3> pts)
    {
        if (pts.Count < 4) return null;
        var eps = 1e-6f * (pts.Aggregate(new Vector3(float.MinValue), Vector3.Max) - pts.Aggregate(new Vector3(float.MaxValue), Vector3.Min)).Length();
        // A first tetrahedron of four points not in one plane.
        int i0 = 0, i1 = -1, i2 = -1, i3 = -1;
        for (var i = 1; i < pts.Count && i1 < 0; i++) if (Vector3.Distance(pts[i], pts[i0]) > eps) i1 = i;
        if (i1 < 0) return null;
        for (var i = 1; i < pts.Count && i2 < 0; i++)
            if (Vector3.Cross(pts[i1] - pts[i0], pts[i] - pts[i0]).Length() > eps * eps * 10) i2 = i;
        if (i2 < 0) return null;
        var n0 = Vector3.Cross(pts[i1] - pts[i0], pts[i2] - pts[i0]);
        var best = 0f;
        for (var i = 1; i < pts.Count; i++)
        {
            var d = MathF.Abs(Vector3.Dot(pts[i] - pts[i0], n0));
            if (d > best) { best = d; i3 = i; }
        }
        if (i3 < 0 || best < eps * eps * 1e-3f) return null;
        var faces = new List<(int A, int B, int C)>();
        void Add(int a, int b, int c, Vector3 inside)
        {
            var n = Vector3.Cross(pts[b] - pts[a], pts[c] - pts[a]);
            faces.Add(Vector3.Dot(n, inside - pts[a]) > 0 ? (a, c, b) : (a, b, c));
        }
        var mid = (pts[i0] + pts[i1] + pts[i2] + pts[i3]) / 4;
        Add(i0, i1, i2, mid); Add(i0, i1, i3, mid); Add(i0, i2, i3, mid); Add(i1, i2, i3, mid);
        for (var p = 0; p < pts.Count; p++)
        {
            if (p == i0 || p == i1 || p == i2 || p == i3) continue;
            var seen = new List<int>();
            for (var f = 0; f < faces.Count; f++)
            {
                var (a, b, c) = faces[f];
                var n = Vector3.Normalize(Vector3.Cross(pts[b] - pts[a], pts[c] - pts[a]));
                if (Vector3.Dot(n, pts[p] - pts[a]) > eps) seen.Add(f);
            }
            if (seen.Count == 0) continue;
            // The horizon: edges of seen faces whose other side isn't seen.
            var edges = new HashSet<(int, int)>();
            foreach (var f in seen)
            {
                var (a, b, c) = faces[f];
                foreach (var e in new[] { (a, b), (b, c), (c, a) })
                    if (!edges.Remove((e.Item2, e.Item1))) edges.Add(e);
            }
            foreach (var f in seen.OrderByDescending(f => f)) faces.RemoveAt(f);
            foreach (var (a, b) in edges) faces.Add((a, b, p));
        }
        var mesh = new Mesh3D { Name = "Collision" };
        var sub = mesh.Sub(0);
        var map = new Dictionary<int, int>();
        foreach (var (a, b, c) in faces)
            foreach (var v in new[] { a, b, c })
            {
                if (!map.TryGetValue(v, out var id)) map[v] = id = mesh.AddVertex(pts[v], Vector3.UnitY, Vector2.Zero);
                sub.Indices.Add(id);
            }
        mesh.ComputeNormals();
        return mesh;
    }

    // ---- Helpers ----

    private static Mesh3D Copy(Mesh3D m)
    {
        var c = new Mesh3D { Name = m.Name };
        c.Positions.AddRange(m.Positions);
        foreach (var s in m.Submeshes) c.Sub(s.Material).Indices.AddRange(s.Indices);
        return c;
    }

    private static Vector4 Color(string hex)
    {
        var c = LeafAtlas.Hex(hex);
        static float Lin(float v) => v <= 0.04045f ? v / 12.92f : MathF.Pow((v + 0.055f) / 1.055f, 2.4f);
        return new Vector4(Lin(c.X), Lin(c.Y), Lin(c.Z), 1);
    }

    /// <summary>Smooth 3D value noise (−1 … 1) with a seed.</summary>
    private sealed class Noise(int seed)
    {
        private readonly uint _seed = (uint)seed * 2654435761u + 0x9e3779b9u;

        private float Hash(int x, int y, int z)
        {
            var h = _seed ^ (uint)x * 0x8da6b343u ^ (uint)y * 0xd8163841u ^ (uint)z * 0xcb1ab31fu;
            h ^= h >> 13; h *= 0x5bd1e995u; h ^= h >> 15;
            return (h & 0xffffff) / (float)0x800000 - 1;
        }

        public float At(Vector3 p)
        {
            int x = (int)MathF.Floor(p.X), y = (int)MathF.Floor(p.Y), z = (int)MathF.Floor(p.Z);
            float fx = p.X - x, fy = p.Y - y, fz = p.Z - z;
            fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
            float L(float a, float b, float t) => a + (b - a) * t;
            return L(L(L(Hash(x, y, z), Hash(x + 1, y, z), fx), L(Hash(x, y + 1, z), Hash(x + 1, y + 1, z), fx), fy),
                     L(L(Hash(x, y, z + 1), Hash(x + 1, y, z + 1), fx), L(Hash(x, y + 1, z + 1), Hash(x + 1, y + 1, z + 1), fx), fy), fz);
        }

        public float Fbm(Vector3 p, int octaves)
        {
            float sum = 0, amp = 0.5f;
            for (var o = 0; o < octaves; o++) { sum += At(p) * amp; p = p * 2.03f + new Vector3(17.1f, 3.3f, 9.7f); amp *= 0.5f; }
            return sum;
        }
    }
}
