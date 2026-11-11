using System.Diagnostics;
using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>
/// Grass tufts (the "grass" archetype): blades rising from a small patch of ground, each a tapered, curving strip that
/// bends over towards its tip, or crossed cards showing painted blades (cheaper, the realistic far look). Stalks can
/// carry heads: seeds (wheat, foxtail), flowers (wildflowers, lavender), plumes (pampas) or cattails (reeds). Every
/// level of detail keeps the tuft's outline: fewer, wider blades with fewer segments farther away. Wind data as on
/// trees (no trunk sway; bend growing up each blade, a little flutter, a phase per blade), so the same shaders move it.
/// </summary>
public static class GrassBuilder
{
    private const string Straw = "#cfbd84";

    public static TreeBuild Build(TreeRecipe recipe, TreeBuilder.Options options, CancellationToken ct = default)
    {
        var watch = Stopwatch.StartNew();
        recipe = recipe.Clone();
        var bare = recipe.Clone();
        bare.Levels = [];
        var sk = TreeSkeleton.Grow(bare);
        var build = new TreeBuild { Recipe = recipe, Skeleton = sk };
        var stylized = recipe.Style == "stylized";
        var glow = (float)recipe.Glow;
        var tex = options.TextureSize;

        // Materials: the blades (a gradient up each blade, or painted cards), the heads and the flowers' centres.
        var cards = recipe.GrassMode == "cards";
        var leaves = recipe.GrassMode == "leaves";
        var grass = new Material3D { Name = leaves ? "Leaves" : "Grass", Roughness = stylized ? 0.8f : 0.7f, DoubleSided = !cards, Transmission = 0.3f };
        if (leaves)
        {
            // Each blade shows one leaf sprite (a frond, a broad leaf…), drawn as the trees' leaves are.
            grass.Alpha = "mask"; grass.AlphaCutoff = 0.5f;
            var size = tex > 0 ? Math.Min(1024, tex) : 128;
            var px = Pixelate(recipe, recipe.LeafShape == "frond" ? FrondPixels(recipe, size) : LeafAtlas.Pixels(recipe.LeafShape, recipe.LeafColor, recipe.LeafColor2, stylized, size, recipe.Seed, "twig"), 2);
            if (tex > 0) { Use(grass, px); (grass.NormalPng, grass.OcclusionRoughnessMetallicPng) = LeafAtlas.Maps(px); grass.Roughness = 1; }
            else grass.BaseColor = Linear(recipe.LeafColor);
        }
        else if (cards)
        {
            grass.Alpha = "mask"; grass.AlphaCutoff = 0.5f;
            var size = tex > 0 ? Math.Min(1024, tex) : 128;
            var px = Pixelate(recipe, recipe.CardArt switch { "bush" => BushPixels(recipe, size), "fronds" => FrondPixels(recipe, size), _ => CardPixels(recipe, size) }, 2);
            if (tex > 0) { Use(grass, px); (grass.NormalPng, grass.OcclusionRoughnessMetallicPng) = LeafAtlas.Maps(px); grass.Roughness = 1; }
            else grass.BaseColor = Linear(recipe.LeafColor);
        }
        else if (tex > 0) Use(grass, recipe.Pixels > 0 ? PixelBlades(recipe) : BladePixels(recipe));
        else grass.BaseColor = Linear(recipe.LeafColor);
        if (glow > 0) grass.Emissive = Lin3(recipe.LeafColor2) * glow * 0.5f;
        // Cards are about few triangles: their heads (seeds, flowers…) are painted on the picture, not modelled.
        var heads = recipe.Heads != "none" && recipe.HeadCount > 0 && !cards;
        var headMat = new Material3D { Name = "Heads", BaseColor = Linear(recipe.HeadColor), Roughness = recipe.Heads == "flowers" ? 0.55f : 0.85f, DoubleSided = true, Emissive = Lin3(recipe.HeadColor) * glow * 0.7f };
        var centreMat = new Material3D { Name = "Head centres", DoubleSided = true, BaseColor = Linear(recipe.HeadColor2), Roughness = 0.7f, Emissive = Lin3(recipe.HeadColor2) * glow * 0.5f };
        var flowers = heads && recipe.Heads == "flowers";
        if (recipe.Pixels > 0 || recipe.SharpPixels) grass.Nearest = true;

        var lodCount = Math.Min(recipe.Lods, options.MaxLods ?? recipe.Lods);
        for (var lod = 0; lod < lodCount; lod++)
        {
            ct.ThrowIfCancellationRequested();
            var asset = new Asset3D { Name = recipe.Lods > 1 ? $"{recipe.Name}_LOD{lod}" : recipe.Name };
            asset.Materials.Add(grass);
            int headIndex = -1, centreIndex = -1;
            if (heads) { asset.Materials.Add(headMat); headIndex = asset.Materials.Count - 1; }
            if (flowers) { asset.Materials.Add(centreMat); centreIndex = asset.Materials.Count - 1; }
            asset.Root = new Node3D { Name = asset.Name };
            var m = new Mesh3D { Name = "Grass" };
            var rng = new Random(recipe.Seed * 9973 + 17);   // the same tuft on every level: the same blades, fewer kept
            var made = cards ? AddCards(m, recipe, lod, rng) : AddBlades(m, recipe, lod, rng, Budget(recipe, lod), stylized);
            if (heads) AddHeads(m, recipe, lod, new Random(recipe.Seed * 31 + 5), headIndex, centreIndex, stylized);
            if (lod == 0) build.Notes.Add(cards ? $"{made} crossed cards ({m.TriangleCount} triangles{(recipe.Heads != "none" && recipe.HeadCount > 0 ? $", the {recipe.Heads} painted on" : "")})." : $"{made} blades{(heads ? $", {recipe.HeadCount} {recipe.Heads}" : "")}.");
            WindToUv(m, recipe);
            Shade(m, recipe);
            if (grass.NormalPng != null && m.VertexCount > 0) m.ComputeTangents();
            asset.Root.Children.Add(new Node3D { Name = "Grass", Mesh = m });
            build.Lods.Add(asset);
        }
        build.Seconds = watch.Elapsed.TotalSeconds;
        return build;
    }

    /// <summary>The triangles a level may use (0: no limit beyond the blade count).</summary>
    private static int Budget(TreeRecipe r, int lod)
    {
        if (r.LodTriangles.Count > 0) return lod < r.LodTriangles.Count ? r.LodTriangles[lod] : r.LodTriangles[^1] >> (lod - r.LodTriangles.Count + 1);
        return r.TriangleTarget > 0 ? r.TriangleTarget >> lod : 0;
    }

    // ---- Blades ----

    private sealed record Blade(Vector3 Base, float Azimuth, float Height, float Width, float Tilt, float Droop, float Curl, float Phase, float Keep);

    /// <summary>Every blade of the tuft, the same on every level (a level keeps those whose Keep is under its share).</summary>
    private static List<Blade> Blades(TreeRecipe r, Random rng, int count)
    {
        var list = new List<Blade>(count);
        var lean = (float)(r.Lean * Math.PI / 180);
        for (var i = 0; i < count; i++)
        {
            var a = (float)(rng.NextDouble() * Math.PI * 2);
            var d = (float)(Math.Sqrt(rng.NextDouble()) * r.Spread);
            var p = new Vector3(MathF.Cos(a) * d, 0, MathF.Sin(a) * d);
            // Outer blades lean out more; the middle ones stand up (a tuft's fountain shape).
            var outward = r.Spread > 1e-6 ? d / (float)r.Spread : 0.5f;
            var tilt = (float)(r.Splay * Math.PI / 180) * (0.25f + 0.95f * outward) * (0.7f + 0.6f * (float)rng.NextDouble()) + lean * 0.5f;
            var az = a + (float)(rng.NextDouble() - 0.5) * 0.9f;
            var h = (float)(r.Height * (1 - r.HeightSpread * rng.NextDouble()));
            var w = (float)(r.BladeWidth * (0.7 + 0.6 * rng.NextDouble()));
            var droop = (float)(r.Droop * (0.6 + 0.8 * rng.NextDouble()));
            var curl = (float)(r.Curl * (rng.NextDouble() * 2 - 1));
            list.Add(new Blade(p, az, h, w, tilt, droop, curl, (float)rng.NextDouble(), (float)rng.NextDouble()));
        }
        return list;
    }

    private static int AddBlades(Mesh3D m, TreeRecipe r, int lod, Random rng, int budget, bool stylized)
    {
        var all = Blades(r, rng, r.Blades);
        var seg = Math.Max(1, (stylized ? 3 : 5) - lod * 2);      // 5, 3, 1 (stylized 3, 1, 1): a far blade is one triangle
        var share = lod == 0 ? 1f : lod == 1 ? 0.55f : 0.3f;
        var trisEach = 2 * seg - 1;
        if (budget > 0) share = MathF.Min(share, budget / (float)Math.Max(1, trisEach * all.Count));
        // The same blades on every level, the first in Keep order: a nearer level always has the farther one's blades.
        var kept = all.OrderBy(b => b.Keep).Take(Math.Max(1, (int)(all.Count * share))).ToList();
        // Fewer blades farther away are wider, so the tuft keeps its colour and outline.
        var widen = all.Count > 0 ? MathF.Min(3, MathF.Sqrt(all.Count / (float)kept.Count)) : 1;
        var leafy = r.GrassMode == "leaves";
        if (leafy) seg = Math.Max(2, seg);     // a leaf needs a bend to read as one
        foreach (var b in kept) AddBlade(m, b, seg, leafy ? MathF.Min(widen, 1.6f) : widen, 0, r, leafy ? Inset(LeafAtlas.Cell((int)(b.Phase * 4) % 4)) : null);
        return kept.Count;
    }

    /// <summary>One blade: a strip along its curve, narrowing to a point; normals leaning up (grass is lit like the ground).</summary>
    private static void AddBlade(Mesh3D m, Blade b, int seg, float widen, int material, TreeRecipe r, Vector4? cell = null)
    {
        var sub = m.Sub(material);
        var dir = new Vector3(MathF.Cos(b.Azimuth), 0, MathF.Sin(b.Azimuth));
        var side = new Vector3(-dir.Z, 0, dir.X);
        var wind = (float)r.Windswept;
        var windDir = new Vector3(1, 0, 0);
        var p = b.Base;
        var step = b.Height / seg;
        var prev = -1; var prevB = -1;
        for (var k = 0; k <= seg; k++)
        {
            var s = k / (float)seg;
            // The angle from upright grows towards the tip: it bends over (droop), the wind pulls every blade one way.
            var theta = MathF.Min(1.75f, b.Tilt + b.Droop * 1.5f * s * s);   // at most a little past level
            var heading = Vector3.Normalize(dir * MathF.Sin(theta) + Vector3.UnitY * MathF.Cos(theta) + windDir * wind * s * 0.8f);
            if (k > 0) { p += heading * step; if (p.Y < 0.004f * k) p.Y = 0.004f * k; }   // a flopped blade lies on the ground, not under it
            var c = b.Curl * MathF.PI * s;
            var across = side * MathF.Cos(c) + Vector3.Cross(heading, side) * MathF.Sin(c);
            // A leaf sprite keeps its width (its outline is in the picture); a blade narrows to a point.
            var half = cell != null ? b.Width * widen * 0.5f : b.Width * widen * 0.5f * MathF.Pow(1 - s, 0.6f) * (k == 0 ? 0.8f : 1);
            var face = Vector3.Normalize(Vector3.Cross(across, heading));
            var n = Vector3.Normalize(face * 0.35f + Vector3.UnitY * 0.65f);
            var col = new Vector4(0, MathF.Min(1, MathF.Pow(s, 1.5f) * b.Height / MathF.Max(0.2f, (float)r.Height)), 0.25f * s, b.Phase);   // wind data stays within 0–1
            var v = 1 - s;
            if (cell is { } c4)
            {
                // The sprite's anchor (bottom middle of its cell) at the root, its top at the tip.
                var cv = c4.W + (c4.Y - c4.W) * s;
                var l = m.AddVertex(p - across * half, n, new Vector2(c4.X, cv), col);
                var rr = m.AddVertex(p + across * half, n, new Vector2(c4.Z, cv), col);
                if (prev >= 0) sub.Indices.AddRange([prev, prevB, rr, prev, rr, l]);
                prev = l; prevB = rr;
                continue;
            }
            if (k == seg)
            {
                var tip = m.AddVertex(p, n, new Vector2(0.5f, 0), col);
                sub.Indices.AddRange([prev, prevB, tip]);
                break;
            }
            var a = m.AddVertex(p - across * half, n, new Vector2(0, v), col);
            var bb = m.AddVertex(p + across * half, n, new Vector2(1, v), col);
            if (prev >= 0) sub.Indices.AddRange([prev, prevB, bb, prev, bb, a]);
            prev = a; prevB = bb;
        }
    }

    /// <summary>A cell pulled in a little from its edges, so the neighbouring cell's picture doesn't bleed in at the tip.</summary>
    private static Vector4 Inset(Vector4 c) { const float e = 0.012f; return new Vector4(c.X + e, c.Y + e, c.Z - e, c.W - e); }

    // ---- Cards ----

    /// <summary>One card to place: where its base is, its width direction, which way is up along it, its size, its picture cell.</summary>
    private sealed record Plane(Vector3 Base, Vector3 Across, Vector3 Up, float Width, float Height, int Cell, float Phase);

    private static int AddCards(Mesh3D m, TreeRecipe r, int lod, Random rng)
    {
        var planes = Planes(r, rng);
        // Farther levels: fewer bends, then the outer planes go (the core stays), each kept one a little wider.
        var rows = r.CardLayout == "random" ? (lod == 0 ? 3 : lod == 1 ? 2 : 1) : (lod == 0 ? 2 : 1);
        var keep = r.CardLayout == "random"
            ? Math.Max(lod == 0 ? 3 : 2, (int)Math.Round(planes.Count * (lod == 0 ? 1 : lod == 1 ? 0.6 : 0.4)))
            : lod <= 1 ? planes.Count : Math.Max(2, (int)Math.Ceiling(planes.Count * 0.5));
        var widen = MathF.Sqrt(planes.Count / (float)keep);
        var bush = r.CardArt == "bush";
        var middle = new Vector3(0, (float)r.Height * 0.45f, 0);
        foreach (var p in planes.Take(keep))
            AddPlane(m, p, rows, widen, r, bush ? middle : null);
        return keep;
    }

    /// <summary>The planes of a layout, the core ones first (what farther levels keep).</summary>
    private static List<Plane> Planes(TreeRecipe r, Random rng)
    {
        var h = (float)r.Height;
        var bush = r.CardArt == "bush";
        var w = r.CardWidth > 0 ? (float)r.CardWidth : bush ? h * 1.15f : MathF.Max((float)r.Spread * 2.2f, h * 0.8f);
        var splay = (float)(r.Splay * Math.PI / 180);
        var turn = (float)(rng.NextDouble() * Math.PI);
        var list = new List<Plane>();
        Vector3 Dir(float a) => new(MathF.Cos(a), 0, MathF.Sin(a));
        Vector3 Lean(Vector3 outward, float tilt) => Vector3.Normalize(Vector3.UnitY * MathF.Cos(tilt) + outward * MathF.Sin(tilt));
        void Upright(int n, float height, float width, float offset = 0)
        {
            for (var i = 0; i < n; i++)
            {
                var a = turn + i * MathF.PI / n + (float)(rng.NextDouble() - 0.5) * 0.15f;
                var tilt = (float)(rng.NextDouble() - 0.5) * 0.12f;
                list.Add(new Plane(Dir(a + MathF.PI / 2) * offset, Dir(a), Lean(Dir(a + MathF.PI / 2), tilt), width, height * (1 - (float)r.HeightSpread * 0.3f * (float)rng.NextDouble()), rng.Next(4), (float)rng.NextDouble()));
            }
        }
        // Planes round the middle, each across its tangent, leaning out by the tilt.
        void Around(int n, float radius, float tilt, float height, float width)
        {
            for (var i = 0; i < n; i++)
            {
                var a = turn + i * MathF.Tau / n + (float)(rng.NextDouble() - 0.5) * 0.4f;
                var outward = Dir(a);
                list.Add(new Plane(outward * radius, Dir(a + MathF.PI / 2), Lean(outward, tilt * (0.8f + 0.4f * (float)rng.NextDouble())), width, height * (0.85f + 0.3f * (float)rng.NextDouble()), rng.Next(4), (float)rng.NextDouble()));
            }
        }
        switch (r.CardLayout)
        {
            case "cross": Upright(r.Cards > 0 ? r.Cards : 2, h, w); break;
            case "star": Upright(r.Cards > 0 ? r.Cards : 3, h, w); break;
            case "hash":
            {
                // Two planes each way, side by side: a # from above, a patch of ground covered.
                var d = w * 0.22f;
                var n = Math.Max(1, (r.Cards > 0 ? r.Cards : 4) / 2);
                for (var axis = 0; axis < 2; axis++)
                    for (var i = 0; i < n; i++)
                    {
                        var along = Dir(turn + axis * MathF.PI / 2);
                        var side = Dir(turn + axis * MathF.PI / 2 + MathF.PI / 2);
                        var off = n == 1 ? 0 : (i / (float)(n - 1) - 0.5f) * 2 * d;
                        list.Add(new Plane(side * off, along, Lean(side, (float)(rng.NextDouble() - 0.5) * 0.15f), w, h * (1 - (float)r.HeightSpread * 0.3f * (float)rng.NextDouble()), rng.Next(4), (float)rng.NextDouble()));
                    }
                break;
            }
            case "fan": Around(r.Cards > 0 ? r.Cards : 6, (float)r.Spread * 0.4f, MathF.Max(0.25f, splay), h, w * 0.6f); break;
            case "dome":
                // A crossed core, then planes leaning out all round: from any side a full, rounded bush.
                Upright(2, h, w * 0.9f);
                Around(r.Cards > 0 ? Math.Max(0, r.Cards - 2) : 6, w * 0.22f, MathF.Max(0.35f, splay), h * 0.8f, w * 0.7f);
                break;
            case "ring":
                Upright(3, h, w * 0.8f);
                Around(r.Cards > 0 ? Math.Max(0, r.Cards - 3) : 5, w * 0.3f, MathF.Max(0.45f, splay * 1.2f), h * 0.6f, w * 0.55f);
                break;
            default:
            {
                // At random (the first cards): about a dozen blades on each, at least three crossed.
                var count = r.Cards > 0 ? r.Cards : Math.Max(3, (int)Math.Round(r.Blades / 12.0));
                for (var i = 0; i < count; i++)
                {
                    var a = (float)(i * Math.PI / count + rng.NextDouble() * 0.4);
                    var off = (float)(rng.NextDouble() * r.Spread * 0.6);
                    var oa = (float)(rng.NextDouble() * Math.PI * 2);
                    var hh = (float)(r.Height * (1 - r.HeightSpread * 0.5 * rng.NextDouble()));
                    var ww = r.CardWidth > 0 ? (float)r.CardWidth : (float)(Math.Max(r.Spread * 2.2, r.Height * 0.8) * (0.8 + 0.4 * rng.NextDouble()));
                    var cell = rng.Next(4);
                    var phase = (float)rng.NextDouble();
                    var tilt = (float)(r.Splay * Math.PI / 180 * 0.3 * (rng.NextDouble() - 0.5));
                    list.Add(new Plane(Dir(oa) * off, Dir(a), Lean(Dir(a + MathF.PI / 2), tilt), ww, hh, cell, phase));
                }
                break;
            }
        }
        return list;
    }

    /// <summary>
    /// A card: rows of quads up its height (bending back towards the top for the wind), front and back with their own
    /// normals (no double-sided material: the back isn't dark). Grass normals lean up (lit like the ground); a bush's
    /// point out from its middle (lit like a rounded mass, not like flat cards).
    /// </summary>
    private static void AddPlane(Mesh3D m, Plane p, int rows, float widen, TreeRecipe r, Vector3? middle)
    {
        var sub = m.Sub(0);
        var cell = LeafAtlas.Cell(p.Cell);
        cell = new Vector4(cell.X + 0.004f, cell.Y + 0.004f, cell.Z - 0.004f, cell.W - 0.004f);
        var facing = Vector3.Normalize(Vector3.Cross(p.Across, p.Up));
        var up = Vector3.Normalize(p.Up + Vector3.UnitX * (float)r.Windswept * 0.4f);
        var half = p.Width * widen * 0.5f;
        var first = m.VertexCount;
        for (var k = 0; k <= rows; k++)
        {
            var s = k / (float)rows;
            var bend = (float)r.Droop * 0.25f * s * s * p.Height;
            var centre = p.Base + up * (p.Height * s) + facing * bend;
            var col = new Vector4(0, MathF.Pow(s, 1.5f), 0.2f * s, p.Phase);
            var v = cell.W + (cell.Y - cell.W) * s;
            foreach (var (x, u) in new[] { (-1f, cell.X), (1f, cell.Z) })
            {
                var pos = centre + p.Across * half * x;
                var n = middle is { } c ? Vector3.Normalize(Vector3.Normalize(pos - c) * 0.7f + facing * 0.3f + Vector3.UnitY * 0.2f) : Vector3.Normalize(facing * 0.3f + Vector3.UnitY * 0.7f);
                m.AddVertex(pos, n, new Vector2(u, v), col);
            }
            if (k > 0) { var l = first + k * 2; sub.Indices.AddRange([l - 2, l - 1, l + 1, l - 2, l + 1, l]); }
        }
        var count0 = m.VertexCount;
        for (var k = first; k < count0; k++)
        {
            var n = m.Normals[k];
            // The back: mirrored through the card's plane.
            var back = n - 2 * Vector3.Dot(n, facing) * facing;
            m.AddVertex(m.Positions[k], middle != null ? n : Vector3.Normalize(back), m.UV0[k], m.Colors[k]);
        }
        var shift = count0 - first;
        for (var k = 1; k <= rows; k++)
        {
            var l = first + shift + k * 2;
            sub.Indices.AddRange([l - 2, l, l - 1, l - 1, l, l + 1]);
        }
    }

    // ---- Heads ----

    /// <summary>Stalks rising a little above the blades, each carrying a head (seeds, a flower, a plume, a cattail).</summary>
    private static void AddHeads(Mesh3D m, TreeRecipe r, int lod, Random rng, int headMat, int centreMat, bool stylized)
    {
        var count = r.HeadCount;
        var share = lod == 0 ? 1f : lod == 1 ? 0.7f : 0.45f;
        var ring = lod == 0 ? (stylized ? 5 : 6) : lod == 1 ? 4 : 3;
        for (var i = 0; i < count; i++)
        {
            var a = (float)(rng.NextDouble() * Math.PI * 2);
            var d = (float)(Math.Sqrt(rng.NextDouble()) * r.Spread * 0.8);
            var h = (float)(r.Height * (r.Heads == "flowers" ? 0.75 + 0.35 * rng.NextDouble() : 1.0 + 0.25 * rng.NextDouble()));
            var tilt = (float)(r.Splay * Math.PI / 180 * 0.45 * (0.3 + 0.7 * d / Math.Max(1e-6, r.Spread)));
            var phase = (float)rng.NextDouble();
            var nod = (float)(r.Heads is "seeds" or "plumes" ? r.Droop * 0.6 * rng.NextDouble() : 0);
            var keep = rng.NextDouble();
            if (keep >= share) continue;
            var basePos = new Vector3(MathF.Cos(a) * d, 0, MathF.Sin(a) * d);
            // The stalk: a thin blade without a taper to a point, its top where the head sits.
            var stalk = new Blade(basePos, a, h, (float)Math.Max(0.002, r.BladeWidth * 0.35), tilt, nod, 0, phase, 0);
            var seg = lod == 0 ? 3 : lod == 1 ? 2 : 1;
            AddBlade(m, stalk, seg, 1, 0, r);
            var top = m.Positions[^1];
            var below = m.Positions[^2];
            var axis = Vector3.Normalize(top - (below + m.Positions[^3]) * 0.5f);
            var wind = new Vector4(0, MathF.Min(1, h / MathF.Max(0.2f, (float)r.Height)), 0.35f, phase);
            var size = (float)r.HeadSize * (0.8f + 0.4f * (float)rng.NextDouble());
            switch (r.Heads)
            {
                case "seeds": Spindle(m, top - axis * size * 0.15f, axis, size * 1.6f, size * 0.22f, ring, headMat, wind); break;
                case "plumes": Spindle(m, top - axis * size * 0.2f, Vector3.Normalize(axis + new Vector3(0, 0.3f, 0)), size * 2.6f, size * 0.42f, ring + 1, headMat, wind); break;
                case "cattails":
                    Spindle(m, top - axis * size * 1.3f, axis, size * 1.5f, size * 0.2f, ring, headMat, wind, blunt: true);
                    break;
                case "flowers": Flower(m, top, size, lod == 0 ? 6 : lod == 1 ? 5 : 4, headMat, centreMat, wind, (float)rng.NextDouble()); break;
            }
        }
    }

    /// <summary>An elongated head along an axis: a ring of corners swelling in the middle, pointed (or blunt) at both ends.</summary>
    private static void Spindle(Mesh3D m, Vector3 start, Vector3 axis, float length, float radius, int sides, int material, Vector4 wind, bool blunt = false)
    {
        var sub = m.Sub(material);
        var side = Vector3.Normalize(Vector3.Cross(axis, MathF.Abs(axis.Y) > 0.9f ? Vector3.UnitX : Vector3.UnitY));
        var other = Vector3.Cross(axis, side);
        var rings = blunt ? new[] { 0f, 0.05f, 0.95f, 1f } : new[] { 0f, 0.35f, 0.75f, 1f };
        float RadiusAt(float t) => blunt ? (t is <= 0.01f or >= 0.99f ? radius * 0.6f : radius) : t <= 0.01f || t >= 0.99f ? 0 : radius * (t < 0.5f ? 1f : 0.8f);
        var idx = new List<int[]>();
        foreach (var t in rings)
        {
            var c = start + axis * length * t;
            var rr = RadiusAt(t);
            var ring = new int[sides];
            for (var k = 0; k < sides; k++)
            {
                var ang = k * MathF.Tau / sides;
                var o = side * MathF.Cos(ang) + other * MathF.Sin(ang);
                var n = Vector3.Normalize(o + axis * (t < 0.5f ? -0.3f : 0.3f));
                ring[k] = m.AddVertex(c + o * rr, n, new Vector2(k / (float)sides, t), wind);
            }
            idx.Add(ring);
        }
        for (var j = 0; j + 1 < idx.Count; j++)
            for (var k = 0; k < sides; k++)
            {
                int a = idx[j][k], b = idx[j][(k + 1) % sides], c = idx[j + 1][(k + 1) % sides], d = idx[j + 1][k];
                sub.Indices.AddRange([a, c, b, a, d, c]);
            }
        if (blunt)
        {
            // Caps on both ends.
            for (var k = 1; k + 1 < sides; k++) { sub.Indices.AddRange([idx[0][0], idx[0][k], idx[0][k + 1]]); sub.Indices.AddRange([idx[^1][0], idx[^1][k + 1], idx[^1][k]]); }
        }
    }

    /// <summary>A flower facing up and a little out: petals round a raised centre.</summary>
    private static void Flower(Mesh3D m, Vector3 at, float size, int petals, int petalMat, int centreMat, Vector4 wind, float turn)
    {
        var sub = m.Sub(petalMat);
        var up = Vector3.UnitY;
        var centre = m.AddVertex(at + up * size * 0.05f, up, new Vector2(0.5f, 0.5f), wind);
        for (var k = 0; k < petals; k++)
        {
            var a0 = (k + turn) * MathF.Tau / petals;
            var a1 = a0 + MathF.Tau / petals * 0.5f;
            var a2 = a0 + MathF.Tau / petals;
            Vector3 O(float a, float r) => new(MathF.Cos(a) * r, -r * 0.18f, MathF.Sin(a) * r);
            var p0 = m.AddVertex(at + O(a0, size * 0.35f), up, new Vector2(0, 1), wind);
            var tip = m.AddVertex(at + O(a1, size), up, new Vector2(0.5f, 0), wind);
            var p2 = m.AddVertex(at + O(a2, size * 0.35f), up, new Vector2(1, 1), wind);
            sub.Indices.AddRange([centre, tip, p0, centre, p2, tip]);
        }
        // The centre: a small raised disc in the second colour.
        var cs = m.Sub(centreMat);
        var top = m.AddVertex(at + up * size * 0.16f, up, new Vector2(0.5f, 0.5f), wind);
        var ring = new int[petals];
        for (var k = 0; k < petals; k++)
        {
            var a = k * MathF.Tau / petals;
            ring[k] = m.AddVertex(at + new Vector3(MathF.Cos(a), 0.4f, MathF.Sin(a)) * size * 0.25f, Vector3.Normalize(new Vector3(MathF.Cos(a), 1.5f, MathF.Sin(a))), new Vector2(0.5f, 0.5f), wind);
        }
        for (var k = 0; k < petals; k++) cs.Indices.AddRange([top, ring[(k + 1) % petals], ring[k]]);
    }

    // ---- Textures ----

    /// <summary>Up each blade: dark at the root, the grass colour, the tip colour (straw towards the tips when dry).</summary>
    internal static RawImage BladePixels(TreeRecipe r)
    {
        const int h = 64;
        var root = LeafAtlas.Hex(r.LeafColor) * 0.55f;
        var mid = LeafAtlas.Hex(r.LeafColor);
        var tip = Vector3.Lerp(LeafAtlas.Hex(r.LeafColor2), LeafAtlas.Hex(Straw), (float)r.DryTips);
        var px = new byte[8 * h * 4];
        for (var y = 0; y < h; y++)
        {
            var s = 1 - y / (float)(h - 1);      // top row (v = 0) is the tip
            var c = s < 0.35f ? Vector3.Lerp(root, mid, s / 0.35f) : Vector3.Lerp(mid, tip, MathF.Pow((s - 0.35f) / 0.65f, 1.2f));
            for (var x = 0; x < 8; x++)
            {
                // A faint midrib down the middle.
                var rib = x is 3 or 4 ? 1.08f : 1f;
                var i = (y * 8 + x) * 4;
                px[i] = B(c.X * rib); px[i + 1] = B(c.Y * rib); px[i + 2] = B(c.Z * rib); px[i + 3] = 255;
            }
        }
        return new RawImage(8, h, px);
    }

    /// <summary>
    /// The cards' picture: a 2 × 2 atlas, each cell a clump of blades rising from the bottom middle, fanning out and
    /// bending over, coloured as the blades are (with heads drawn in when the tuft has them). Transparent pixels keep
    /// the grass colour, so mipmaps don't get dark fringes.
    /// </summary>
    internal static RawImage CardPixels(TreeRecipe r, int size)
    {
        var px = new float[size * size * 4];
        var root = LeafAtlas.Hex(r.LeafColor) * 0.5f;
        var mid = LeafAtlas.Hex(r.LeafColor);
        var tip = Vector3.Lerp(LeafAtlas.Hex(r.LeafColor2), LeafAtlas.Hex(Straw), (float)r.DryTips);
        var headCol = LeafAtlas.Hex(r.HeadColor);
        for (var i = 0; i < size * size; i++) { px[i * 4] = mid.X; px[i * 4 + 1] = mid.Y; px[i * 4 + 2] = mid.Z; }
        var half = size / 2;
        for (var cell = 0; cell < 4; cell++)
        {
            var rng = new Random(r.Seed * 53 + cell);
            int ox = (cell & 1) * half, oy = (cell >> 1) * half;
            // Pixel art: fewer, wider blades, each at least about two pixels wide, so they survive the shrinking.
            var pixelWidth = r.Pixels > 0 ? 2.2f / r.Pixels : 0f;
            var blades = r.Pixels > 0 ? 7 + rng.Next(3) : 14 + rng.Next(6);
            for (var b = 0; b < blades; b++)
            {
                var x0 = 0.5f + (float)(rng.NextDouble() - 0.5) * (r.Pixels > 0 ? 0.6f : 0.3f);   // pixel art: roots apart, not one block
                var lean = (float)(rng.NextDouble() - 0.5) * 1.1f * (float)(0.4 + r.Splay / 60);
                var len = 0.6f + 0.38f * (float)rng.NextDouble();
                var width = MathF.Max(pixelWidth, (float)(0.018 + 0.02 * rng.NextDouble()) * (float)Math.Clamp(r.BladeWidth / 0.012, 0.6, 2.5));
                var droop = (float)r.Droop * (0.4f + 0.8f * (float)rng.NextDouble()) * MathF.Sign(lean == 0 ? 1 : lean);
                var shade = 0.8f + 0.35f * (float)rng.NextDouble();
                const int steps = 60;
                for (var k = 0; k < steps; k++)
                {
                    var s = k / (float)steps;
                    var x = x0 + lean * s * 0.45f + droop * s * s * 0.25f;
                    var y = s * len;
                    var w = width * MathF.Pow(1 - s, 0.7f) + 0.002f;
                    var c = (s < 0.3f ? Vector3.Lerp(root, mid, s / 0.3f) : Vector3.Lerp(mid, tip, (s - 0.3f) / 0.7f)) * shade;
                    Disc(px, size, ox, oy, half, x, y, w, c);
                }
                // A head on some of the blades (the far look of a seeding tuft).
                if (r.Heads != "none" && r.HeadCount > 0 && b % 4 == 0)
                {
                    var s = 1f;
                    var x = x0 + lean * s * 0.45f + droop * 0.25f;
                    for (var k = 0; k < 8; k++) Disc(px, size, ox, oy, half, x + lean * 0.01f * k, len - 0.01f * k, r.Heads == "flowers" ? 0.035f : 0.018f, headCol);
                }
            }
        }
        var bytes = new byte[size * size * 4];
        for (var i = 0; i < px.Length; i++) bytes[i] = B(px[i]);
        return new RawImage(size, size, bytes);
    }

    /// <summary>
    /// Fern fronds for leaf tufts: a 2 × 2 atlas, each a stem from the bottom middle to near the top with leaflets on
    /// both sides, angled up, longest a third of the way up and shrinking to the tip, so the whole frond stays inside its
    /// cell (its tip is a point, not cut off).
    /// </summary>
    internal static RawImage FrondPixels(TreeRecipe r, int size)
    {
        var px = new float[size * size * 4];
        var c1 = LeafAtlas.Hex(r.LeafColor);
        var c2 = Vector3.Lerp(LeafAtlas.Hex(r.LeafColor2), LeafAtlas.Hex(Straw), (float)r.DryTips);
        for (var i = 0; i < size * size; i++) { px[i * 4] = c1.X; px[i * 4 + 1] = c1.Y; px[i * 4 + 2] = c1.Z; }
        var half = size / 2;
        var stylized = r.Style == "stylized";
        for (var cell = 0; cell < 4; cell++)
        {
            var rng = new Random(r.Seed * 71 + cell);
            int ox = (cell & 1) * half, oy = (cell >> 1) * half;
            var bend = (float)(rng.NextDouble() - 0.5) * 0.12f;
            Vector2 Stem(float t) => new(0.5f + bend * t * t, 0.02f + 0.93f * t);
            for (var k = 0; k < 80; k++) { var q = Stem(k / 80f); Disc(px, size, ox, oy, half, q.X, q.Y, 0.012f * (1 - k / 100f), c1 * 0.6f); }
            var pairs = stylized ? 9 : 16;
            for (var j = 0; j < pairs; j++)
            {
                var t = 0.08f + 0.88f * j / pairs;
                var at = Stem(t);
                var col = Vector3.Lerp(c1, c2, t) * (0.85f + 0.3f * (float)rng.NextDouble());
                foreach (var side in new[] { -1f, 1f })
                {
                    var angle = (stylized ? 0.75f : 0.6f) + 0.15f * (float)rng.NextDouble();     // up from level (radians)
                    var len = 0.42f * MathF.Pow(MathF.Sin(MathF.PI * MathF.Min(1, 0.15f + t)), 0.8f) * (1 - 0.7f * t);
                    len = MathF.Min(len, MathF.Min(0.47f / MathF.Cos(angle), (0.985f - at.Y) / MathF.Sin(angle)));     // inside the cell
                    var width = (stylized ? 0.05f : 0.03f) * (1 - 0.4f * t);
                    const int steps = 24;
                    for (var k = 0; k <= steps; k++)
                    {
                        var u = k / (float)steps;
                        var x = at.X + side * MathF.Cos(angle) * len * u;
                        var y = at.Y + MathF.Sin(angle) * len * u;
                        Disc(px, size, ox, oy, half, x, y, width * MathF.Sin(MathF.PI * MathF.Min(0.98f, 0.15f + 0.85f * u)) + 0.003f, col);
                    }
                }
            }
        }
        var bytes = new byte[size * size * 4];
        for (var i = 0; i < px.Length; i++) bytes[i] = B(px[i]);
        return new RawImage(size, size, bytes);
    }

    /// <summary>
    /// A bush card's picture: a 2 × 2 atlas, each cell a rounded, leafy clump standing on the bottom middle — hundreds of
    /// small leaves, darker deep inside and at the bottom, lighter towards the top and the edge, a broken outline (no
    /// clean circle), flowers or berries painted on when the recipe has them. Transparent pixels keep the leaf colour.
    /// </summary>
    internal static RawImage BushPixels(TreeRecipe r, int size)
    {
        var px = new float[size * size * 4];
        var c1 = LeafAtlas.Hex(r.LeafColor);
        var c2 = Vector3.Lerp(LeafAtlas.Hex(r.LeafColor2), LeafAtlas.Hex(Straw), (float)r.DryTips);
        var stylized = r.Style == "stylized";
        for (var i = 0; i < size * size; i++) { px[i * 4] = c1.X; px[i * 4 + 1] = c1.Y; px[i * 4 + 2] = c1.Z; }
        var half = size / 2;
        var flowers = r.Heads != "none" && r.HeadCount > 0;
        var fc = LeafAtlas.Hex(r.HeadColor); var fc2 = LeafAtlas.Hex(r.HeadColor2);
        for (var cell = 0; cell < 4; cell++)
        {
            var rng = new Random(r.Seed * 97 + cell);
            int ox = (cell & 1) * half, oy = (cell >> 1) * half;
            // The clump's outline: a dome on the bottom middle, its edge pushed in and out by a few lobes.
            var lobes = Enumerable.Range(0, 7).Select(_ => (A: (float)(rng.NextDouble() * Math.Tau), S: 0.06f + 0.08f * (float)rng.NextDouble())).ToArray();
            float Edge(float ang) => 0.38f + lobes.Sum(l => l.S * MathF.Max(0, MathF.Cos(ang - l.A)) * 0.6f);   // stays inside the cell (no flat top)
            bool Inside(float x, float y, out float depth)
            {
                var dx = x - 0.5f; var dy = (y - 0.47f) * 1.08f;
                var d = MathF.Sqrt(dx * dx + dy * dy);
                var e = Edge(MathF.Atan2(dy, dx));
                depth = 1 - d / e;
                return d < e && y > 0.02f;
            }
            // A few stems at the bottom, then the leaves back to front (back ones darker).
            for (var st = 0; st < 5; st++)
            {
                var a = (st - 2) * 0.35f;
                for (var k = 0; k < 30; k++) { var t = k / 30f; Disc(px, size, ox, oy, half, 0.5f + MathF.Sin(a) * t * 0.25f, 0.02f + t * 0.25f, 0.008f, new Vector3(0.3f, 0.24f, 0.16f)); }
            }
            var leaves = stylized ? 220 : 520;
            for (var layer = 0; layer < 3; layer++)
                for (var k = 0; k < leaves / 3; k++)
                {
                    var x = (float)rng.NextDouble(); var y = (float)rng.NextDouble();
                    if (!Inside(x, y, out var depth)) { k--; continue; }
                    var height = y;
                    var light = (0.55f + (stylized ? 0.18f : 0.25f) * layer) * (0.75f + (stylized ? 0.3f : 0.45f) * height) * (0.8f + 0.35f * (1 - depth)) * (0.85f + 0.3f * (float)rng.NextDouble());
                    var col = Vector3.Lerp(c1, c2, Math.Clamp(height * 0.9f + (layer - 1) * 0.15f + (float)(rng.NextDouble() - 0.5) * 0.3f, 0, 1)) * light;
                    var rad = stylized ? 0.026f + 0.016f * (float)rng.NextDouble() : 0.016f + 0.012f * (float)rng.NextDouble();
                    if (r.Pixels > 0) rad = MathF.Max(rad, (1.3f + (float)rng.NextDouble()) / r.Pixels);     // a leaf a few pixels across
                    if (stylized) Disc(px, size, ox, oy, half, x, y - 0.006f, rad + 0.006f, col * 0.55f);   // a painted dark edge under each
                    Disc(px, size, ox, oy, half, x, y, rad, col);
                }
            if (flowers)
                for (var k = 0; k < r.HeadCount * 3; k++)
                {
                    var x = (float)rng.NextDouble(); var y = (float)rng.NextDouble();
                    if (!Inside(x, y, out var depth) || depth < 0.05f) { if (k < 600) k--; continue; }
                    var fr = MathF.Max(0.012f, (float)(r.HeadSize / Math.Max(0.2, r.Height)) * 0.5f);
                    Disc(px, size, ox, oy, half, x, y, fr, fc * (0.85f + 0.3f * y));
                    if (r.Heads == "flowers") Disc(px, size, ox, oy, half, x, y, fr * 0.35f, fc2);
                }
        }
        var bytes = new byte[size * size * 4];
        for (var i = 0; i < px.Length; i++) bytes[i] = B(px[i]);
        return new RawImage(size, size, bytes);
    }

    /// <summary>A soft round dot in a cell (x across 0–1, y up 0–1 from the cell's bottom).</summary>
    private static void Disc(float[] px, int size, int ox, int oy, int half, float x, float y, float r, Vector3 c)
    {
        var cx = ox + x * half; var cy = oy + (1 - y) * half; var rr = MathF.Max(0.6f, r * half);
        for (var py = (int)(cy - rr - 1); py <= (int)(cy + rr + 1); py++)
            for (var qx = (int)(cx - rr - 1); qx <= (int)(cx + rr + 1); qx++)
            {
                if (qx < ox || qx >= ox + half || py < oy || py >= oy + half) continue;
                var d = MathF.Sqrt((qx + 0.5f - cx) * (qx + 0.5f - cx) + (py + 0.5f - cy) * (py + 0.5f - cy));
                var a = Math.Clamp(rr + 0.5f - d, 0, 1);
                if (a <= 0) continue;
                var i = (py * size + qx) * 4;
                px[i] = px[i] * (1 - a) + c.X * a; px[i + 1] = px[i + 1] * (1 - a) + c.Y * a; px[i + 2] = px[i + 2] * (1 - a) + c.Z * a;
                px[i + 3] = MathF.Max(px[i + 3], a);
            }
    }

    // ---- Pixel art ----

    /// <summary>
    /// The picture as pixel art (small textures on): an atlas of <paramref name="cells"/> × <paramref name="cells"/> pictures,
    /// each shrunk to the recipe's pixel size (so a card's picture is that many pixels across), cut out hard, the
    /// colours reduced to its palette when one is set, and with a dark one-pixel outline when asked.
    /// </summary>
    internal static RawImage Pixelate(TreeRecipe r, RawImage px, int cells)
    {
        if (r.Pixels <= 0) return px;
        var small = PixelArt.Make(px, r.Pixels * cells, r.PixelColours);
        return r.PixelOutline ? Outline(small, LeafAtlas.Hex(r.LeafColor) * 0.35f) : small;
    }

    /// <summary>Opaque pixels next to a see-through one turn dark: the hand-drawn outline of pixel-art sprites.</summary>
    internal static RawImage Outline(RawImage img, Vector3 ink)
    {
        var w = img.Width; var h = img.Height; var src = img.Rgba; var dst = (byte[])src.Clone();
        bool Clear(int x, int y) => x < 0 || y < 0 || x >= w || y >= h || src[(y * w + x) * 4 + 3] < 128;
        for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++)
            {
                var i = (y * w + x) * 4;
                if (src[i + 3] < 128 || !(Clear(x - 1, y) || Clear(x + 1, y) || Clear(x, y - 1) || Clear(x, y + 1))) continue;
                dst[i] = B(ink.X); dst[i + 1] = B(ink.Y); dst[i + 2] = B(ink.Z);
            }
        return img with { Rgba = dst };
    }

    /// <summary>Blades in pixel art: the colour up each blade in a few hard bands (the palette's steps), not a smooth gradient.</summary>
    internal static RawImage PixelBlades(TreeRecipe r)
    {
        var steps = r.PixelColours > 0 ? Math.Clamp(r.PixelColours / 2, 3, 8) : 5;
        var smooth = BladePixels(r);
        var h = Math.Clamp(r.Pixels, 8, 64);
        var px = new byte[4 * h * 4];
        for (var y = 0; y < h; y++)
        {
            // The band this row falls in, sampled from the smooth gradient at the band's middle.
            var band = Math.Min(steps - 1, y * steps / h);
            var sy = (int)((band + 0.5f) / steps * (smooth.Height - 1));
            for (var x = 0; x < 4; x++)
            {
                var i = (y * 4 + x) * 4; var j = (sy * smooth.Width + 3) * 4;
                px[i] = smooth.Rgba[j]; px[i + 1] = smooth.Rgba[j + 1]; px[i + 2] = smooth.Rgba[j + 2]; px[i + 3] = 255;
            }
        }
        return new RawImage(4, h, px);
    }

    // ---- Finishing ----

    private static void WindToUv(Mesh3D m, TreeRecipe r)
    {
        if (!r.Wind) { m.Colors.Clear(); return; }
        if (r.WindData == "color" || m.Colors.Count != m.VertexCount) return;
        m.UV1.Clear(); m.UV2.Clear();
        foreach (var c in m.Colors) { m.UV1.Add(new Vector2(c.Y, c.Z)); m.UV2.Add(new Vector2(c.W, c.X)); }
        m.Colors.Clear();
    }

    /// <summary>Darker down in the tuft, where the blades shade each other (in the vertex colours, unless they carry the wind).</summary>
    private static void Shade(Mesh3D m, TreeRecipe r)
    {
        if (r.Shading <= 0 || m.VertexCount == 0 || (r.Wind && r.WindData == "color")) return;
        var h = MathF.Max(0.05f, (float)r.Height);
        m.Colors.Clear();
        foreach (var p in m.Positions)
        {
            var s = Math.Clamp(p.Y / h, 0, 1);
            var light = 0.5f + 0.5f * MathF.Pow(s, 0.6f);
            var v = 1 + (light - 1) * (float)r.Shading;
            m.Colors.Add(new Vector4(v, v, MathF.Min(1, v * 1.04f), 1));
        }
    }

    private static void Use(Material3D m, RawImage pixels) { m.BaseColorPixels = pixels; m.BaseColorPng = pixels.Png(); }
    private static byte B(float v) => (byte)Math.Clamp((int)MathF.Round(v * 255), 0, 255);
    private static Vector3 Lin3(string hex) { var c = Linear(hex); return new Vector3(c.X, c.Y, c.Z); }
    private static Vector4 Linear(string hex)
    {
        var c = LeafAtlas.Hex(hex);
        static float L(float v) => v <= 0.04045f ? v / 12.92f : MathF.Pow((v + 0.055f) / 1.055f, 2.4f);
        return new Vector4(L(c.X), L(c.Y), L(c.Z), 1);
    }
}
