using System.Diagnostics;
using System.Numerics;

namespace NoorMD.Media.Assets3D;

/// <summary>What building a tree gives: the skeleton, one asset per level of detail, and notes worth showing.</summary>
public sealed class TreeBuild
{
    public required TreeRecipe Recipe { get; init; }
    public required TreeSkeleton Skeleton { get; init; }
    public List<Asset3D> Lods { get; } = [];
    public List<string> Notes { get; } = [];
    public double Seconds { get; set; }
}

/// <summary>
/// Turns a tree recipe into game-ready meshes. The wood is one implicit surface per group (the trunk with its welded
/// limbs, and each separate branch on its own), extracted, simplified to the triangle budget, then given smooth normals
/// from the field, bark UVs from the skeleton and wind data in the vertex colours. Branches too thin for the grid are
/// swept tubes that start inside their parent. Leaves are alpha cards from a generated atlas, puffy clumps (the
/// stylized look), or both.
/// </summary>
public static class TreeBuilder
{
    public sealed class Options
    {
        /// <summary>Bark and leaf textures in pixels (0 = no textures, plain colours; the preview may use fewer).</summary>
        public int TextureSize { get; init; } = 512;
        /// <summary>Build only the first N levels of detail (the preview needs one).</summary>
        public int? MaxLods { get; init; }
        /// <summary>Reads a picture of your own (bark, leaves) by its path; null when it can't or may not be read.</summary>
        public Func<string, RawImage?>? Images { get; init; }
    }

    private sealed class Group
    {
        public int Index;
        public string Name = "Trunk";
        public int RootBranch;
        public Vector3 Pivot;
        public List<int> Branches = [];
        public ImplicitField? Field;
        public Mesh3D? Dense;
        public List<(int Branch, int Start, bool Attach)> Tubes = [];
        public ImplicitField? ClumpField;
        public Mesh3D? ClumpDense;
    }

    public static TreeBuild Build(TreeRecipe recipe, Options? options = null, CancellationToken ct = default)
    {
        options ??= new Options();
        var watch = Stopwatch.StartNew();
        recipe = recipe.Clone();
        // A triangle target sets both budgets.
        (recipe.Budget, recipe.LeafBudget) = recipe.Budgets();
        var sk = TreeSkeleton.Grow(recipe);
        var build = new TreeBuild { Recipe = recipe, Skeleton = sk };
        cardShapes = null;
        measureLeaves = null;
        var stylized = recipe.Style == "stylized";
        var q = recipe.Quality switch { "low" => 5f, "high" => 12f, _ => 8f };
        var cell = MathF.Max((float)recipe.TrunkRadius / q, (float)recipe.Height / (q * 60));
        var rMin = cell * 1.25f;
        var tile = (float)recipe.BarkTile;
        var rng = new Random(recipe.Seed ^ 0x5eed);

        // Groups: the trunk (with roots and welded limbs), then each separate limb with everything on it.
        var groupOf = new int[sk.Branches.Count];
        var groups = new List<Group> { new() { Index = 0, Name = "Trunk", RootBranch = 0 } };
        foreach (var b in sk.Branches)
        {
            if (b.Id == 0 || b.Root) { groupOf[b.Id] = 0; continue; }
            if (b.Level == 1 && (recipe.Branches == "separate" || (recipe.Branches == "mixed" && b.BaseRadius < recipe.MixedRadius)))
            {
                var g = new Group { Index = groups.Count, Name = $"Branch_{groups.Count:00}", RootBranch = b.Id, Pivot = b.Points[0] };
                groups.Add(g);
                groupOf[b.Id] = g.Index;
            }
            else groupOf[b.Id] = groupOf[b.Parent];
        }
        foreach (var b in sk.Branches) groups[groupOf[b.Id]].Branches.Add(b.Id);

        // Wood fields: thick parts implicit, thin parts tubes. A small wood budget instead makes all of it clean
        // low-poly tubes (a welded surface simplified to a few hundred triangles would be crushed out of shape).
        // A cactus is always clean tubes: its ribs are the tubes' lobes (a welded surface would melt them).
        var lowPoly = recipe.Budget < LowPolyWood || recipe.Archetype == "cactus";
        var tubeCount = 0;
        foreach (var g in groups)
        {
            if (lowPoly) break;
            ct.ThrowIfCancellationRequested();
            var segs = new List<SdfSegment>();
            foreach (var id in g.Branches)
            {
                var b = sk.Branches[id];
                var attach = id == g.RootBranch && g.Index > 0;
                var end = 0;
                while (end < b.Points.Count && b.Radii[end] >= rMin) end++;
                // Roots are short and stubby: welded all the way, their tips kept at least as thick as the grid allows.
                if (b.Root) end = b.Points.Count;
                if (end < 2) { g.Tubes.Add((id, 0, true)); tubeCount++; continue; }
                var collar = (float)recipe.Collar * b.BaseRadius * b.Kind switch
                {
                    "root" => 0.6f + 0.8f * (float)recipe.Flare,
                    "prop" => 0.9f,
                    "ridge" => 0.5f,
                    "knee" => 0f,
                    _ => 1.6f,
                };
                // A separate limb starts a little inside its parent, so no gap shows where it meets it.
                if (attach && b.Parent >= 0)
                {
                    var pr = sk.Branches[b.Parent].At(b.ParentT).R;
                    var back = b.Points[0] - b.Tangent(0) * pr * 0.7f;
                    segs.Add(new SdfSegment(back, b.Points[0], b.Radii[0], b.Radii[0], 0, id));
                }
                for (var k = 0; k + 1 < end; k++)
                    segs.Add(new SdfSegment(b.Points[k], b.Points[k + 1], MathF.Max(b.Radii[k], rMin), MathF.Max(b.Radii[k + 1], rMin), k == 0 && !attach ? collar : 0.15f * b.Radii[k], id));
                if (end < b.Points.Count) { g.Tubes.Add((id, end - 1, false)); tubeCount++; }
            }
            if (segs.Count > 0)
            {
                g.Field = new ImplicitField(segs, cell);
                g.Dense = g.Field.Extract(g.Name);
            }
        }
        if (tubeCount > 0) build.Notes.Add($"{tubeCount} thin branch ends are tubes (thinner than the {recipe.Quality} quality grid).");

        // Clump shapes (stylized foliage): blobs at the branch tips, melted together. Drawn as a solid mesh ("clumps",
        // "both"), or only used to place leaf cards over them, with no solid mesh at all ("tufts").
        var clumpShapes = recipe.Foliage is "clumps" or "both" or "tufts" && recipe.Archetype is not ("dead" or "cactus");
        var clumps = clumpShapes && recipe.Foliage != "tufts";
        if (clumpShapes)
            foreach (var g in groups)
            {
                ct.ThrowIfCancellationRequested();
                var segs = ClumpSegments(sk, recipe, g.Branches, rng);
                if (segs.Count == 0) continue;
                g.ClumpField = new ImplicitField(segs, (float)recipe.LeafSize * 0.2f);
                g.ClumpDense = g.ClumpField.Extract(g.Name + "_Leaves");
            }

        // Materials (shared by all levels of detail).
        var bark = new Material3D { Name = "Bark", BaseColor = Color(recipe.BarkColor), Roughness = 0.9f };
        if (options.TextureSize > 0 && recipe.BarkMaterial != "")
        {
            try
            {
                var barkRecipe = BarkTextures.For(recipe.BarkMaterial, recipe.BarkColor) ?? TexturePresets.Make(recipe.BarkMaterial);
                var maps = TextureEngine.Render(barkRecipe, options.TextureSize);
                bark.BaseColor = Vector4.One;
                bark.BaseColorPng = maps.Png("albedo");
                bark.BaseColorPixels = RawImage.FromRgb(maps.Size, maps.Size, maps.Albedo);
                bark.NormalPng = maps.Png("normal");
                bark.OcclusionRoughnessMetallicPng = maps.Packed("ao", "roughness", "metallic");
                bark.NormalPixels = RawImage.FromRgb(maps.Size, maps.Size, maps.Normal);
                bark.OrmPixels = RawImage.FromRgb(maps.Size, maps.Size, Enumerable.Range(0, maps.Size * maps.Size).SelectMany(i => new[] { maps.Ao[i], maps.Roughness[i], maps.Metallic[i] }).ToArray());
                bark.Roughness = 1;
            }
            catch (ArgumentException) { build.Notes.Add($"The bark material \"{recipe.BarkMaterial}\" was not found; a plain colour is used."); }
        }
        // Your own bark picture (colour only) replaces the generated bark.
        if (recipe.BarkImage != "")
        {
            if (options.Images?.Invoke(recipe.BarkImage) is { } own) { bark.BaseColor = Vector4.One; bark.NormalPng = null; bark.OcclusionRoughnessMetallicPng = null; bark.Roughness = 0.9f; Use(bark, own); }
            else build.Notes.Add("Your bark picture can't be read (moved, deleted, or not chosen here); the bark is generated.");
        }
        var cards = recipe.Foliage is "cards" or "both" or "tufts" && recipe.Archetype is not ("dead" or "cactus");
        // Single-sided: every card has a real back face with its own normals (a double-sided material would flip the
        // normals on the back and darken half the crown in every engine).
        var leafMat = new Material3D { Name = "Leaves", Alpha = "mask", AlphaCutoff = 0.5f, Roughness = 0.75f };
        if (cards)
        {
            var ownLeaves = recipe.LeafImage != "" ? options.Images?.Invoke(recipe.LeafImage) : null;
            if (recipe.LeafImage != "" && ownLeaves == null) build.Notes.Add("Your leaf picture can't be read (moved, deleted, or not chosen here); the leaves are generated.");
            if (ownLeaves != null) Use(leafMat, ownLeaves);
            else if (options.TextureSize > 0) Use(leafMat, LeafAtlas.Pixels(recipe.LeafShape, recipe.LeafColor, recipe.LeafColor2, stylized, Math.Min(1024, options.TextureSize), recipe.Seed, recipe.LeafCluster));
            else leafMat.BaseColor = Color(recipe.LeafColor);
            // Each sprite's outline, from a small copy of the picture (so the cards' shape doesn't depend on the texture size).
            // (The same small copy is what the crown's fullness is measured with.)
            var src = ownLeaves ?? LeafAtlas.Pixels(recipe.LeafShape, recipe.LeafColor, recipe.LeafColor2, stylized, 128, recipe.Seed, recipe.LeafCluster);
            // Pixel art: the leaves' texture is that small copy in pixels, so the outlines fit its hard edges exactly.
            if (recipe.Pixels > 0)
            {
                src = PixelArt.Make(src, recipe.Pixels, recipe.PixelColours);
                if (options.TextureSize > 0) Use(leafMat, src);
            }
            measureLeaves = src;
            if (recipe.TrimCards)
                cardShapes = Enumerable.Range(0, 5).Select(i => i < 4 ? CardShape.Outline(src, LeafAtlas.Cell(i)) : CardShape.Outline(src, new Vector4(0, 0, 1, 1))).ToArray();
        }
        // Hanging moss (also on bare and dead trees: the swamp snag).
        var mossy = recipe.Moss > 0;
        var mossMat = new Material3D { Name = "Moss", Alpha = "mask", AlphaCutoff = 0.45f, Roughness = 0.9f };
        if (mossy)
        {
            var light = LeafAtlas.Hex(recipe.MossColor) * 1.35f;
            var lightHex = $"#{(int)Math.Clamp(light.X * 255, 0, 255):x2}{(int)Math.Clamp(light.Y * 255, 0, 255):x2}{(int)Math.Clamp(light.Z * 255, 0, 255):x2}";
            if (options.TextureSize > 0) Use(mossMat, LeafAtlas.Pixels("moss", recipe.MossColor, lightHex, stylized, Math.Min(512, options.TextureSize), recipe.Seed + 7));
            else mossMat.BaseColor = Color(recipe.MossColor);
        }
        // Mushroom caps and crystals (fantasy trees), and the glow.
        var glow = (float)recipe.Glow;
        Vector3 Lin(string hex) { var c = Color(hex); return new Vector3(c.X, c.Y, c.Z); }
        var capped = recipe.CapWidth > 0;
        var capMat = new Material3D { Name = "Cap", Roughness = 0.6f, Emissive = Lin(recipe.CapColor) * glow * 0.6f };
        if (capped)
        {
            if (options.TextureSize > 0) Use(capMat, FantasyParts.CapPixels(recipe.CapColor, recipe.SpotColor, recipe.Spots, recipe.Seed, Math.Min(512, options.TextureSize)));
            else capMat.BaseColor = Color(recipe.CapColor);
        }
        var crystals = recipe.Foliage == "crystals";
        var crystalMat = new Material3D { Name = "Crystal", BaseColor = Color(recipe.LeafColor), Roughness = 0.15f, Emissive = Lin(recipe.LeafColor2) * glow };
        if (glow > 0) leafMat.Emissive = Lin(recipe.LeafColor2) * glow * 0.45f;
        var clumpMat = new Material3D { Name = "Leaf clumps", Roughness = 0.85f };
        if (clumps)
        {
            if (options.TextureSize > 0) Use(clumpMat, LeafAtlas.GradientPixels(recipe.LeafColor, recipe.LeafColor2));
            else clumpMat.BaseColor = Color(recipe.LeafColor);
        }

        // Small textures (a pixel look): every map shrunk to that size, each pixel the average of what it covers (the
        // normals renormalized), the leaves cut out hard; a palette only when asked for. Still full PBR.
        if (recipe.Pixels > 0 && options.TextureSize > 0)
            foreach (var m in new[] { bark, leafMat, mossMat, capMat, clumpMat })
            {
                if (m.BaseColorPixels == null) continue;
                if (m != leafMat) Use(m, PixelArt.Make(m.BaseColorPixels, recipe.Pixels, recipe.PixelColours));
                m.NormalPng = m.NormalPixels != null ? PixelArt.Normals(m.NormalPixels, recipe.Pixels).Png() : null;
                m.OcclusionRoughnessMetallicPng = m.OrmPixels != null ? PixelArt.Shrink(m.OrmPixels, recipe.Pixels).Png() : null;
            }
        // Full PBR leaves: a normal map from the leaves' shape and an ORM map (the bark has its own).
        if (options.TextureSize > 0)
            foreach (var m in new[] { leafMat, mossMat })
                if (m.BaseColorPixels != null && m.NormalPng == null)
                {
                    (m.NormalPng, m.OcclusionRoughnessMetallicPng) = LeafAtlas.Maps(m.BaseColorPixels);
                    m.Roughness = 1;
                }
        // Sharp pixels: textures sampled nearest, in the files and the preview.
        if (recipe.Pixels > 0 || recipe.SharpPixels)
            foreach (var m in new[] { bark, leafMat, mossMat, capMat, clumpMat })
                m.Nearest = true;

        var lodCount = Math.Min(recipe.Lods, options.MaxLods ?? recipe.Lods);
        var leafGrow = 1f;      // how much the leaf budget made the finest level's cards fewer and bigger
        (double Before, double After, int Added)? canopy = null;
        for (var lod = 0; lod < lodCount; lod++)
        {
            ct.ThrowIfCancellationRequested();
            var asset = new Asset3D { Name = lodCount > 1 || recipe.Lods > 1 ? $"{recipe.Name}_LOD{lod}" : recipe.Name };
            asset.Materials.Add(bark);
            int leafIndex = -1, clumpIndex = -1, mossIndex = -1, capIndex = -1, crystalIndex = -1;
            if (cards) { asset.Materials.Add(leafMat); leafIndex = asset.Materials.Count - 1; }
            if (clumps) { asset.Materials.Add(clumpMat); clumpIndex = asset.Materials.Count - 1; }
            if (mossy) { asset.Materials.Add(mossMat); mossIndex = asset.Materials.Count - 1; }
            if (capped) { asset.Materials.Add(capMat); capIndex = asset.Materials.Count - 1; }
            if (crystals) { asset.Materials.Add(crystalMat); crystalIndex = asset.Materials.Count - 1; }
            asset.Root = new Node3D { Name = asset.Name };
            // The wood's triangles, and how much sparser the leaves are than on the closest level.
            var (levelWood, levelLeaves) = recipe.LevelBudgets(lod);
            var budget = recipe.LodTriangles.Count > 0 ? Math.Max(30, levelWood) : Math.Max(150, levelWood);
            var detail = recipe.LodTriangles.Count > 0 ? MathF.Max(1, recipe.LeafBudget / (float)Math.Max(1, levelLeaves)) : 1 << lod;

            // Tubes first: what they cost comes off the budget of the implicit surfaces. Branches left out of this
            // level's wood are noted: leaves meant for them go on the nearest branch that is there.
            missingWood = [];
            var tubes = new Dictionary<int, Mesh3D>();
            var tubeTris = 0;
            // Low-poly wood when the whole tree is (a small budget), and on any farther level whose share is small: a
            // welded trunk up close, a simple one where the leaves hide it.
            if (lowPoly || budget < LowPolyWood)
            {
                var (kept, left) = LowPolyWoodMeshes(groups, sk, recipe, budget, cell * 1.6f * (1 << lod), tile, tubes, lod);
                tubeTris = tubes.Values.Sum(m => m.TriangleCount);
                if (lod == 0) build.Notes.Add($"Low-poly wood (a small wood budget): {kept} branches as clean tubes{(left > 0 ? $", the {left} finest left out (they are inside the leaves)" : "")}.");
            }
            else foreach (var g in groups)
            {
                var m = new Mesh3D { Name = g.Name };
                foreach (var (id, start, attach) in g.Tubes)
                {
                    var b = sk.Branches[id];
                    // Distant levels drop the finest twigs; so does a small wood budget (they are inside the leaves).
                    if ((lod >= 2 || (recipe.Budget < 2500 && cards)) && b.Level >= recipe.Levels.Count && b.Level >= 2)
                    {
                        if (start == 0) missingWood!.Add(id);     // all of it was this tube: it is not in the wood
                        continue;
                    }
                    AddTube(m, sk, b, start, attach && b.Parent >= 0 && (id == g.RootBranch || start == 0), cell * 1.6f * (1 << lod), tile, recipe);
                }
                tubes[g.Index] = m;
                tubeTris += m.TriangleCount;
            }
            var denseTotal = groups.Sum(g => g.Dense?.TriangleCount ?? 0);
            var implicitBudget = Math.Max(budget / 4, budget - tubeTris);

            var made = new List<(Group G, Mesh3D Wood, Mesh3D Leaves)>();
            var lodGrow = 1f;
            foreach (var g in groups)
            {
                Mesh3D wood;
                if (g.Dense != null && g.Field != null && !(lowPoly || budget < LowPolyWood))
                {
                    wood = Copy(g.Dense);
                    var target = Math.Max(60, (int)((long)implicitBudget * g.Dense.TriangleCount / Math.Max(1, denseTotal)));
                    Simplifier.Simplify(wood, target);
                    wood = FinishWood(wood, g.Field, sk, tile, recipe);
                }
                else wood = new Mesh3D { Name = g.Name };
                Append(wood, tubes[g.Index]);
                if (capped) AddCaps(wood, sk, recipe, g, capIndex, detail);
                if (recipe.FlatShading) wood = Flatten(wood);
                if (bark.NormalPng != null && wood.VertexCount > 0) wood.ComputeTangents();
                wood.Name = g.Name;

                // Leaves of this group.
                var leaves = new Mesh3D { Name = g.Name == "Trunk" ? "Leaves" : g.Name + "_Leaves" };
                Mesh3D? clumpMesh = null;
                if (clumpShapes && g.ClumpDense != null && g.ClumpField != null)
                {
                    clumpMesh = Copy(g.ClumpDense);
                    var clumpBudget = Math.Max(80, (int)((long)Math.Max(recipe.LodTriangles.Count > 0 ? 60 : 300, recipe.LodTriangles.Count > 0 ? levelWood / 2 : recipe.Budget / 2 >> lod) * g.ClumpDense.TriangleCount / Math.Max(1, groups.Sum(x => x.ClumpDense?.TriangleCount ?? 0))));
                    Simplifier.Simplify(clumpMesh, clumpBudget);
                    clumpMesh = FinishClumps(clumpMesh, g.ClumpField, sk, recipe, clumpIndex);
                    if (recipe.FlatShading && clumps) clumpMesh = Flatten(clumpMesh);
                    if (clumps) Append(leaves, clumpMesh);
                }
                if (cards)
                {
                    var cardRng = new Random(recipe.Seed * 7919 + g.Index * 131 + lod);
                    var grew = recipe.Foliage is "both" or "tufts" && clumpMesh != null
                        ? AddCardsOnClumps(leaves, clumpMesh, sk, recipe, leafIndex, detail, cardRng, recipe.Foliage == "tufts")
                        : AddCards(leaves, sk, recipe, g.Branches, leafIndex, detail, cardRng);
                    if (lod == 0) leafGrow = MathF.Max(leafGrow, grew);
                    lodGrow = MathF.Max(lodGrow, grew);
                }

                if (crystals) AddCrystals(leaves, sk, recipe, g.Branches, crystalIndex, detail, new Random(recipe.Seed * 31337 + g.Index * 7 + lod));
                if (mossy) AddMoss(leaves, sk, recipe, g.Branches, mossIndex, detail, new Random(recipe.Seed * 104729 + g.Index * 17 + lod));
                made.Add((g, wood, leaves));
            }

            // The crown looked at from its sides: where the sky shows through, more cards on the nearest branches,
            // until it is as full as asked or the leaf budget is spent.
            if (cards && recipe.CanopyFullness > 0 && recipe.Arrangement is not ("fronds" or "boughs" or "hanging"))
            {
                var fill = FillCrown(made, sk, recipe, asset.Materials, leafIndex, detail, lodGrow, new Random(recipe.Seed * 6007 + lod), ct);
                if (lod == 0) canopy = fill;
            }

            Node3D? trunkNode = null;
            foreach (var (g, wood, leaves) in made)
            {
                WindChannel(wood, recipe);
                WindChannel(leaves, recipe);
                Shade(wood, sk, recipe, leafy: false);
                Shade(leaves, sk, recipe, leafy: true);

                // Pivots: a separate limb's node sits where it leaves its parent.
                Offset(wood, -g.Pivot);
                Offset(leaves, -g.Pivot);
                if ((leafMat.NormalPng != null || mossMat.NormalPng != null) && leaves.VertexCount > 0) leaves.ComputeTangents();
                var node = new Node3D { Name = g.Name, Translation = g.Pivot, Mesh = wood.TriangleCount > 0 ? wood : null };
                if (leaves.TriangleCount > 0) node.Children.Add(new Node3D { Name = leaves.Name, Mesh = leaves });
                if (g.Index == 0) { trunkNode = node; asset.Root.Children.Add(node); }
                else (trunkNode ?? asset.Root).Children.Add(node);
            }
            build.Lods.Add(asset);
        }
        if (canopy is { } c && c.After < recipe.CanopyFullness - 0.02)
            build.Notes.Add($"The crown is {c.After:P0} full of the {recipe.CanopyFullness:P0} asked: the leaf budget ({recipe.LeafBudget:N0} triangles) ran out. Raise it, make the cards bigger, or use spray or cluster cards.");
        if (leafGrow > 1.05f)
            build.Notes.Add($"The leaf budget ({recipe.LeafBudget:N0} triangles) is less than the density asks for: {leafGrow:0.#}× fewer cards, each bigger, keep the crown as full. Raise the budget for smaller leaves, or lower the density.");

        // The farthest level: the tree drawn from its sides onto crossed cards (from the finest level, so it looks its best).
        if (recipe.Billboard && build.Lods.Count > 0 && (options.MaxLods == null || options.MaxLods > lodCount))
        {
            ct.ThrowIfCancellationRequested();
            var views = Math.Clamp(recipe.BillboardViews, 2, 4);
            var (atlas, halfWidth, height) = Billboard.Render(build.Lods[0], views, options.TextureSize > 0 ? Math.Clamp(options.TextureSize, 128, 1024) : 256);
            var mat = new Material3D { Name = "Billboard", Alpha = "mask", AlphaCutoff = 0.5f, Roughness = 0.9f };
            Use(mat, atlas);
            // The same material list as the other levels, the billboard's added at the end: every level's material
            // indices mean the same thing, so the levels can share one file (the GLB writer drops what a file doesn't use).
            var name = $"{recipe.Name}_LOD{build.Lods.Count}";
            var asset = new Asset3D { Name = name, Root = new Node3D { Name = name } };
            asset.Materials.AddRange(build.Lods[0].Materials);
            asset.Materials.Add(mat);
            var crossed = Billboard.Cards(views, halfWidth, height, asset.Materials.Count - 1, recipe.Wind);
            WindChannel(crossed, recipe);
            asset.Root.Children.Add(new Node3D { Name = "Billboard", Mesh = crossed });
            build.Lods.Add(asset);
        }
        cardShapes = null;
        measureLeaves = null;
        missingWood = null;
        build.Seconds = watch.Elapsed.TotalSeconds;
        return build;
    }

    // ---- Wood ----

    /// <summary>Below this many wood triangles the wood is low-poly tubes instead of a welded, simplified surface.</summary>
    internal const int LowPolyWood = 1600;

    /// <summary>
    /// Low-poly wood: every branch a clean tube, sides by importance (trunk 7, roots and main limbs 5 and 4, the rest
    /// 3) and rings by length, added most important first (the trunk, roots, main limbs, then each finer level, thick
    /// before thin) for as long as the budget lasts. Returns how many branches made it and how many were left out.
    /// </summary>
    private static (int Kept, int Left) LowPolyWoodMeshes(List<Group> groups, TreeSkeleton sk, TreeRecipe recipe, int budget, float edge, float tile, Dictionary<int, Mesh3D> into, int lod)
    {
        var groupOf = new Dictionary<int, Group>();
        foreach (var g in groups) foreach (var id in g.Branches) groupOf[id] = g;
        static int Rank(TreeBranch b) => b.Id == 0 ? 0 : b.Root ? 1 : b.Bare ? 99 : b.Level + 1;
        // The trunk follows the level: round and detailed up close (at least the recipe's trunk sides; a thick trunk,
        // baobab or sequoia, more), a simple 6- then 5-sided one farther away, where the leaves hide it.
        var cactus = recipe.Archetype == "cactus";
        int Sides(TreeBranch b) => cactus && !b.Root ? (lod == 0 ? Math.Min(24, recipe.FluteLobes * 2) : lod == 1 ? Math.Max(6, recipe.FluteLobes) : 5)
            : b.Id == 0
            ? lod == 0 ? Math.Max(recipe.TrunkSides, Math.Clamp((int)MathF.Round(10 * MathF.Sqrt(b.BaseRadius / 0.35f)), 10, 16)) : lod == 1 ? 6 : 5
            : b.Root ? Math.Max(3, 5 - lod) : b.Level == 1 ? Math.Max(3, 5 - lod) : 3;
        int Step(TreeBranch b)
        {
            // Rings: the trunk enough to follow its curve up close and a few far away, limbs a few, twigs two.
            var rings = b.Id == 0 ? (lod == 0 ? 12 : lod == 1 ? 5 : 3) : b.Root ? (lod == 0 ? 3 : 2) : b.Level == 1 ? (lod == 0 ? (cactus ? 8 : 5) : lod == 1 ? (cactus ? 4 : 3) : 2) : 2;
            return Math.Max(1, (int)MathF.Ceiling((b.Points.Count - 1) / (float)rings));
        }
        // Flute ridges are not tubes of their own here (they would cross the trunk where it twists): the trunk's rings
        // get the lobes instead, turning with the twist as the ridges did, and the girth the ridges stood for.
        var lobes = recipe.FluteLobes;
        var flute = (float)recipe.Flute;
        Func<float, float, float>? Flutes(int sides) => flute <= 0 ? null : (s, a) =>
        {
            if (s >= recipe.FluteHeight) return 1;
            // A trunk's flutes fade going up; a cactus's ribs run its whole length, rounding off at the tip.
            var fade = cactus ? 1 - MathF.Pow(s, 6) : MathF.Pow(1 - s / (float)recipe.FluteHeight, 0.6f);
            var girth = 1 / (1 - 0.3f * flute * fade);
            if (sides < lobes * 2) return girth;
            var lobe = MathF.Cos(lobes * (a - (float)recipe.Twist * s * MathF.Tau));
            return girth * (1 + 0.22f * flute * fade * (lobe - 0.3f));
        };
        var order = sk.Branches.Where(b => groupOf.ContainsKey(b.Id) && b.Points.Count >= 2 && b.Kind != "ridge").OrderBy(Rank).ThenByDescending(b => b.BaseRadius).ToList();
        foreach (var b in sk.Branches.Where(b => groupOf.ContainsKey(b.Id) && b.Points.Count < 2)) missingWood?.Add(b.Id);
        foreach (var g in groups) into[g.Index] = new Mesh3D { Name = g.Name };
        int used = 0, kept = 0;
        foreach (var b in order)
        {
            var sides = Sides(b);
            if (b.Id == 0 && flute > 0 && lod == 0 && !cactus) sides = Math.Max(sides, Math.Min(24, lobes * 2));     // enough sides to show the flutes up close
            var rings = (b.Points.Count - 1) / Step(b) + 2;
            var cost = sides * 2 * (rings - 1) + sides;
            if (b.Id != 0 && used + cost > budget) { missingWood?.Add(b.Id); continue; }
            var g = groupOf[b.Id];
            AddTube(into[g.Index], sk, b, 0, b.Parent >= 0, edge, tile, recipe, sides, Step(b), b.Id == 0 || cactus && !b.Root ? Flutes(sides) : null);
            used += cost;
            kept++;
        }
        return (kept, order.Count - kept);
    }

    /// <summary>Normals from the field; UVs, wind data and seams from the branch each triangle belongs to.</summary>
    private static Mesh3D FinishWood(Mesh3D m, ImplicitField field, TreeSkeleton sk, float tile, TreeRecipe recipe)
    {
        field.FieldNormals(m);
        var owners = field.Owners(m).Select(o => o >= 0 ? field.Segments[o].Owner : 0).ToArray();
        var outMesh = new Mesh3D { Name = m.Name };
        var cache = new Dictionary<(int V, int Branch, int Shift), int>();
        var uvs = new Dictionary<(int V, int Branch), (float U, float V, float Period, float S)>();

        (float U, float V, float Period, float S) UvFor(int v, int branch)
        {
            if (!uvs.TryGetValue((v, branch), out var r)) uvs[(v, branch)] = r = BranchUv(sk.Branches[branch], m.Positions[v], tile);
            return r;
        }

        int Vertex(int v, int branch, int shift)
        {
            if (cache.TryGetValue((v, branch, shift), out var idx)) return idx;
            var (u, vv, period, s) = UvFor(v, branch);
            idx = outMesh.AddVertex(m.Positions[v], m.Normals[v], new Vector2(u + shift * period, vv), Wind(sk.Branches[branch], s, m.Positions[v], sk, recipe));
            cache[(v, branch, shift)] = idx;
            return idx;
        }

        foreach (var s in m.Submeshes)
        {
            var sub = outMesh.Sub(s.Material);
            for (var i = 0; i + 2 < s.Indices.Count; i += 3)
            {
                int a = s.Indices[i], b = s.Indices[i + 1], c = s.Indices[i + 2];
                // The triangle's branch: the one most of its corners belong to (else the oldest, i.e. the parent).
                int oa = owners[a], ob = owners[b], oc = owners[c];
                var owner = oa == ob || oa == oc ? oa : ob == oc ? ob : Math.Min(oa, Math.Min(ob, oc));
                float ua = UvFor(a, owner).U, ub = UvFor(b, owner).U, uc = UvFor(c, owner).U;
                var period = UvFor(a, owner).Period;
                // Across the wrap-around seam: lift the low side by one period.
                var hi = MathF.Max(ua, MathF.Max(ub, uc));
                int Shift(float u) => hi - u > period / 2 ? 1 : 0;
                sub.Indices.AddRange([Vertex(a, owner, Shift(ua)), Vertex(b, owner, Shift(ub)), Vertex(c, owner, Shift(uc))]);
            }
        }
        return outMesh;
    }

    /// <summary>Bark UV of a point near a branch: around (u, in repeats of the bark texture) and along (v, in tiles).</summary>
    private static (float U, float V, float Period, float S) BranchUv(TreeBranch b, Vector3 p, float tile)
    {
        var bestK = 0;
        var bestT = 0f;
        var bestD = float.MaxValue;
        for (var k = 0; k + 1 < b.Points.Count; k++)
        {
            var ab = b.Points[k + 1] - b.Points[k];
            var t = ab.LengthSquared() < 1e-12f ? 0 : Math.Clamp(Vector3.Dot(p - b.Points[k], ab) / ab.LengthSquared(), 0, 1);
            var d = Vector3.DistanceSquared(p, b.Points[k] + ab * t);
            if (d < bestD) { bestD = d; bestK = k; bestT = t; }
        }
        var a = b.Points[bestK];
        var dir = b.Points[Math.Min(bestK + 1, b.Points.Count - 1)] - a;
        dir = dir.LengthSquared() > 1e-12f ? Vector3.Normalize(dir) : Vector3.UnitY;
        var n = Vector3.Lerp(b.Normals[bestK], b.Normals[Math.Min(bestK + 1, b.Normals.Count - 1)], bestT);
        n = n - dir * Vector3.Dot(n, dir);
        n = n.LengthSquared() > 1e-12f ? Vector3.Normalize(n) : Vector3.Normalize(Vector3.Cross(dir, Vector3.UnitX));
        var bn = Vector3.Cross(dir, n);
        var axisPoint = a + (b.Points[Math.Min(bestK + 1, b.Points.Count - 1)] - a) * bestT;
        var radial = p - axisPoint;
        var angle = MathF.Atan2(Vector3.Dot(radial, bn), Vector3.Dot(radial, n));
        if (angle < 0) angle += MathF.Tau;
        var period = Math.Max(1, MathF.Round(MathF.Tau * b.BaseRadius / tile));
        var along = b.Distance[bestK] + (b.Distance[Math.Min(bestK + 1, b.Distance.Count - 1)] - b.Distance[bestK]) * bestT;
        // Points beyond the base (the root flare, a collar) continue the mapping.
        if (bestK == 0 && bestT <= 0) along -= Vector3.Dot(axisPoint - p, dir);
        return (angle / MathF.Tau * period, along / tile, period, b.Length > 0 ? Math.Clamp(along / b.Length, 0, 1) : 0);
    }

    /// <summary>
    /// Wind data in the vertex colour: R trunk sway (rises with height), G branch bend (rises along limbs and with
    /// depth), B leaf flutter (twig tips and leaves), A phase (shared by a limb and its children).
    /// </summary>
    private static Vector4 Wind(TreeBranch b, float s, Vector3 p, TreeSkeleton sk, TreeRecipe recipe)
    {
        if (!recipe.Wind) return new Vector4(0, 0, 0, 0);
        var sway = MathF.Pow(Math.Clamp(p.Y / MathF.Max(0.01f, sk.Height), 0, 1), 2);
        var bend = b.Level == 0 ? 0 : b.BendAtBase + (1 - b.BendAtBase) * MathF.Pow(s, 1.5f) * 0.8f;
        var flutter = b.Level >= 2 ? 0.15f * s : 0;
        return new Vector4(sway, Math.Clamp(bend, 0, 1), flutter, b.Phase);
    }

    /// <summary>A swept tube along a thin branch (from point <paramref name="start"/>), its sides fitting the radius.</summary>
    private static void AddTube(Mesh3D m, TreeSkeleton sk, TreeBranch b, int start, bool attach, float edge, float tile, TreeRecipe recipe, int sidesOverride = 0, int stepOverride = 0,
        Func<float, float, float>? shape = null)
    {
        // A small wood budget: rings on every second or third point, and three or four sides.
        var step = stepOverride > 0 ? stepOverride : recipe.Budget < 1200 ? 3 : recipe.Budget < 2500 ? 2 : 1;
        var maxSides = recipe.Budget < 1200 ? 3 : recipe.Budget < 2500 ? 4 : 10;
        var pts = new List<(Vector3 P, float R, Vector3 N, float D)>();
        if (attach && start == 0 && b.Parent >= 0)
        {
            var pr = sk.Branches[b.Parent].At(b.ParentT).R;
            var back = MathF.Min(pr * 0.6f, b.Length * 0.3f);
            pts.Add((b.Points[0] - b.Tangent(0) * back, b.Radii[0], b.Normals[0], -back));
        }
        for (var k = start; k < b.Points.Count; k++)
            if ((k - start) % step == 0 || k == b.Points.Count - 1) pts.Add((b.Points[k], b.Radii[k], b.Normals[k], b.Distance[k]));
        if (pts.Count < 2) return;
        var sides = sidesOverride > 0 ? sidesOverride : Math.Clamp((int)MathF.Round(MathF.Tau * b.BaseRadius / edge), 3, maxSides);
        var period = Math.Max(1, MathF.Round(MathF.Tau * b.BaseRadius / tile));
        var sub = m.Sub(0);
        var first = m.VertexCount;
        for (var i = 0; i < pts.Count; i++)
        {
            var (p, r, n0, d) = pts[i];
            var t = i + 1 < pts.Count ? pts[i + 1].P - (i > 0 ? pts[i - 1].P : p) : p - pts[i - 1].P;
            t = t.LengthSquared() > 1e-12f ? Vector3.Normalize(t) : Vector3.UnitY;
            var n = Vector3.Normalize(n0 - t * Vector3.Dot(n0, t));
            var bn = Vector3.Cross(t, n);
            var s = b.Length > 0 ? Math.Clamp(d / b.Length, 0, 1) : 0;
            var wind = Wind(b, s, p, sk, recipe);
            for (var j = 0; j <= sides; j++)
            {
                var a = j / (float)sides * MathF.Tau;
                var radial = n * MathF.Cos(a) + bn * MathF.Sin(a);
                // A shape round the ring (the trunk's flutes), as a share of the radius at this height and angle.
                var rr = shape == null ? r : r * shape(s, a);
                m.AddVertex(p + radial * rr, radial, new Vector2(j / (float)sides * period, d / tile), wind);
            }
        }
        for (var i = 0; i + 1 < pts.Count; i++)
            for (var j = 0; j < sides; j++)
            {
                // Counter-clockwise seen from outside: the faces point the way the normals do.
                int a = first + i * (sides + 1) + j, c = a + sides + 1;
                sub.Indices.AddRange([a, a + 1, c, a + 1, c + 1, c]);
            }
        // A tip closing the end (a cactus's rounded: one more ring part-way in).
        var last = pts[^1];
        var dirEnd = Vector3.Normalize(last.P - pts[^2].P);
        if (recipe.Archetype == "cactus")
        {
            var (lp, lr) = (last.P, last.R);
            var lt = dirEnd;
            var ln = Vector3.Normalize(last.N - lt * Vector3.Dot(last.N, lt));
            var lb = Vector3.Cross(lt, ln);
            var cap = m.VertexCount;
            for (var j = 0; j <= sides; j++)
            {
                var a = j / (float)sides * MathF.Tau;
                var radial = ln * MathF.Cos(a) + lb * MathF.Sin(a);
                var rr = (shape == null ? lr : lr * shape(1, a)) * 0.72f;
                m.AddVertex(lp + lt * lr * 0.45f + radial * rr, Vector3.Normalize(radial + lt), new Vector2(j / (float)sides * period, (last.D + lr * 0.45f) / tile), Wind(b, 1, lp, sk, recipe));
            }
            var prev = first + (pts.Count - 1) * (sides + 1);
            for (var j = 0; j < sides; j++)
            {
                int a = prev + j, c = cap + j;
                sub.Indices.AddRange([a, a + 1, c, a + 1, c + 1, c]);
            }
            pts.Add((lp + lt * lr * 0.45f, lr * 0.72f, ln, last.D + lr * 0.45f));
            first = cap - (pts.Count - 1) * (sides + 1);
            last = pts[^1];
        }
        var tip = m.AddVertex(last.P + dirEnd * last.R * 0.6f, dirEnd, new Vector2(period / 2, (last.D + last.R) / tile), Wind(b, 1, last.P, sk, recipe));
        var ring = first + (pts.Count - 1) * (sides + 1);
        for (var j = 0; j < sides; j++) sub.Indices.AddRange([ring + j, ring + j + 1, tip]);
    }

    // ---- Leaves ----

    private static List<SdfSegment> ClumpSegments(TreeSkeleton sk, TreeRecipe recipe, List<int> branchIds, Random rng)
    {
        var segs = new List<SdfSegment>();
        var size = (float)recipe.LeafSize;
        // Little blending: the clumps stay distinct lobes (the painted fantasy look), only their joins are rounded.
        var blend = size * 0.3f;
        var conifer = recipe.Archetype == "conifer";
        var deepest = sk.Branches.Where(b => !b.Root && !b.Bare).Max(b => b.Level);
        foreach (var id in branchIds)
        {
            var b = sk.Branches[id];
            if (b.Root || b.Bare || b.Level == 0 && deepest > 0) continue;
            if (b.Children.Count > 0 && b.Level < deepest) continue;
            // Along the branch (several on long ones, outer ones smaller on conifers for the tiered look).
            var n = conifer ? 4 : Math.Clamp((int)MathF.Round(b.Length / (size * 1.4f)), 1, 4);
            for (var k = 0; k < n; k++)
            {
                var t = n == 1 ? 1 : 0.35f + 0.65f * k / (n - 1);
                var (p, _, dir) = b.At(t);
                var r = size * (0.6f + 0.3f * (float)rng.NextDouble()) * (conifer ? 0.85f - 0.35f * t : 1);
                // Conifer tiers hang a little below their branches, like skirts.
                var centre = p + new Vector3(0, r * (conifer ? -0.15f : 0.25f), 0);
                var flat = Vector3.Normalize(new Vector3(dir.X, dir.Y * 0.3f, dir.Z) + new Vector3(1e-4f, 0, 0));
                segs.Add(new SdfSegment(centre - flat * r * 0.3f, centre + flat * r * 0.3f, r, r * 0.9f, segs.Count == 0 ? 0 : blend, id));
            }
        }
        if (conifer && branchIds.Contains(0) && deepest > 0)
        {
            // The tip of a conifer.
            var (top, _, _) = sk.Trunk.At(0.97f);
            segs.Add(new SdfSegment(top - new Vector3(0, size * 0.3f, 0), top + new Vector3(0, size * 0.5f, 0), size * 0.55f, size * 0.15f, blend, 0));
        }
        if (deepest == 0 && branchIds.Contains(0))
        {
            // No branches: one clump on top of the trunk.
            var (top, _, _) = sk.Trunk.At(1);
            segs.Add(new SdfSegment(top, top, size, size, 0, 0));
        }
        // Too many blobs would be slow and look like foam: keep an even selection.
        if (segs.Count > 160)
        {
            var step = segs.Count / 160.0;
            segs = Enumerable.Range(0, 160).Select(i => segs[(int)(i * step)]).ToList();
        }
        return segs;
    }

    private static Mesh3D FinishClumps(Mesh3D m, ImplicitField field, TreeSkeleton sk, TreeRecipe recipe, int material)
    {
        field.FieldNormals(m);
        var owners = field.Owners(m);
        var bounds = m.Bounds();
        var h = MathF.Max(0.01f, bounds.Max.Y - bounds.Min.Y);
        var outMesh = new Mesh3D { Name = m.Name };
        for (var v = 0; v < m.VertexCount; v++)
        {
            var p = m.Positions[v];
            var n = m.Normals[v];
            var outward = CrownOut(p, sk);
            var normal = Vector3.Normalize(Vector3.Lerp(n, outward, (float)recipe.CrownNormals * 0.8f));
            // The gradient texture: light on top and on upward faces, dark underneath.
            var light = Math.Clamp(0.6f * (p.Y - bounds.Min.Y) / h + 0.4f * (n.Y * 0.5f + 0.5f), 0, 1);
            var branch = owners[v] >= 0 ? sk.Branches[field.Segments[owners[v]].Owner] : sk.Trunk;
            var wind = recipe.Wind ? new Vector4(MathF.Pow(Math.Clamp(p.Y / sk.Height, 0, 1), 2), Math.Clamp(0.4f + 0.5f * branch.BendAtBase + 0.3f * (branch.Level > 0 ? 1 : 0), 0, 1), 0.25f, branch.Phase) : Vector4.Zero;
            outMesh.AddVertex(p, normal, new Vector2(0.5f, 1 - light), wind);
        }
        var sub = outMesh.Sub(material);
        foreach (var s in m.Submeshes) sub.Indices.AddRange(s.Indices);
        return outMesh;
    }

    private static Vector3 CrownOut(Vector3 p, TreeSkeleton sk)
    {
        var d = p - sk.CrownCentre;
        return d.LengthSquared() > 1e-8f ? Vector3.Normalize(d) : Vector3.UnitY;
    }

    /// <summary>
    /// Leaf cards along the outermost branches, growing away from them, facing up and out of the crown. The density says
    /// how full the crown is (cards of the leaf size per metre of twig); outer leaves move that cover from branches deep
    /// in the crown to those near its surface; the leaf budget caps the triangles, the cards growing instead so the
    /// crown stays as full; the card scale makes each plane bigger without changing their number.
    /// </summary>
    private static float AddCards(Mesh3D m, TreeSkeleton sk, TreeRecipe recipe, List<int> branchIds, int material, float detail, Random rng)
    {
        if (recipe.Arrangement == "fronds") { AddFronds(m, sk, recipe, branchIds, material, detail, rng); return 1; }
        if (recipe.Arrangement == "boughs") { AddBoughs(m, sk, recipe, branchIds, material, detail, rng); return 1; }
        var conifer = recipe.Archetype == "conifer" || recipe.LeafShape == "needle";
        var deepest = sk.Branches.Where(b => !b.Root && !b.Bare).Max(b => b.Level);
        var size0 = (float)recipe.LeafSize;
        var outer = (float)recipe.OuterLeaves;
        var perTuft = recipe.Arrangement switch { "cross" => 2, "star" or "fan" => 3, "dome" => 5, _ => 1 };
        var trisPer = CardTriangles(recipe.Arrangement, recipe);
        var crownRadius = MathF.Max(0.3f, sk.CrownRadius);

        // Where the cards go and how much cover each branch gets.
        var plan = new List<(TreeBranch B, float From, float Cover, float Weighted)>();
        foreach (var id in branchIds)
        {
            var b = sk.Branches[id];
            if (b.Root || b.Bare || (b.Level == 0 && deepest > 0)) continue;
            // The outermost branches, and the outer part of the level below (where twigs would be).
            var isOuter = b.Children.Count == 0 || b.Level >= deepest;
            if (!isOuter && b.Level < deepest - 1) continue;
            var from = isOuter ? (conifer ? 0.1f : 0.25f) : 0.6f;
            var cover = (float)recipe.LeafDensity * 11f * b.Length * (1 - from) / size0 / MathF.Pow(perTuft, 0.75f);
            var (mid, _, _) = b.At((1 + from) / 2);
            var depth = Math.Clamp(Vector3.Distance(mid, sk.CrownCentre) / crownRadius, 0, 1.3f);
            plan.Add((b, from, cover, cover * (1 + outer * (0.15f + 1.4f * depth * depth - 1))));
        }
        var asked = plan.Sum(x => x.Cover);
        var weighted = plan.Sum(x => x.Weighted);
        if (asked <= 0) return 1;
        // Over the budget: fewer, bigger cards covering the same.
        var grow = MathF.Max(1, asked * trisPer / BaseLeafBudget(recipe));
        var start = m.TriangleCount;
        var ceiling = BaseLeafBudget(recipe) * 1.25f / detail;
        foreach (var (b, from, _, w) in plan)
        {
            var cover = w * asked / weighted;
            // Whole cards, rounding by chance so small branches still get their share.
            var wanted = cover / (detail * grow);
            var n = (int)wanted + (rng.NextDouble() < wanted - (int)wanted ? 1 : 0);
            if (n == 0) continue;
            // Bigger cards cover what fewer ones must, but not past twice the leaf size (giant cards lose the tree's
            // shape: a spruce would become a bush); beyond that the crown is thinner.
            var size = size0 * MathF.Min(MathF.Sqrt(MathF.Max(1, cover) / n), MathF.Sqrt(detail) * GrowCap(recipe));
            for (var k = 0; k < n && m.TriangleCount - start < ceiling; k++)
            {
                // Along the leafy part, leaning to the branch's end when leaves are pushed outwards.
                var u = n == 1 ? 1 : (k + (float)rng.NextDouble() * 0.8f) / n;
                var t = from + (1 - from) * MathF.Pow(u, 1 - 0.45f * outer);
                var (p, _, dir) = b.At(t);
                var around = (float)(rng.NextDouble() * MathF.Tau);
                var n0 = b.Normals[Math.Min(b.Normals.Count - 1, (int)(t * (b.Points.Count - 1)))];
                var side = Vector3.Normalize(Vector3.Transform(n0, Quaternion.CreateFromAxisAngle(dir, around)));
                var tilt = (conifer ? 0.5f : 0.6f) + (float)rng.NextDouble() * 0.6f;
                var growDir = Vector3.Normalize(dir * MathF.Cos(tilt) + side * MathF.Sin(tilt));
                if (t >= 0.99f) growDir = Vector3.Normalize(dir + side * 0.2f);
                var cardSize = size * PlaneScale(recipe) * (0.8f + 0.4f * (float)rng.NextDouble());
                // On a twig this level's wood left out, the card hangs from the nearest branch that is there, growing
                // towards where the twig's leaves were.
                var (anchor, toward, _, _) = Attach(sk, b, p);
                if (toward is { } tw)
                {
                    growDir = Vector3.Normalize(growDir * 0.4f + tw * 0.6f);
                    side = Vector3.Normalize(side * 0.4f + tw * 0.6f);
                }
                switch (recipe.Arrangement)
                {
                    case "scatter": Card(m, anchor, growDir, cardSize, sk, recipe, b, t, material, rng); break;
                    case "hanging": Hanging(m, anchor, side, cardSize, sk, recipe, b, t, material, rng); break;
                    default: Tuft(m, anchor, side, cardSize, sk, recipe, b, t, material, rng); break;
                }
            }
        }
        return grow;
    }

    /// <summary>
    /// How big a card's plane is against the leaf size: the card scale, and bigger for sprays and clusters (their leaves
    /// are drawn smaller, so the plane grows to keep each leaf about the size it is on a twig: a fuller crown for free).
    /// </summary>
    internal static float PlaneScale(TreeRecipe recipe) =>
        (float)recipe.CardScale * (recipe.LeafImage != "" || recipe.LeafShape is "frond" or "moss" ? 1 : recipe.LeafCluster switch { "spray" => 1.3f, "cluster" => 1.65f, _ => 1 });

    /// <summary>How much bigger the budget may make a card: conifers less (big cards would stick out past their short branches and widen the slim cone).</summary>
    private static float GrowCap(TreeRecipe recipe) => recipe.Archetype == "conifer" || recipe.LeafShape == "needle" ? 1.4f : 2f;

    /// <summary>The share of the leaf budget the first placement may use: with a canopy fullness, a part is kept for filling the gaps.</summary>
    private static float BaseLeafBudget(TreeRecipe recipe) => recipe.LeafBudget * (recipe.CanopyFullness > 0 && recipe.Arrangement is not ("fronds" or "boughs" or "hanging") ? 0.7f : 1f);

    /// <summary>Triangles one placement of an arrangement costs (a card is a folded quad, front and back: 8).</summary>
    internal static int CardTriangles(string arrangement, TreeRecipe? recipe = null) => arrangement switch { "cross" => 16, "star" or "fan" => 24, "dome" => 40, "hanging" => 4 * (recipe == null ? 6 : HangSegments(recipe)), _ => 8 };

    /// <summary>Segments down a willow curtain: fewer when the leaf budget is small.</summary>
    private static int HangSegments(TreeRecipe recipe) => recipe.LeafBudget < 6000 ? 3 : 6;

    /// <summary>
    /// Cards over the clump shapes, growing outwards: a leafy edge round solid clumps, or (tufts) the whole canopy, with
    /// cards also deeper inside so it looks full through the gaps and there is no solid mesh behind them.
    /// </summary>
    private static float AddCardsOnClumps(Mesh3D m, Mesh3D clumps, TreeSkeleton sk, TreeRecipe recipe, int material, float detail, Random rng, bool tufts = false)
    {
        if (clumps.VertexCount == 0) return 1;
        var size = (float)recipe.LeafSize * (tufts ? 0.6f : 0.8f) * MathF.Sqrt(detail);
        double area = 0;
        foreach (var s in clumps.Submeshes)
            for (var i = 0; i + 2 < s.Indices.Count; i += 3)
                area += Vector3.Cross(clumps.Positions[s.Indices[i + 1]] - clumps.Positions[s.Indices[i]], clumps.Positions[s.Indices[i + 2]] - clumps.Positions[s.Indices[i]]).Length() / 2;
        // The density asks for so many cards; over the leaf budget they get bigger and fewer instead.
        var asked = area * recipe.LeafDensity * (tufts ? 5.0 : 1.2) / (size * size);
        var cardsAllowed = BaseLeafBudget(recipe) / (double)CardTriangles("scatter") / detail;
        var count = (int)Math.Min(asked, cardsAllowed);
        if (asked > cardsAllowed) size *= (float)Math.Sqrt(asked / cardsAllowed);
        // Outer leaves: cards nearer the clumps' surface, fewer sunk deep inside.
        var sink = 1 - 0.6f * (float)recipe.OuterLeaves;
        for (var k = 0; k < count; k++)
        {
            var v = rng.Next(clumps.VertexCount);
            var n = clumps.Normals[v];
            var p = clumps.Positions[v] - n * size * (tufts ? (0.2f + 0.9f * (float)rng.NextDouble()) * sink : 0.3f);
            var jitter = new Vector3((float)rng.NextDouble() - 0.5f, (float)rng.NextDouble() - 0.5f, (float)rng.NextDouble() - 0.5f) * 0.6f;
            var grow = Vector3.Normalize(n + Vector3.UnitY * 0.3f + jitter);
            Card(m, p, grow, size * PlaneScale(recipe) * (0.8f + 0.4f * (float)rng.NextDouble()), sk, recipe, sk.Trunk, 1, material, rng, clumps.Colors.Count > v ? clumps.Colors[v] : null);
        }
        return (float)Math.Max(1, asked / cardsAllowed);
    }

    /// <summary>
    /// A tuft of cards set in one of the classic game-art arrangements around a point on a branch: single, cross,
    /// star (upright, turned round the vertical), fan (nearly level, like spruce tiers), dome (leaning in, with a cap).
    /// Readable from every side.
    /// </summary>
    private static void Tuft(Mesh3D m, Vector3 p, Vector3 side, float size, TreeSkeleton sk, TreeRecipe recipe, TreeBranch b, float t, int material, Random rng)
    {
        var outward = side with { Y = 0 };
        outward = outward.LengthSquared() > 1e-6f ? Vector3.Normalize(outward) : Vector3.UnitX;
        var spin = (float)(rng.NextDouble() * MathF.Tau);
        Vector3 Around(float a) => Vector3.Transform(outward, Quaternion.CreateFromAxisAngle(Vector3.UnitY, a + spin));
        var centre = p + side * size * 0.12f;
        switch (recipe.Arrangement)
        {
            case "single":
                Card(m, p, Vector3.Normalize(side * 0.6f + Vector3.UnitY * 0.5f), size, sk, recipe, b, t, material, rng);
                break;
            case "cross":
            case "star":
            {
                var n = recipe.Arrangement == "cross" ? 2 : 3;
                var grow = Vector3.Normalize(Vector3.UnitY + side * 0.3f);
                for (var k = 0; k < n; k++)
                    Card(m, centre - grow * size * 0.45f, grow, size, sk, recipe, b, t, material, rng, face: Around(MathF.PI * k / n));
                break;
            }
            case "fan":
                for (var k = 0; k < 3; k++)
                {
                    var h = Around(MathF.Tau * k / 3);
                    Card(m, centre - h * size * 0.15f, Vector3.Normalize(h + Vector3.UnitY * 0.25f), size, sk, recipe, b, t, material, rng, face: Vector3.UnitY);
                }
                break;
            default:    // dome: four leaning in round a level cap
                for (var k = 0; k < 4; k++)
                {
                    var h = Around(MathF.Tau * k / 4);
                    Card(m, centre - h * size * 0.35f, Vector3.Normalize(Vector3.UnitY * 0.8f + h * 0.6f), size, sk, recipe, b, t, material, rng);
                }
                Card(m, centre + Vector3.UnitY * size * 0.45f - outward * size * 0.5f, outward, size, sk, recipe, b, t, material, rng, face: Vector3.UnitY);
                break;
        }
    }

    /// <summary>
    /// Willow: a curtain hanging from the branch, facing out of the crown, made of a chain of leaf sprays (each segment
    /// its own sprite, stem at the top), arching out a little and then down, narrowing towards its tip and stopping
    /// above the ground. Many of them at different depths make the curtain; one stretched leaf would read as a plank.
    /// </summary>
    private static void Hanging(Mesh3D m, Vector3 p, Vector3 side, float size, TreeSkeleton sk, TreeRecipe recipe, TreeBranch b, float t, int material, Random rng)
    {
        var length = MathF.Min((float)recipe.HangLength * (0.5f + 0.5f * (float)rng.NextDouble()), p.Y - 0.4f);
        // Too near the ground for a curtain: none (a twig that low is inside the curtains of the others).
        if (length < size * 0.6f) return;
        // Out of the crown (so the curtain faces whoever looks at the tree), a little turned at random.
        var outward = (p - sk.CrownCentre) with { Y = 0 };
        var own = side with { Y = 0 };
        outward = (outward.LengthSquared() > 1e-6f ? Vector3.Normalize(outward) : Vector3.UnitX) * 0.7f + (own.LengthSquared() > 1e-6f ? Vector3.Normalize(own) : Vector3.Zero) * 0.3f;
        outward = outward.LengthSquared() > 1e-6f ? Vector3.Normalize(outward) : Vector3.UnitX;
        var across = Vector3.Transform(Vector3.Normalize(Vector3.Cross(Vector3.UnitY, outward)), Quaternion.CreateFromAxisAngle(Vector3.UnitY, ((float)rng.NextDouble() - 0.5f) * 0.9f));
        var segs = HangSegments(recipe);
        var width = size * (recipe.LeafBudget < 6000 ? 0.7f : 0.5f);
        var arch = size * (0.4f + 0.5f * (float)rng.NextDouble());
        Vector3 Centre(float s) => p + outward * arch * MathF.Sin(s * MathF.PI * 0.5f) - Vector3.UnitY * length * s;
        var sub = m.Sub(material);
        var baseWind = Wind(b, t, p, sk, recipe);
        for (var j = 0; j < segs; j++)
        {
            float s0 = j / (float)segs, s1 = (j + 1) / (float)segs;
            Vector3 c0 = Centre(s0), c1 = Centre(s1);
            // Each sprite a little longer than its segment, so neighbours overlap and no seam shows.
            var c1Long = j + 1 < segs ? c0 + (c1 - c0) * 1.15f : c1;
            float w0 = width * (1 - 0.35f * s0), w1 = width * (1 - 0.35f * s1);
            var along = Vector3.Normalize(c1 - c0);
            var face = Vector3.Normalize(Vector3.Cross(across, along));
            var cell = LeafCell(recipe, rng);
            var first = m.VertexCount;
            foreach (var (pos, u, v, s) in new[] { (c0 - across * w0, cell.X, cell.W, s0), (c0 + across * w0, cell.Z, cell.W, s0), (c1Long - across * w1, cell.X, cell.Y, s1), (c1Long + across * w1, cell.Z, cell.Y, s1) })
            {
                var wind = recipe.Wind ? baseWind with { Z = s } : Vector4.Zero;
                m.AddVertex(pos, Vector3.Normalize(Vector3.Lerp(face, CrownOut(pos, sk), (float)recipe.CrownNormals)), new Vector2(u, v), wind);
                m.AddVertex(pos, Vector3.Normalize(Vector3.Lerp(-face, CrownOut(pos, sk), (float)recipe.CrownNormals)), new Vector2(u, v), wind);
            }
            int a0 = first, a1 = first + 2, b0 = first + 4, b1 = first + 6;
            sub.Indices.AddRange([a0, a1, b1, a0, b1, b0]);
            sub.Indices.AddRange([a0 + 1, b1 + 1, a1 + 1, a0 + 1, b0 + 1, b1 + 1]);
        }
    }

    /// <summary>Palms and tree ferns: a frond strip along every outer branch, widest in the middle, folded along its rib.</summary>
    private static void AddFronds(Mesh3D m, TreeSkeleton sk, TreeRecipe recipe, List<int> branchIds, int material, float detail, Random rng)
    {
        var deepest = sk.Branches.Where(b => !b.Root && !b.Bare).Max(b => b.Level);
        var k = 0;
        foreach (var id in branchIds)
        {
            var b = sk.Branches[id];
            if (b.Root || b.Bare || b.Level == 0 && deepest > 0 || b.Level < deepest) continue;
            if (detail > 2 && k++ % (int)MathF.Round(detail) != 0) continue;     // far levels keep a share of the fronds
            var centres = new List<Vector3>();
            var across = new List<Vector3>();
            var widths = new List<float>();
            const int segs = 8;
            for (var j = 0; j <= segs; j++)
            {
                var t = 0.08f + 0.92f * j / segs;
                var (p, _, dir) = b.At(t);
                var a = Vector3.Cross(dir, Vector3.UnitY);
                a = a.LengthSquared() > 1e-6f ? Vector3.Normalize(a) : b.Normals[0];
                centres.Add(p);
                across.Add(a);
                widths.Add((float)recipe.LeafSize * (MathF.Pow(MathF.Max(0, MathF.Sin(MathF.PI * MathF.Min(1, t * 1.1f))), 0.65f) * 0.5f + 0.03f) * MathF.Sqrt(detail));
            }
            Strip(m, centres, across, widths, LeafCell(recipe, rng), hanging: false, sk, recipe, b, 1, material);
        }
    }

    /// <summary>
    /// Conifer boughs: one folded needle frond along every limb off the trunk, broad at the trunk and pointed at the tip,
    /// its sides drooping from a ridge on the limb. Whorls of them make the clear tiers of a low-poly pine, and the
    /// tiers the cone. The level's leaf budget sets how many segments each has, and on the farthest levels how many
    /// limbs keep one (wider, to cover for the others).
    /// </summary>
    private static void AddBoughs(Mesh3D m, TreeSkeleton sk, TreeRecipe recipe, List<int> branchIds, int material, float detail, Random rng)
    {
        static bool Limb(TreeBranch b) => b.Level == 1 && b.Kind == "branch" && !b.Bare;
        var limbs = sk.Branches.Count(Limb);
        if (limbs == 0) return;
        var budget = recipe.LeafBudget / detail;
        const int perSegment = 8;       // four triangles, front and back
        var segs = Math.Clamp((int)(budget / (limbs * perSegment)), 2, 8);
        var every = Math.Max(1, (int)MathF.Ceiling(limbs * segs * perSegment / MathF.Max(1, budget)));
        var widen = MathF.Min(1.4f, MathF.Sqrt(every));
        // Far levels: every n-th limb from the bottom up, so each whorl keeps boughs on different sides.
        var order = sk.Branches.Where(Limb).OrderBy(b => b.ParentT).Select((b, i) => (b.Id, i)).ToDictionary(x => x.Id, x => x.i);
        foreach (var id in branchIds)
        {
            var b = sk.Branches[id];
            // Also on a limb the wood left out: the bough starts at the trunk, so it never floats.
            if (!Limb(b)) continue;
            if (every > 1 && order[id] % every != 0) continue;
            var centres = new List<Vector3>();
            var across = new List<Vector3>();
            var widths = new List<float>();
            for (var j = 0; j <= segs; j++)
            {
                var t = 0.04f + 0.96f * j / segs;
                var (p, _, dir) = b.At(t);
                var a = Vector3.Cross(dir, Vector3.UnitY);
                a = a.LengthSquared() > 1e-6f ? Vector3.Normalize(a) : b.Normals[0];
                centres.Add(p);
                across.Add(a);
                widths.Add(b.Length * (float)recipe.LeafSize * 0.55f * widen * (0.15f + 0.85f * MathF.Cos(MathF.PI / 2 * t)));
            }
            Strip(m, centres, across, widths, LeafCell(recipe, rng), hanging: false, sk, recipe, b, 1, material, fold: 0.6f);
        }
    }

    /// <summary>Mushroom caps: the big one on top of the trunk, smaller ones on the limb tips.</summary>
    private static void AddCaps(Mesh3D wood, TreeSkeleton sk, TreeRecipe recipe, Group g, int material, float detail)
    {
        var sides = Math.Max(8, (int)(28 / detail));
        if (g.Index == 0)
        {
            var (top, _, dir) = sk.Trunk.At(1);
            FantasyParts.Cap(wood, material, top, dir, (float)recipe.CapWidth, sides, p => Wind(sk.Trunk, 1, p, sk, recipe));
        }
        if (recipe.BranchCaps <= 0) return;
        var limbs = g.Branches.Select(id => sk.Branches[id]).Where(b => b.Kind == "branch" && b.Children.All(c => sk.Branches[c].Bare)).ToList();
        var longest = limbs.Select(b => b.Length).DefaultIfEmpty(1).Max();
        foreach (var b in limbs)
        {
            var (tip, _, dir) = b.At(1);
            var w = (float)(recipe.CapWidth * recipe.BranchCaps) * (0.6f + 0.4f * b.Length / longest);
            FantasyParts.Cap(wood, material, tip, dir, w, Math.Max(6, sides * 2 / 3), p => Wind(b, 1, p, sk, recipe));
        }
    }

    /// <summary>Crystal clusters on the outer branch tips (instead of leaves): a few pointed shards fanning out of each.</summary>
    private static void AddCrystals(Mesh3D m, TreeSkeleton sk, TreeRecipe recipe, List<int> branchIds, int material, float detail, Random rng)
    {
        var deepest = sk.Branches.Where(b => !b.Root && !b.Bare).Max(b => b.Level);
        foreach (var id in branchIds)
        {
            var b = sk.Branches[id];
            if (b.Root || b.Bare || b.Level < deepest) continue;
            var (tip, _, dir) = b.At(1);
            var n = Math.Max(1, (int)((2 + (int)MathF.Round(4 * (float)recipe.LeafDensity)) / detail));
            for (var k = 0; k < n; k++)
            {
                var spread = new Vector3((float)rng.NextDouble() - 0.5f, (float)rng.NextDouble() * 0.4f, (float)rng.NextDouble() - 0.5f) * 1.2f;
                var axis = Vector3.Normalize(dir + Vector3.UnitY * 0.4f + spread);
                var length = (float)recipe.LeafSize * (0.6f + 0.7f * (float)rng.NextDouble()) * (k == 0 ? 1.3f : 1);
                FantasyParts.Shard(m, material, tip - axis * length * 0.12f, axis, length, Wind(b, 1, tip, sk, recipe) with { Z = 0 });
            }
        }
    }

    /// <summary>Spanish moss: grey-green ribbons hanging under the branches (the swamp look), crossed, swaying.</summary>
    private static void AddMoss(Mesh3D m, TreeSkeleton sk, TreeRecipe recipe, List<int> branchIds, int material, float detail, Random rng)
    {
        var scale = Math.Clamp((float)recipe.Height / 10, 0.4f, 3f);
        // Moss shares the leaf budget: at most 30 % of it, strands thinned evenly over the tree (and shorter ribbons
        // when the budget is small).
        var segs = recipe.LeafBudget < 4000 ? 2 : 4;
        var perStrand = 2 * segs * 8;
        // Only from wood this level has: moss on a twig it left out would hang in the air.
        bool Hangs(TreeBranch b) => !(b.Root || b.Bare || b.Level == 0) && missingWood?.Contains(b.Id) != true;
        var wanted = branchIds.Select(id => sk.Branches[id]).Where(Hangs).Sum(b => (float)recipe.Moss * 1.6f * b.Length / scale / detail);
        var keep = wanted <= 0 ? 1 : MathF.Min(1, recipe.LeafBudget * 0.3f / detail / (wanted * perStrand));
        foreach (var id in branchIds)
        {
            var b = sk.Branches[id];
            if (!Hangs(b)) continue;
            var asked = (float)recipe.Moss * 1.6f * b.Length / scale / detail * keep;
            var count = (int)asked + (rng.NextDouble() < asked - (int)asked ? 1 : 0);
            for (var c = 0; c < count; c++)
            {
                var t = 0.15f + 0.8f * (float)rng.NextDouble();
                var (p, r, _) = b.At(t);
                var length = MathF.Min(scale * (0.5f + 1.3f * (float)rng.NextDouble()), p.Y - 0.3f);
                if (length < 0.15f) continue;
                var cell = LeafAtlas.Cell(rng.Next(4));
                var turn = (float)(rng.NextDouble() * MathF.PI);
                for (var k = 0; k < 2; k++)
                {
                    var across = Vector3.Transform(Vector3.UnitX, Quaternion.CreateFromAxisAngle(Vector3.UnitY, turn + MathF.PI / 2 * k));
                    var centres = Enumerable.Range(0, segs + 1).Select(j => p - Vector3.UnitY * (r * 0.5f + length * j / segs)).ToList();
                    var widths = Enumerable.Range(0, segs + 1).Select(j => scale * 0.35f * (0.6f + 0.4f * MathF.Sin(MathF.PI * (0.2f + 0.8f * j / segs)))).ToList();
                    Strip(m, centres, Enumerable.Repeat(across, segs + 1).ToList(), widths, cell, hanging: true, sk, recipe, b, t, material);
                }
            }
        }
    }

    /// <summary>
    /// A strip of cards along a line (hanging ribbons, fronds, moss): left, raised middle and right vertices per point,
    /// one atlas cell over its whole length (from the anchor), front and back faces, flutter rising along it.
    /// </summary>
    private static void Strip(Mesh3D m, List<Vector3> centres, List<Vector3> across, List<float> widths, Vector4 cell, bool hanging, TreeSkeleton sk, TreeRecipe recipe, TreeBranch b, float t, int material, float fold = 0.25f)
    {
        var sub = m.Sub(material);
        var first = m.VertexCount;
        var n = centres.Count;
        var baseWind = Wind(b, t, centres[0], sk, recipe);
        for (var j = 0; j < n; j++)
        {
            var along = centres[Math.Min(n - 1, j + 1)] - centres[Math.Max(0, j - 1)];
            along = along.LengthSquared() > 1e-8f ? Vector3.Normalize(along) : -Vector3.UnitY;
            var a = across[j];
            var face = Vector3.Normalize(Vector3.Cross(a, along));
            if (!hanging && face.Y < 0) face = -face;
            var s = j / (float)(n - 1);
            var v = cell.W + (cell.Y - cell.W) * s;      // from the anchor (bottom of the cell) to its top
            for (var c = 0; c < 3; c++)
            {
                var x = c - 1;
                var pos = centres[j] + a * widths[j] * x + (c == 1 ? face * widths[j] * fold : Vector3.Zero);
                var u = cell.X + (cell.Z - cell.X) * (c / 2f);
                var own = Vector3.Normalize(face - a * x * 0.35f);
                var wind = recipe.Wind ? baseWind with { Z = s } : Vector4.Zero;
                m.AddVertex(pos, Vector3.Normalize(Vector3.Lerp(own, CrownOut(pos, sk), (float)recipe.CrownNormals)), new Vector2(u, v), wind);
                m.AddVertex(pos, Vector3.Normalize(Vector3.Lerp(-own, CrownOut(pos, sk), (float)recipe.CrownNormals)), new Vector2(u, v), wind);
            }
        }
        for (var j = 0; j + 1 < n; j++)
            for (var c = 0; c < 2; c++)
            {
                int F(int jj, int cc) => first + (jj * 3 + cc) * 2;
                int a0 = F(j, c), a1 = F(j, c + 1), b0 = F(j + 1, c), b1 = F(j + 1, c + 1);
                sub.Indices.AddRange([a0, a1, b1, a0, b1, b0]);
                sub.Indices.AddRange([a0 + 1, b1 + 1, a1 + 1, a0 + 1, b0 + 1, b1 + 1]);
            }
    }

    /// <summary>
    /// One card: anchored at its bottom middle on the branch, growing along <paramref name="grow"/>, folded slightly along
    /// its middle, facing as close to up-and-out as it can (with a little random roll), from one of the atlas cells.
    /// </summary>
    private static void Card(Mesh3D m, Vector3 anchor, Vector3 grow, float size, TreeSkeleton sk, TreeRecipe recipe, TreeBranch b, float t, int material, Random rng, Vector4? windOverride = null, Vector3? face = null)
    {
        var want = face ?? Vector3.Normalize(Vector3.UnitY * 0.6f + CrownOut(anchor, sk) * 0.4f);
        var f = want - grow * Vector3.Dot(want, grow);
        if (f.LengthSquared() < 1e-6f) f = Vector3.Cross(grow, Vector3.UnitX);
        f = Vector3.Normalize(f);
        f = Vector3.Normalize(Vector3.Transform(f, Quaternion.CreateFromAxisAngle(grow, ((float)rng.NextDouble() - 0.5f) * (face == null ? 0.9f : 0.3f))));
        var across = Vector3.Normalize(Vector3.Cross(grow, f));
        var cell = LeafCellIndex(recipe, rng);
        var cellUv = cell < 4 ? LeafAtlas.Cell(cell) : new Vector4(0, 0, 1, 1);
        var half = size / 2;
        var fold = f * size * 0.12f;
        var sub = m.Sub(material);
        var first = m.VertexCount;
        var baseWind = windOverride ?? Wind(b, t, anchor, sk, recipe);
        // The card's corners in its own space (x −1…1 across, y 0 at the anchor … 1 at the tip): the leaves' outline,
        // or a rectangle with its middle raised.
        var shape = cardShapes?[cell];
        List<Vector2> corners;
        if (shape != null)
        {
            corners = shape.Select(c => new Vector2(c.X * 2 - 1, 1 - c.Y)).ToList();
            if (Area(corners) < 0) corners.Reverse();     // counter-clockwise seen from the front
        }
        else corners = [new(-1, 0), new(0, 0), new(1, 0), new(1, 1), new(0, 1), new(-1, 1)];
        foreach (var c in corners)
        {
            // Folded along the middle: raised most there, nothing at the edges.
            var p = anchor + grow * size * c.Y + across * half * c.X + fold * (1 - MathF.Min(1, MathF.Abs(c.X)));
            var uv = new Vector2(cellUv.X + (cellUv.Z - cellUv.X) * (c.X * 0.5f + 0.5f), cellUv.W + (cellUv.Y - cellUv.W) * c.Y);   // bottom of the cell is the anchor
            var own = Vector3.Normalize(f - across * c.X * 0.35f);
            var wind = recipe.Wind ? baseWind with { Z = c.Y } : Vector4.Zero;
            m.AddVertex(p, Vector3.Normalize(Vector3.Lerp(own, CrownOut(p, sk), (float)recipe.CrownNormals)), uv, wind);
            m.AddVertex(p, Vector3.Normalize(Vector3.Lerp(-own, CrownOut(p, sk), (float)recipe.CrownNormals)), uv, wind);
        }
        // Front (even vertices, a fan) and back (odd, wound the other way).
        int F(int k) => first + k * 2;
        int Bk(int k) => first + k * 2 + 1;
        if (shape == null)
        {
            // The rectangle: two quads either side of the raised middle.
            sub.Indices.AddRange([F(0), F(1), F(4), F(0), F(4), F(5), F(1), F(2), F(3), F(1), F(3), F(4)]);
            sub.Indices.AddRange([Bk(0), Bk(4), Bk(1), Bk(0), Bk(5), Bk(4), Bk(1), Bk(3), Bk(2), Bk(1), Bk(4), Bk(3)]);
            return;
        }
        for (var k = 1; k + 1 < corners.Count; k++)
        {
            sub.Indices.AddRange([F(0), F(k), F(k + 1)]);
            sub.Indices.AddRange([Bk(0), Bk(k + 1), Bk(k)]);
        }
    }

    private static float Area(List<Vector2> poly)
    {
        var a = 0f;
        for (var i = 0; i < poly.Count; i++) { var p = poly[i]; var q = poly[(i + 1) % poly.Count]; a += p.X * q.Y - q.X * p.Y; }
        return a / 2;
    }

    /// <summary>The outline of each leaf sprite (atlas cells 0–3, a whole picture 4) while a tree is built; null: rectangles.</summary>
    [ThreadStatic] private static Vector2[]?[]? cardShapes;

    /// <summary>A small copy of the leaf picture while a tree is built: what the crown's fullness is measured with.</summary>
    [ThreadStatic] private static RawImage? measureLeaves;

    /// <summary>Branches left out of the wood of the level being built (twigs a small budget drops).</summary>
    [ThreadStatic] private static HashSet<int>? missingWood;

    /// <summary>
    /// Where a leaf meant for point <paramref name="p"/> of branch <paramref name="b"/> really hangs: there, if the branch is
    /// in this level's wood; else on the nearest point of its nearest ancestor that is (no leaves floating where a dropped
    /// twig would have been), with the way out towards the twig's spot, so the card still covers it.
    /// </summary>
    private static (Vector3 Anchor, Vector3? Toward, TreeBranch On, float T) Attach(TreeSkeleton sk, TreeBranch b, Vector3 p)
    {
        if (missingWood == null || !missingWood.Contains(b.Id)) return (p, null, b, -1);
        var a = b;
        while (a.Parent >= 0 && missingWood.Contains(a.Id)) a = sk.Branches[a.Parent];
        var best = a.Points[0];
        var bestT = 0f;
        var bestD = float.MaxValue;
        for (var i = 0; i + 1 < a.Points.Count; i++)
        {
            var ab = a.Points[i + 1] - a.Points[i];
            var u = Math.Clamp(Vector3.Dot(p - a.Points[i], ab) / MathF.Max(1e-8f, ab.LengthSquared()), 0, 1);
            var q = a.Points[i] + ab * u;
            var d = Vector3.DistanceSquared(p, q);
            if (d < bestD) { bestD = d; best = q; bestT = (i + u) / (a.Points.Count - 1); }
        }
        var away = p - best;
        return (best, away.LengthSquared() > 1e-8f ? Vector3.Normalize(away) : null, a, bestT);
    }

    /// <summary>
    /// Fills the crown where it is see-through. The crown is drawn from four sides (the leaves cut out by their alpha);
    /// spots a little out from every leafy branch are scored by how many gaps a card there would cover, and the best,
    /// a card apart, get one, in rounds, until the crown is as full as asked or the leaf budget is spent. Cards go on
    /// the branch's own group (its leaves mesh), with the branch's wind.
    /// </summary>
    private static (double Before, double After, int Added) FillCrown(List<(Group G, Mesh3D Wood, Mesh3D Leaves)> made, TreeSkeleton sk, TreeRecipe recipe,
        List<Material3D> materials, int leafIndex, float detail, float grew, Random rng, CancellationToken ct)
    {
        var target = recipe.CanopyFullness;
        // As big as the other cards (which the leaf budget may have made bigger).
        var size = (float)recipe.LeafSize * PlaneScale(recipe) * MathF.Sqrt(detail) * MathF.Min(MathF.Sqrt(grew), GrowCap(recipe));
        var leafTris = made.Sum(x => x.Leaves.TriangleCount);
        var room = recipe.LeafBudget / detail - leafTris;
        // Where the crown is: everything drawn, and room for a card past the outermost leaves.
        float halfWidth = 0.5f, top = 0.5f;
        foreach (var (_, wood, leaves) in made)
            foreach (var p in wood.Positions.Concat(leaves.Positions)) { halfWidth = MathF.Max(halfWidth, MathF.Max(MathF.Abs(p.X), MathF.Abs(p.Z))); top = MathF.Max(top, p.Y); }
        var cov = new CrownCoverage(halfWidth + size, top + size * 0.5f);
        void DrawMesh(Mesh3D m, bool leaf, int from = 0)
        {
            foreach (var sub in m.Submeshes)
            {
                var cut = leaf && sub.Material == leafIndex && materials[leafIndex].Alpha == "mask" ? measureLeaves : null;
                for (var i = sub == m.Submeshes[0] ? from : 0; i + 2 < sub.Indices.Count; i += 3)
                {
                    int a = sub.Indices[i], b = sub.Indices[i + 1], c = sub.Indices[i + 2];
                    Vector2 U(int v) => m.UV0.Count > v ? m.UV0[v] : Vector2.Zero;
                    cov.Draw(m.Positions[a], m.Positions[b], m.Positions[c], U(a), U(b), U(c), cut, 0.5f, leaf);
                }
            }
        }
        foreach (var (_, wood, leaves) in made) { DrawMesh(wood, false); DrawMesh(leaves, true); }
        var before = cov.Refresh();
        if (before >= target || room < 8) return (before, before, 0);

        // Spots to fill: along every leafy branch, a little out from it in six directions.
        var deepest = sk.Branches.Where(b => !b.Root && !b.Bare).Select(b => b.Level).DefaultIfEmpty(0).Max();
        var spots = new List<(int Made, TreeBranch B, float T, Vector3 Anchor, Vector3 Out, Vector3 Centre)>();
        for (var gi = 0; gi < made.Count; gi++)
            foreach (var id in made[gi].G.Branches)
            {
                var b = sk.Branches[id];
                if (b.Root || b.Bare || (b.Level == 0 && deepest > 0) || b.Level < deepest - 1) continue;
                var steps = Math.Max(1, (int)(b.Length / (size * 0.6f)));
                for (var k = 0; k < steps; k++)
                {
                    var t = 0.2f + 0.8f * (k + 0.5f) / steps;
                    var (p, _, dir) = b.At(t);
                    var n0 = b.Normals[Math.Min(b.Normals.Count - 1, (int)(t * (b.Points.Count - 1)))];
                    // A twig left out of the wood: the spot is on the nearest branch that is there.
                    var (anchor, toward, _, _) = Attach(sk, b, p);
                    for (var d = 0; d < 6; d++)
                    {
                        var side = Vector3.Normalize(Vector3.Transform(n0, Quaternion.CreateFromAxisAngle(dir, MathF.Tau * d / 6)));
                        var outward = Vector3.Normalize(side + dir * 0.3f + Vector3.UnitY * 0.2f + (toward ?? Vector3.Zero) * 0.8f);
                        spots.Add((gi, b, t, anchor, outward, anchor + outward * size * 0.5f));
                    }
                }
            }
        if (spots.Count == 0) return (before, before, 0);
        var used = new bool[spots.Count];
        var after = before;
        var added = 0;
        while (after < target && room >= 8)
        {
            ct.ThrowIfCancellationRequested();
            // The best spots this round, a card apart from each other.
            var ranked = Enumerable.Range(0, spots.Count).Where(i => !used[i]).Select(i => (I: i, S: cov.Score(spots[i].Centre, size * 0.5f))).Where(x => x.S >= 3).OrderByDescending(x => x.S).ToList();
            if (ranked.Count == 0) break;
            var picked = new List<int>();
            foreach (var (i, _) in ranked)
            {
                if (picked.Count >= 12) break;
                if (picked.Any(j => Vector3.DistanceSquared(spots[j].Centre, spots[i].Centre) < size * size * 0.36f)) continue;
                picked.Add(i);
            }
            foreach (var i in picked)
            {
                used[i] = true;
                var (gi, b, t, anchor, outward, _) = spots[i];
                var leaves = made[gi].Leaves;
                var sub = leaves.Sub(leafIndex);
                var from = sub.Indices.Count;
                var trisBefore = leaves.TriangleCount;
                Card(leaves, anchor, outward, size * (0.85f + 0.3f * (float)rng.NextDouble()), sk, recipe, b, t, leafIndex, rng);
                room -= leaves.TriangleCount - trisBefore;
                added++;
                var cut = materials[leafIndex].Alpha == "mask" ? measureLeaves : null;
                for (var k = from; k + 2 < sub.Indices.Count; k += 3)
                {
                    int a = sub.Indices[k], bb = sub.Indices[k + 1], c = sub.Indices[k + 2];
                    cov.Draw(leaves.Positions[a], leaves.Positions[bb], leaves.Positions[c], leaves.UV0[a], leaves.UV0[bb], leaves.UV0[c], cut, 0.5f, true);
                }
                if (room < 8) break;
            }
            after = cov.Refresh();
        }
        return (before, after, added);
    }

    // ---- Helpers ----

    /// <summary>Which part of the leaf picture a card shows: a cell of the 2 × 2 atlas, or all of a picture of your own that isn't one.</summary>
    private static Vector4 LeafCell(TreeRecipe recipe, Random rng)
    {
        var cell = LeafCellIndex(recipe, rng);
        return cell < 4 ? LeafAtlas.Cell(cell) : new Vector4(0, 0, 1, 1);
    }

    /// <summary>The same as an index: 0–3 a cell of the atlas, 4 the whole picture.</summary>
    private static int LeafCellIndex(TreeRecipe recipe, Random rng)
    {
        var cell = rng.Next(4);
        return recipe.LeafImage != "" && !recipe.LeafImageAtlas ? 4 : cell;
    }

    private static void Use(Material3D m, RawImage pixels)
    {
        m.BaseColorPixels = pixels;
        m.BaseColorPng = pixels.Png();
    }

    /// <summary>
    /// Painted shading in the vertex colours (what engines and viewers multiply the textures by): leaves darker deep in
    /// the crown and underneath, lighter on its outer, upper side, with soft patches like brush strokes; wood darker
    /// near the ground and under the crown. Skipped when the vertex colours carry the wind data.
    /// </summary>
    private static void Shade(Mesh3D m, TreeSkeleton sk, TreeRecipe recipe, bool leafy)
    {
        if (recipe.Shading <= 0 || m.VertexCount == 0 || (recipe.Wind && recipe.WindData == "color")) return;
        var amount = (float)recipe.Shading;
        var c = sk.CrownCentre;
        var r = MathF.Max(0.3f, sk.CrownRadius);
        var h = MathF.Max(0.5f, sk.Height);
        m.Colors.Clear();
        foreach (var p in m.Positions)
        {
            float light;
            var d = Math.Clamp(Vector3.Distance(p, c) / r, 0, 1);
            if (leafy)
            {
                var t = Math.Clamp((p.Y - (c.Y - r)) / (2 * r), 0, 1);
                var patch = 0.12f * MathF.Sin(p.X * 1.7f + p.Z * 0.9f) * MathF.Sin(p.Y * 1.3f + p.X * 0.5f);
                light = 0.42f + 0.58f * Math.Clamp(0.55f * d + 0.45f * t + patch, 0, 1);
            }
            else
            {
                var ground = Math.Clamp(p.Y / MathF.Max(1.5f, 0.25f * h), 0, 1);
                light = (0.55f + 0.45f * MathF.Sqrt(ground)) * (0.78f + 0.22f * d);
            }
            var s = 1 + (light - 1) * amount;
            // Shade a touch cooler than light, as painters do.
            m.Colors.Add(new Vector4(s, s, Math.Min(1, s * 1.04f), 1));
        }
    }

    /// <summary>Moves the wind data from the working vertex colours to where the recipe wants it.</summary>
    private static void WindChannel(Mesh3D m, TreeRecipe recipe)
    {
        if (!recipe.Wind) { m.Colors.Clear(); return; }
        if (recipe.WindData == "color" || m.Colors.Count != m.VertexCount) return;
        m.UV1.Clear(); m.UV2.Clear();
        foreach (var c in m.Colors) { m.UV1.Add(new Vector2(c.Y, c.Z)); m.UV2.Add(new Vector2(c.W, c.X)); }
        m.Colors.Clear();
    }

    private static Vector4 Color(string hex)
    {
        var c = LeafAtlas.Hex(hex);
        // sRGB to linear for the glTF colour factor.
        static float Lin(float v) => v <= 0.04045f ? v / 12.92f : MathF.Pow((v + 0.055f) / 1.055f, 2.4f);
        return new Vector4(Lin(c.X), Lin(c.Y), Lin(c.Z), 1);
    }

    private static Mesh3D Copy(Mesh3D m)
    {
        var c = new Mesh3D { Name = m.Name };
        c.Positions.AddRange(m.Positions); c.Normals.AddRange(m.Normals); c.UV0.AddRange(m.UV0); c.Colors.AddRange(m.Colors);
        foreach (var s in m.Submeshes) c.Sub(s.Material).Indices.AddRange(s.Indices);
        return c;
    }

    /// <summary>Adds b's vertices and triangles to a (attributes a lacks are filled with defaults).</summary>
    internal static void Append(Mesh3D a, Mesh3D b)
    {
        if (b.VertexCount == 0) return;
        var offset = a.VertexCount;
        var colors = a.Colors.Count > 0 || b.Colors.Count > 0;
        if (colors) while (a.Colors.Count < a.VertexCount) a.Colors.Add(Vector4.One);
        a.Positions.AddRange(b.Positions);
        a.Normals.AddRange(b.Normals.Count == b.VertexCount ? b.Normals : Enumerable.Repeat(Vector3.UnitY, b.VertexCount));
        a.UV0.AddRange(b.UV0.Count == b.VertexCount ? b.UV0 : Enumerable.Repeat(Vector2.Zero, b.VertexCount));
        if (colors) a.Colors.AddRange(b.Colors.Count == b.VertexCount ? b.Colors : Enumerable.Repeat(Vector4.One, b.VertexCount));
        foreach (var s in b.Submeshes) a.Sub(s.Material).Indices.AddRange(s.Indices.Select(i => i + offset));
    }

    private static void Offset(Mesh3D m, Vector3 d)
    {
        if (d == Vector3.Zero) return;
        for (var i = 0; i < m.VertexCount; i++) m.Positions[i] += d;
    }

    /// <summary>Faceted look: every triangle gets its own corners with its face normal.</summary>
    internal static Mesh3D Flatten(Mesh3D m)
    {
        var f = new Mesh3D { Name = m.Name };
        foreach (var s in m.Submeshes)
        {
            var sub = f.Sub(s.Material);
            for (var i = 0; i + 2 < s.Indices.Count; i += 3)
            {
                int a = s.Indices[i], b = s.Indices[i + 1], c = s.Indices[i + 2];
                var n = Vector3.Cross(m.Positions[b] - m.Positions[a], m.Positions[c] - m.Positions[a]);
                n = n.LengthSquared() > 1e-20f ? Vector3.Normalize(n) : Vector3.UnitY;
                foreach (var v in new[] { a, b, c })
                    sub.Indices.Add(f.AddVertex(m.Positions[v], n, m.UV0.Count > v ? m.UV0[v] : Vector2.Zero, m.Colors.Count > v ? m.Colors[v] : null));
            }
        }
        return f;
    }
}
