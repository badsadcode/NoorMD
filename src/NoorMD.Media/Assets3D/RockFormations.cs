using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// Rock formations built of chunky blocks: each block a rounded box (or a squashed ball) with chipped corners, turned
/// and placed by the kind's layout; the blocks joined without blending, so where they meet stays a crease, read as a
/// crack. Stylized rocks keep their planes clean; realistic ones get lumps and grit over them.
/// </summary>
public static partial class RockBuilder
{
    /// <summary>A rock's distance field: negative inside, base near y = 0.</summary>
    internal interface IShape
    {
        float Eval(Vector3 p);
        Vector3 Lo { get; }
        Vector3 Hi { get; }
    }

    /// <summary>One block: a rounded box (Round 0) or a squashed ball (Round 1) in its own frame, with flat cuts chipping it.</summary>
    internal sealed class Chunk
    {
        public Vector3 C;
        public Quaternion Q = Quaternion.Identity;
        public Vector3 H;
        public float Bevel;
        public float Round;
        public List<(Vector3 N, float O)> Cuts = [];
        private Quaternion _inv;
        private float _reach;

        public Chunk Ready()
        {
            _inv = Quaternion.Inverse(Q);
            _reach = H.Length() + Bevel;
            return this;
        }

        public float Reach => _reach;

        public float Eval(Vector3 p)
        {
            var q = Vector3.Transform(p - C, _inv);
            var a = Vector3.Abs(q) - H + new Vector3(Bevel);
            var d = Vector3.Max(a, Vector3.Zero).Length() + MathF.Min(MathF.Max(a.X, MathF.Max(a.Y, a.Z)), 0) - Bevel;
            if (Round > 0) d += (Ellipsoid(q, H) - d) * Round;
            foreach (var (n, o) in Cuts) d = SmoothMax(d, Vector3.Dot(q, n) - o, Bevel * 0.7f);
            return d;
        }

        /// <summary>
        /// How far a point is from the block's nearest edge: its distance to the second-nearest of its faces (the box's
        /// sides, or the ball's surface, and the cuts). Small along an edge, large in the middle of a face.
        /// </summary>
        public float Edge(Vector3 p)
        {
            var q = Vector3.Transform(p - C, _inv);
            float first = float.MaxValue, second = float.MaxValue;
            void Face(float m)
            {
                m = MathF.Abs(m);
                if (m < first) { second = first; first = m; }
                else if (m < second) second = m;
            }
            if (Round < 0.4f) { Face(H.X - MathF.Abs(q.X)); Face(H.Y - MathF.Abs(q.Y)); Face(H.Z - MathF.Abs(q.Z)); }
            else Face(Ellipsoid(q, H));
            foreach (var (n, o) in Cuts) Face(o - Vector3.Dot(q, n));
            return second;
        }

        /// <summary>Chips corners off: <paramref name="count"/> cuts in random directions (more up than down), each keeping
        /// <paramref name="keepLo"/>–<paramref name="keepHi"/> of how far the block reaches that way.</summary>
        public Chunk Chip(Random rng, int count, float keepLo, float keepHi, float up = 0.2f)
        {
            for (var i = 0; i < count; i++)
            {
                var n = new Vector3(R(rng, -1, 1), R(rng, -0.4f, 1) + up, R(rng, -1, 1));
                if (n.LengthSquared() < 1e-3f) continue;
                n = Vector3.Normalize(n);
                var reach = MathF.Abs(n.X) * H.X + MathF.Abs(n.Y) * H.Y + MathF.Abs(n.Z) * H.Z;
                Cuts.Add((n, reach * R(rng, keepLo, keepHi)));
            }
            return this;
        }

        /// <summary>A point on top: cuts leaning in from every side, meeting <paramref name="sharp"/> of the way up.</summary>
        public Chunk Point(Random rng, float sharp, int sides = 4)
        {
            var turn = R(rng, 0, MathF.Tau);
            for (var i = 0; i < sides; i++)
            {
                var a = turn + MathF.Tau * i / sides + R(rng, -0.3f, 0.3f);
                var lean = 0.35f + 0.9f * sharp + R(rng, -0.15f, 0.15f);
                var n = Vector3.Normalize(new Vector3(MathF.Cos(a) * lean, 1, MathF.Sin(a) * lean));
                var reach = MathF.Abs(n.X) * H.X + MathF.Abs(n.Y) * H.Y + MathF.Abs(n.Z) * H.Z;
                var keep = 0.82f - 0.42f * sharp;
                Cuts.Add((n, reach * R(rng, keep - 0.06f, keep + 0.06f)));
            }
            return this;
        }
    }

    /// <summary>A formation: blocks joined (barely rounded where they meet, so the cracks between them stay), warped a little, cut flat at the ground.</summary>
    internal sealed class ChunkShape : IShape
    {
        public readonly List<Chunk> Chunks = [];
        private readonly Noise _noise;
        private readonly float _small, _rough, _warp, _join, _wear;
        private readonly bool _stylized;
        public Vector3 Lo { get; private set; }
        public Vector3 Hi { get; private set; }

        public ChunkShape(RockRecipe r)
        {
            _noise = new Noise(r.Seed + 101);
            _stylized = r.Style == "stylized";
            _rough = (float)r.Roughness;
            _wear = (float)r.EdgeWear;
            Layout(r, new Random(r.Seed * 7919 + 29), Chunks);
            foreach (var c in Chunks) c.Ready();
            _small = Chunks.Count == 0 ? 0.1f : Chunks.Select(c => MathF.Min(c.H.X, MathF.Min(c.H.Y, c.H.Z))).OrderBy(v => v).ElementAt(Chunks.Count / 2);
            _warp = _small * (_stylized ? 0.08f : 0.18f);
            // Blocks meet with the slightest rounding: still a crease, but no hair-thin gap for the mesh to pinch.
            _join = _small * 0.06f;
            var lo = new Vector3(float.MaxValue);
            var hi = new Vector3(float.MinValue);
            foreach (var c in Chunks) { lo = Vector3.Min(lo, c.C - new Vector3(c.Reach)); hi = Vector3.Max(hi, c.C + new Vector3(c.Reach)); }
            Lo = Vector3.Max(lo, new Vector3(lo.X, -_small * 0.5f, lo.Z)) - new Vector3(_warp * 2);
            Hi = hi + new Vector3(_warp * 2);
        }

        public float Eval(Vector3 p)
        {
            var f = p / (_small * 3);
            var w = p + new Vector3(_noise.At(f), _noise.At(f + new Vector3(31, 7, 3)), _noise.At(f + new Vector3(5, 19, 47))) * _warp;
            var d = float.MaxValue;
            foreach (var c in Chunks)
            {
                // A block further away than the nearest surface found so far can't be nearer.
                if (Vector3.Distance(w, c.C) - c.Reach > d + _join) continue;
                var e = c.Eval(w);
                // Each block's own edges worn before they are joined (so the field stays smooth across the seams).
                if (_wear > 0 && e < c.Reach * 0.25f) e += Worn(c.Edge(w), MathF.Min(c.H.X, MathF.Min(c.H.Y, c.H.Z)) * 0.5f * _wear, w, _noise, _stylized);
                d = SmoothMin(d, e, _join);
            }
            if (!_stylized)
            {
                d += _noise.Fbm(p / _small * 1.3f, 3) * _small * 0.12f * (0.3f + _rough);
                d += _noise.Fbm(p / _small * 6f + new Vector3(11), 3) * _small * 0.03f * _rough;
            }
            return MathF.Max(d, -p.Y);
        }

        /// <summary>Which block a point belongs to (the nearest surface).</summary>
        public int Owner(Vector3 p)
        {
            var best = 0;
            var bestD = float.MaxValue;
            for (var i = 0; i < Chunks.Count; i++)
            {
                var d = Chunks[i].Eval(p);
                if (d < bestD) { bestD = d; best = i; }
            }
            return best;
        }
    }

    /// <summary>
    /// Edge wear, added to a distance: within <paramref name="width"/> of an edge the edge is rounded off and chipped,
    /// bites taken out where a noise says (big and few when stylized, smaller and many when realistic).
    /// </summary>
    internal static float Worn(float edge, float width, Vector3 p, Noise noise, bool stylized)
    {
        if (width <= 1e-6f || edge >= width) return 0;
        var t = 1 - edge / width;
        t *= t;
        var bite = noise.At(p / (width * (stylized ? 2.4f : 1.8f)) + new Vector3(23, 41, 7)) * 0.5f + 0.5f;
        var chip = Math.Clamp((bite - (stylized ? 0.52f : 0.45f)) / 0.25f, 0, 1);
        return width * t * (0.3f + (stylized ? 0.8f : 0.6f) * chip);
    }

    private static float R(Random rng, float lo, float hi) => lo + (hi - lo) * (float)rng.NextDouble();

    private static Quaternion Turn(float yaw, float tiltX = 0, float tiltZ = 0) =>
        Quaternion.CreateFromAxisAngle(Vector3.UnitY, yaw) * Quaternion.CreateFromAxisAngle(Vector3.UnitX, tiltX) * Quaternion.CreateFromAxisAngle(Vector3.UnitZ, tiltZ);

    private static float Deg(float d) => d * MathF.PI / 180;

    /// <summary>Places a formation's blocks, by kind. Sizes come from the recipe: Size the widest side, Height × Size the height.</summary>
    private static void Layout(RockRecipe r, Random rng, List<Chunk> chunks)
    {
        var S = (float)r.Size;
        var H = (float)(r.Size * r.Height);
        var a = S / 2;
        var b = a / (1 + (float)r.Elongation);
        var stylized = r.Style == "stylized";
        var sharp = (float)r.Taper;
        float Bevel(float size) => size * (stylized ? 0.09f : 0.05f);
        Chunk Block(Vector3 c, Vector3 h, Quaternion q, float round = 0)
        {
            var k = new Chunk { C = c, H = h, Q = q, Round = round, Bevel = Bevel(MathF.Min(h.X, MathF.Min(h.Y, h.Z)) * 2) };
            chunks.Add(k);
            return k;
        }
        int Pieces(int lo, int hi) => r.Pieces > 0 ? r.Pieces : lo + rng.Next(hi - lo + 1);

        switch (r.Kind)
        {
            case "angular":
            {
                // One big block, many flat faces; a few chunks broken off lying at its foot.
                var h = new Vector3(a * 0.82f, H * 0.5f, b * 0.82f);
                Block(new Vector3(0, h.Y * 0.95f, 0), h, Turn(R(rng, 0, MathF.Tau), Deg(R(rng, -7, 7)), Deg(R(rng, -7, 7))), 0.08f).Chip(rng, 7 + rng.Next(3), 0.55f, 0.85f);
                var n = Pieces(2, 4);
                for (var i = 0; i < n; i++)
                {
                    var ang = MathF.Tau * i / n + R(rng, -0.4f, 0.4f);
                    var f = R(rng, 0.22f, 0.42f);
                    var hs = new Vector3(a * f, H * 0.5f * f * 1.1f, a * f * 0.85f);
                    Block(new Vector3(MathF.Cos(ang) * a * 0.9f, hs.Y * 0.8f, MathF.Sin(ang) * b * 0.9f), hs, Turn(R(rng, 0, MathF.Tau), Deg(R(rng, -20, 20)), Deg(R(rng, -20, 20)))).Chip(rng, 4 + rng.Next(3), 0.5f, 0.85f);
                }
                break;
            }
            case "cracked":
            {
                // A mound of blocks, split apart: a ring and a middle on the ground, fewer above, one on top.
                var n = Pieces(8, 11);
                var low = Math.Max(3, (int)(n * 0.6f));
                var size = a * 0.5f;
                for (var i = 0; i < n; i++)
                {
                    Vector3 c;
                    float f;
                    if (i == 0) { c = new Vector3(0, H * 0.32f, 0); f = 1.1f; }
                    else if (i < low)
                    {
                        var ang = MathF.Tau * (i - 1) / (low - 1) + R(rng, -0.25f, 0.25f);
                        c = new Vector3(MathF.Cos(ang) * (a - size * 0.7f), H * 0.25f, MathF.Sin(ang) * (b - size * 0.6f));
                        f = R(rng, 0.8f, 1f);
                    }
                    else if (i < n - 1)
                    {
                        var ang = R(rng, 0, MathF.Tau);
                        c = new Vector3(MathF.Cos(ang) * a * 0.3f, H * 0.62f, MathF.Sin(ang) * b * 0.3f);
                        f = R(rng, 0.65f, 0.85f);
                    }
                    else { c = new Vector3(R(rng, -0.1f, 0.1f) * a, H * 0.8f, 0); f = 0.7f; }
                    var h = new Vector3(size * f, H * 0.3f * f, size * f * 0.9f);
                    // Tilted outwards a little, as blocks settle when a rock splits.
                    var outward = new Vector2(c.X, c.Z);
                    var tilt = outward.LengthSquared() > 1e-6f ? Vector2.Normalize(outward) * Deg(R(rng, 4, 14)) : Vector2.Zero;
                    Block(c, h, Turn(R(rng, -0.4f, 0.4f), tilt.Y, -tilt.X), 0.04f).Chip(rng, 3 + rng.Next(3), 0.62f, 0.9f);
                }
                break;
            }
            case "layered":
            {
                // Slabs in layers, each layer a little smaller and shifted; tilted by the dip (schist breaks out of the
                // ground at an angle, half buried; sandstone lies flat). Thin layers when tilted, with jagged ends.
                var dip = Deg((float)r.Dip);
                var thin = r.Dip > 15;
                var n = Pieces(thin ? 9 : 4, thin ? 13 : 6);
                var t = H / n * (thin ? 1.25f : 1f);
                var frame = Turn(R(rng, 0, MathF.Tau)) * Quaternion.CreateFromAxisAngle(Vector3.UnitZ, dip);
                var shrink = 1f;
                var off = Vector2.Zero;
                for (var i = 0; i < n; i++)
                {
                    // Flat layers step in on every side; tilted ones keep their length and creep up the slope, overhanging.
                    shrink *= thin ? R(rng, 0.93f, 1f) : R(rng, 0.84f, 1f);
                    off += thin ? new Vector2(R(rng, 0.03f, 0.12f) * a, R(rng, -0.05f, 0.05f) * b) : new Vector2(R(rng, -0.12f, 0.12f) * a, R(rng, -0.08f, 0.08f) * b);
                    var split = rng.NextDouble() < (thin ? 0.35 : 0.45);
                    var parts = split ? 2 : 1;
                    var ex = a * shrink * (thin ? 1f : 0.95f);
                    for (var k = 0; k < parts; k++)
                    {
                        var len = parts == 1 ? ex : ex * R(rng, 0.42f, 0.55f);
                        // Two halves overlapping a little: a crack between them, never a hair-thin gap.
                        var along = parts == 1 ? 0 : (k == 0 ? -1 : 1) * (ex - len) * 0.94f;
                        var local = new Vector3(off.X + along, t * (i + 0.5f), off.Y);
                        // A little thicker than the layer, so neighbouring layers overlap (no hair-thin gaps between them).
                        var h = new Vector3(len, t * 0.5f * R(rng, 1.08f, 1.2f), b * shrink * R(rng, 0.85f, 1f));
                        var c = Vector3.Transform(local, frame);
                        var slab = new Chunk { C = c, H = h, Q = frame * Turn(R(rng, -0.08f, 0.08f)), Bevel = t * (thin ? 0.12f : 0.3f), Round = 0 };
                        // Ends broken off unevenly (jagged when tilted).
                        for (var e = 0; e < (thin ? 4 : 2); e++)
                        {
                            var nx = new Vector3(rng.Next(2) == 0 ? -1 : 1, R(rng, -0.6f, 0.6f), R(rng, -0.8f, 0.8f));
                            nx = Vector3.Normalize(nx);
                            var reach = MathF.Abs(nx.X) * h.X + MathF.Abs(nx.Y) * h.Y + MathF.Abs(nx.Z) * h.Z;
                            slab.Cuts.Add((nx, reach * R(rng, 0.7f, 0.95f)));
                        }
                        chunks.Add(slab);
                    }
                }
                // Tilted layers are half buried: sink the whole so the ground cuts across them.
                if (thin)
                {
                    // Buried until about the height asked shows above the ground.
                    var top = chunks.Max(c => c.C.Y + c.H.Length() * 0.6f);
                    var sink = top - H * 1.05f;
                    foreach (var c in chunks) c.C -= new Vector3(0, sink, 0);
                }
                break;
            }
            case "cluster":
            {
                // A tall pointed rock, smaller pointed ones leaning out round it.
                var n = Pieces(4, 6);
                Block(new Vector3(0, H * 0.5f, 0), new Vector3(a * 0.4f, H * 0.5f, b * 0.4f), Turn(R(rng, 0, MathF.Tau), Deg(R(rng, -5, 5)), Deg(R(rng, -5, 5)))).Point(rng, sharp).Chip(rng, 2, 0.6f, 0.85f, -0.3f);
                for (var i = 1; i < n; i++)
                {
                    var ang = MathF.Tau * i / (n - 1) + R(rng, -0.35f, 0.35f);
                    var f = R(rng, 0.38f, 0.75f);
                    var c = new Vector3(MathF.Cos(ang) * a * R(rng, 0.45f, 0.7f), H * 0.5f * f * 0.9f, MathF.Sin(ang) * b * R(rng, 0.45f, 0.7f));
                    var lean = Deg(R(rng, 8, 20));
                    Block(c, new Vector3(a * 0.38f * MathF.Sqrt(f), H * 0.5f * f, b * 0.36f * MathF.Sqrt(f)), Turn(R(rng, 0, MathF.Tau)) * Quaternion.CreateFromAxisAngle(Vector3.Normalize(new Vector3(-MathF.Sin(ang), 0, MathF.Cos(ang))), -lean))
                        .Point(rng, sharp * R(rng, 0.7f, 1.1f)).Chip(rng, 1 + rng.Next(2), 0.6f, 0.85f, -0.3f);
                }
                break;
            }
            case "outcrop":
            {
                // Stepped blocks along the long side, rising to a crest (back row taller), some split across.
                var cols = Pieces(6, 9);
                var crest = R(rng, -0.4f, 0.4f);
                var w = S / cols;
                for (var row = 0; row < 2; row++)
                    for (var i = 0; i < cols - row; i++)
                    {
                        var x = -a + w * (i + 0.5f + row * 0.5f) + R(rng, -0.1f, 0.1f) * w;
                        var u = x / a;
                        var rise = MathF.Exp(-Sq((u - crest) / 0.55f));
                        var top = H * (0.3f + 0.7f * rise) * (row == 0 ? 1 : 0.55f) * R(rng, 0.8f, 1.1f);
                        var z = (row == 0 ? -0.25f : 0.35f) * b;
                        var h = new Vector3(w * 0.55f, top / 2, b * (row == 0 ? 0.55f : 0.42f));
                        var q = Turn(R(rng, -0.1f, 0.1f), Deg(R(rng, -4, 4)), Deg(R(rng, -5, 5)));
                        if (top > H * 0.45f && rng.NextDouble() < 0.5)
                        {
                            // Split across: a lower block and an upper one sitting slightly askew.
                            var cut = R(rng, 0.4f, 0.6f);
                            var lowH = new Vector3(h.X, h.Y * cut, h.Z);
                            Block(new Vector3(x, lowH.Y, z), lowH, q).Chip(rng, 2, 0.75f, 0.92f);
                            var upH = new Vector3(h.X * R(rng, 0.85f, 1f), h.Y * (1 - cut), h.Z * R(rng, 0.85f, 1f));
                            Block(new Vector3(x + R(rng, -0.08f, 0.08f) * w, lowH.Y * 2 + upH.Y, z + R(rng, -0.05f, 0.05f) * b), upH, q * Turn(R(rng, -0.12f, 0.12f))).Chip(rng, 3, 0.6f, 0.9f);
                        }
                        else Block(new Vector3(x, h.Y, z), h, q).Chip(rng, 3, 0.6f, 0.9f);
                    }
                break;
            }
            case "stacked":
            {
                // A blocky base, flat rounded stones balanced on it, each askew.
                var baseH = new Vector3(a * 0.8f, H * 0.22f, b * 0.8f);
                Block(new Vector3(0, baseH.Y, 0), baseH, Turn(R(rng, 0, MathF.Tau), Deg(R(rng, -4, 4)), Deg(R(rng, -4, 4))), 0.15f).Chip(rng, 6, 0.6f, 0.88f);
                var y = baseH.Y * 2;
                var n = Pieces(2, 3);
                for (var i = 0; i < n; i++)
                {
                    var thick = (H - baseH.Y * 2) / n * 0.42f * R(rng, 0.8f, 1f);
                    var f = R(rng, 0.55f, 0.85f);
                    var h = new Vector3(a * 0.7f * f, thick, b * 0.7f * f);
                    var c = new Vector3(R(rng, -0.15f, 0.15f) * a, y + thick * 0.92f, R(rng, -0.12f, 0.12f) * b);
                    Block(c, h, Turn(R(rng, 0, MathF.Tau), Deg(R(rng, -6, 6)), Deg(R(rng, -6, 6))), 0.2f).Chip(rng, 4, 0.65f, 0.9f);
                    y = c.Y + thick * 0.95f;
                }
                break;
            }
            case "pillar":
            {
                // A spire: a cone of tall blocks. The middle one the tallest (in stacked segments, ending in a point),
                // a ring of shorter pointed ones round it, short ones round the foot.
                var segs = 2 + rng.Next(2);
                var y = 0f;
                for (var s = 0; s < segs; s++)
                {
                    var hy = H / segs * 0.5f * (s == segs - 1 ? 1.15f : R(rng, 0.9f, 1f));
                    var f = 1 - 0.16f * s;
                    var seg = Block(new Vector3(R(rng, -0.04f, 0.04f) * a, y + hy, R(rng, -0.04f, 0.04f) * b), new Vector3(a * 0.42f * f, hy, b * 0.4f * f), Turn(R(rng, -0.3f, 0.3f), Deg(R(rng, -3, 3)), Deg(R(rng, -3, 3))));
                    if (s == segs - 1) seg.Point(rng, sharp); else seg.Chip(rng, 2, 0.75f, 0.92f);
                    y += hy * 2 * 0.97f;
                }
                var ring = Pieces(5, 7);
                foreach (var (radius, lo, hi, width) in new[] { (0.5f, 0.45f, 0.8f, 0.32f), (0.85f, 0.14f, 0.3f, 0.3f) })
                {
                    var count = radius < 0.6f ? ring : ring + 2;
                    var turn = R(rng, 0, MathF.Tau);
                    for (var i = 0; i < count; i++)
                    {
                        var ang = turn + MathF.Tau * i / count + R(rng, -0.25f, 0.25f);
                        var f = R(rng, lo, hi);
                        var c = new Vector3(MathF.Cos(ang) * a * radius, H * 0.5f * f, MathF.Sin(ang) * b * radius);
                        // Leaning in towards the middle, as the blocks of a spire do.
                        var lean = Deg(R(rng, 2, 7));
                        Block(c, new Vector3(a * width, H * 0.5f * f, b * width * 0.9f), Turn(R(rng, 0, MathF.Tau)) * Quaternion.CreateFromAxisAngle(Vector3.Normalize(new Vector3(-MathF.Sin(ang), 0, MathF.Cos(ang))), lean))
                            .Point(rng, sharp * R(rng, 0.6f, 1f));
                    }
                }
                break;
            }
            case "arch":
            {
                // Blocks along an arc over an opening, big ones at its feet, a few on top.
                var n = Pieces(9, 12);
                var thick = S * 0.1f;
                var span = a - thick * 1.4f;
                var rise = MathF.Max(H - thick * 1.6f, thick * 2);
                var depth = b * 0.5f;
                for (var i = 0; i < n; i++)
                {
                    var th = MathF.PI * (i + 0.5f) / n;
                    var c = new Vector3(MathF.Cos(th) * span, MathF.Sin(th) * rise + thick * 0.4f, R(rng, -0.08f, 0.08f) * depth);
                    var tangent = new Vector2(-MathF.Sin(th) * span, MathF.Cos(th) * rise);
                    var len = MathF.PI * MathF.Sqrt((span * span + rise * rise) / 2) / n * 0.62f;
                    var turn = MathF.Atan2(tangent.Y, tangent.X);
                    var f = R(rng, 0.9f, 1.15f);
                    Block(c, new Vector3(len, thick * f, depth * R(rng, 0.85f, 1.05f)), Quaternion.CreateFromAxisAngle(Vector3.UnitZ, turn) * Turn(R(rng, -0.12f, 0.12f), Deg(R(rng, -6, 6)), Deg(R(rng, -6, 6)))).Chip(rng, 3, 0.65f, 0.9f);
                }
                foreach (var side in new[] { -1f, 1f })
                {
                    var h = new Vector3(thick * 1.6f, H * 0.28f, depth * 1.2f);
                    Block(new Vector3(side * (span + thick * 0.2f), h.Y, R(rng, -0.1f, 0.1f) * depth), h, Turn(R(rng, -0.3f, 0.3f), Deg(R(rng, -5, 5)), Deg(R(rng, -5, 5)))).Chip(rng, 5, 0.6f, 0.88f);
                }
                for (var i = 0; i < 2; i++)
                {
                    var th = MathF.PI * R(rng, 0.3f, 0.7f);
                    Block(new Vector3(MathF.Cos(th) * span, MathF.Sin(th) * rise + thick * 1.2f, R(rng, -0.2f, 0.2f) * depth), new Vector3(thick * 0.9f, thick * 0.6f, depth * 0.5f), Turn(R(rng, 0, MathF.Tau))).Chip(rng, 3, 0.6f, 0.9f);
                }
                break;
            }
        }
    }

    private static float Sq(float v) => v * v;

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
