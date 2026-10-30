# NoorForm: plan (trees, rocks, and later formations)

Builds on the concept in [concepts/PROCEDURAL_TREES_ROCKS.md](concepts/PROCEDURAL_TREES_ROCKS.md). The goal is
game-ready 3D nature assets in two looks: **realistic** (up to hyper-realistic) and **stylized** (painterly,
Blizzard / World of Warcraft-like). They are exported as ordinary GLB files that import cleanly into Blender and
game engines.

## Requirements (from the conversation)

- **Real meshes, not primitives.** Trees are one organic surface: branches grow out of the trunk with smooth collars,
  the base flares into roots, and forks blend. They are not scaled, tapered cylinders pushed into each other.
- **Merged or separate branches.** One welded mesh, or branches as their own named meshes (pivots at their bases),
  or a mix (thicker than a chosen size welded, thinner ones separate).
- **Both looks for trees and rocks:** realistic (up to hyper-realistic rocks) and stylized (WoW-like: exaggerated,
  chunky, twisted, painted).
- The game this is for is low-poly and stylized, so budgets, flat-shading options and clean low-poly meshes matter as
  much as dense realistic ones.

## Principles

- **Native and deterministic.** Everything is C# in NoorMD.Media (no Blender, no Python). The same recipe and seed
  give the same mesh, and the recipe is kept beside the export to edit later.
- **Skeleton first.** A tree is a branch graph (segments with radius, order and parent). The surface, UVs, foliage,
  LODs, wind data, collision and billboard all come from it.
- **Implicit surfaces for organic shapes.** Branches (and rocks) are signed-distance shapes blended with a smooth
  union, then extracted as a mesh. This gives welded junctions, root flares and knots naturally. Sharp-feature
  extraction keeps stylized rocks crisp.
- **Budgets, not accidents.** Every asset is simplified to a triangle budget per LOD with a quality-aware
  simplifier. Fine detail that doesn't fit the budget is baked into a normal map.
- **Checked output.** Exports pass the Khronos glTF validator in CI. Meshes are tested for finite positions,
  winding, normals, UV ranges and watertightness where expected.

## The shared foundation

- **Mesh model:** positions, normals, tangents, UV0 (and UV1 for bakes), vertex colours, submeshes and materials,
  nodes with names and pivots.
- **Implicit modelling:** capsule and cone-segment distance fields, smooth union with an adjustable blend, noise
  displacement, Voronoi fracture planes, strata; evaluated only in a narrow band near the surface, so it is fast.
- **Surface extraction:** surface nets (smooth, for trees) and dual contouring (keeps sharp edges, for stylized
  rocks).
- **Simplification:** quadric error, keeping UV seams, sharp edges and the silhouette, down to a triangle budget.
- **UVs:** from the skeleton for trees (around and along each branch); cube-projection charts with padding for
  rocks.
- **Baking:** high-detail to low-poly normal, AO and curvature maps (CPU ray casting with a BVH).
- **Materials:** from NoorMaterial (bark, rock, moss), which gains a painted style for the stylized look;
  vertex-colour gradients and painted ambient occlusion for stylized assets.
- **Export:** GLB (and glTF with separate files), named nodes, Y-up in metres, a pivot at the base, LODs as separate
  files or as named nodes, and a manifest. OBJ for static meshes.
- **Preview:** WebGL in the page: orbit, lights, wireframe, normals, UV checker, LOD switching, the triangle count,
  a ground grid, and wind playing on the real wind data.

## Stage 1 — trees (preview.53, done)

What shipped, and how it works:

- **Growth** (`TreeSkeleton`): a trunk with roots, then up to three levels of branches placed along their parent
  (golden-angle spiral or whorls), angled, bent towards the light or drooping, wobbling, twisting; lengths follow
  the crown shape; the tree is scaled to exactly the asked height. Seven presets: oak, pine, birch and dead tree
  (realistic); oak, pine and dead tree (stylized).
- **Wood** (`ImplicitField`): every limb thick enough for the grid is a round cone in a signed distance field,
  joined with a smooth union (wide at a limb's base: the collar; roots melt into the flare). The surface is
  extracted as a closed, manifold mesh (patch loops per cell, decided per face so neighbours agree, a centre vertex
  for larger patches), pulled onto the true surface, then simplified to the budget with quadric error
  (`Simplifier`: link condition, no fold-overs, borders kept). Normals come from the field; bark UVs from the
  skeleton (around in whole repeats, along in tiles), split at the wrap-around seam and where branches meet;
  tangents for the normal map. Twigs thinner than the grid are swept tubes starting inside their parent.
- **Branches mode:** merged (one mesh), separate (each level-1 limb with everything on it is its own node, pivot
  where it leaves the trunk, its base reaching into the trunk) or mixed (a radius decides).
- **Leaves** (`LeafAtlas`): a generated 2 × 2 atlas of twig sprites (broad, round, maple-like, needles; painted for
  the stylized look) with the anchor at the bottom middle of each cell; cards anchored on the outer branches,
  growing away from them, facing up and out, with a real back face (so lighting is right in every engine) and
  normals bent out of the crown. Tufts (the stylized default): the same cards gathered over clump shapes, also
  deeper inside so the canopy looks full, with no solid mesh. Solid clumps (an option): blobs at the branch tips joined with a little blending (distinct lobes),
  coloured by a gradient texture (dark under, light on top); conifers get tiers and a tip.
- **Wind data:** trunk sway, branch bend, leaf flutter, phase; in TEXCOORD_1/2 by default (vertex colours would tint
  the model in viewers and Godot), or COLOR_0 as an option. The manifest says which.
- **Levels of detail:** each about half the triangles; distant levels drop the finest twigs and use fewer, bigger
  cards covering the same area. Exported as a file each (Name_LOD0.glb…) or in one file (nodes Name_LOD0…).
- **Checked:** unit tests for the field, extraction (closed and manifold, also with 40 random forks), simplifier,
  growth, every preset in every branches mode, cards, wind data and UV seams; the Khronos validator runs on
  generated trees in CI.

Still to do from the original stage 1 list: a ready-made wind shader for the main engine (waiting for which engine),
billboards (crossed-card impostors) and variety packs (N seeds at once).

The original stage 1 plan:

- **Growth:** parametric branching (from Weber & Penn's paper: per-level split angles, taper, curvature, branch
  counts) with species profiles as data. Four archetypes to start: broadleaf (oak-like), conifer, birch-like, and
  dead or twisted.
- **Surface:** the implicit welded trunk with collars, root flare, knots and bark ridges, extracted and simplified.
  Separate, merged or mixed branches.
- **Looks:** realistic (natural proportions, leaf and twig cards with alpha, PBR bark) and stylized (exaggerated
  twist and taper, chunky limbs, leaf clumps with outward-pointing normals, painted gradients).
- **Foliage cards:** generated twig and leaf atlases with known anchors and growth directions (no authoring
  needed), placed by the hotpoint rules from the concept (anchor at the branch, growth direction away from it,
  bounded randomness, no flips).
- **Wind data** in vertex colours (trunk sway, branch bend, leaf flutter, phase), with a ready shader for the main
  engine.
- **LODs:** any number of levels, each a triangle budget (branch orders pruned, fewer sides, foliage merged), plus a
  crossed-card billboard.
- **Export:** GLB plus the recipe and a manifest; variety packs (N seeds with a size and age spread).

## Stage 1b — ideas taken from CanopyForge (the Blender add-on used before)

CanopyForge 1.2 (a Blender add-on: voxel-remeshed wood, foliage cards, biome recipes) was "somewhat good, not
perfect". NoorMD already does several of its parts more completely (no Blender; its own manifold extraction and
quadric simplifier instead of voxel remesh plus decimate; bark UVs per branch instead of one cylindrical projection
around the trunk, which stretches on side branches; wind data exported in the file instead of Blender-only vertex
groups; the Khronos validator in CI). Worth taking from it:

1. **Card arrangements per foliage tuft:** single, X-cross, three-plane star, tilted cross, canopy fan, dome (four
   inclined cards plus a cap), hanging ribbons (willow), radial fronds (palms, tree ferns); with card segments,
   camber and tilt. Readable from every side, cheap, and the classic game-art way.
2. **Roots:** a choice of branching surface roots (curved, forked, flattened oval section, tips buried below the
   ground), the classic flared base, or a compact collar (birch, palm, bamboo).
3. **Trunk shape:** fluting (lobes round the trunk), S-curve, and growth profiles (baobab bottle, palm, bamboo with
   nodes).
4. **Growth architectures:** umbrella crown, windswept, palm, tree fern, mangrove prop roots, bamboo, baobab, thorns,
   hanging vines, fungal (mushroom cap), crystalline. The fantasy ones suit the game.
5. **A painted bark texture** for the stylized look (grain and cracks), and a bring-your-own bark image and leaf
   atlas (2 × 2 or a single picture).
6. **LODs by whole cards** (never broken cards), batch variants (consecutive seeds), and a validation report
   (connected wood, non-manifold edges, degenerate faces, UVs, materials, card count).
7. **Biome recipes:** its catalogue of 79 biomes with two recipes each, as starting points once the architectures
   exist.

### Done in preview.54 (variety: swamps, willows, giants, palms, fantasy)

Items 1–4 and 6 (batch variants) of the list above, for the swamp-and-marsh world and a lot of variety:

- **Trunk:** fluting (welded ridges up the lower trunk, the core thinned between them), a bulge (baobab), an S-curve,
  windswept (trunk and branches streaming one way), an umbrella crown shape.
- **Roots:** flared base, surface roots (curling, forking, half sunk in the ground, the tips buried), mangrove stilts
  arching from the trunk into the ground, a compact collar; cypress knees.
- **Leaves:** cards scattered, single, crossed, as stars, fans or domes; willow curtains (crossed ribbons hanging
  from the branches, stopping above the ground, swaying more towards the tips); fronds (a strip along every outer
  branch, for palms and tree ferns); new sprites: slender willow leaves, fronds, moss.
- **Swamp:** hanging moss (its own material, also on dead trees), hanging vines.
- **Presets:** 23 new ones in six groups (forest, swamp and marsh, giants, tropical, dry and windswept, fantasy),
  most in both looks; the list filters by look.
- **Variety packs:** N trees from consecutive seeds, sizes spread ±%, the first being the tree on screen; each with
  its recipe, one manifest for the pack.

### Done in preview.55

- **Bark in the tree's colour:** "bark" (realistic furrows), "painted" (broad plates and dark grooves, the stylized
  default), "birch" (pale with dark marks), as NoorMaterial recipes, so they tile and bring normal and ORM maps.
- **Painted shading** in COLOR_0 (free now that wind is in the UVs): crowns darker inside and below with soft
  patches, trunks darker at the foot; engines and viewers multiply it with the textures.
- **Fantasy forms:** mushroom caps (a turned profile with spots on top and gills under, on the trunk and the limb
  tips), crystal shards instead of leaves, and glow (emissive) for caps, crystals and leaves. Five presets.
- **Wind shaders** written with an export: NoorTreeWind.gdshader (Godot 4) and NoorTreeWind.hlsl (Unity Shader
  Graph Custom Function, Unreal Custom node).

- **Billboards:** the last level of detail is the tree drawn from 2–4 sides by a small CPU renderer (orthographic,
  depth-tested, textured, alpha-cut, with the painted shading) onto crossed cards: a whole tree in 8–16 triangles.

- **Pictures of your own:** a bark texture (colour), and a leaf picture with transparency, a 2 × 2 atlas or one sprite
  for every card; read only when picked in the bench or named by a recipe you opened (looked for beside it).

### Godot first (preview.56)

Godot is the main engine, then Unity, then Unreal.

- **Levels that know their distances:** every level's root in the GLB carries glTF extras: its level, the camera
  distances it is seen between (the first switch a few tree heights away, each next 2.5 times farther; the
  billboard has no far limit) and whether it is the billboard. The tree's root says what the file is: its height and
  where the wind data is (UVs, colours or none). Godot keeps extras as node metadata; the manifest lists them too.
- **The Godot import plugin** (addons/noor_trees, an EditorScenePostImportPlugin): for NoorMD trees only, it sets each
  level's visibility range (with a small margin against flicker) and swaps the materials for the wind shader with
  the same textures (colour, normal, ORM, emission, alpha cutoff), one shader material per source material. Per
  file in the Import dock: on/off, distance scale, wind material on/off. Written into the project's addons folder
  when the export folder is inside a Godot project (found by project.godot above it); its files carry a version line,
  so a newer NoorMD updates them and a file you changed is kept.
- **The Godot wind shader** reads UV2 (glTF TEXCOORD_1) or, for colour-wind exports, COLOR; the phase comes from each
  instance's position (MultiMesh forests don't move in step).
- **One material list for all levels:** the billboard's material comes after the tree's own, so one-file exports
  point every mesh at the right material; the GLB writer writes only the materials a file uses.
- **Engine choice in the export:** Godot 4 (one file, the plugin), Unity (one file: the importer makes a LOD Group
  from the names; the HLSL function), Unreal (a file per level; the HLSL function), Other (both shader files).
- **Checked in Godot on CI:** a Linux job exports trees and the plugin into a project, imports them in a headless
  Godot 4.4 and checks the visibility ranges, the materials (textures kept, cutoff, wind source), that a single level
  gets no range, and that a scene not made by NoorMD is left alone (tests/godot/check.gd).

### Room to work (preview.57)

- **Settings beside the tree** (◫ in the view's toolbar): the tree takes the free room and the settings, with the name
  and seed, are a column on the right; the bar between them drags (double-click: back to normal). ☰ hides the list
  of trees. The usual arrangement (settings under the tree) stays the default; the choice is remembered. Shared
  with NoorMaterial (NoorBenchLayout).
- **The whole window** (⛶, or F11 with a bench in the middle): Focus mode now shows the bench instead of hiding it;
  “Back to NoorMD”, Esc or F11 return.

### Fuller crowns for fewer triangles (preview.58)

- **What a card shows** (Leaves → Each card shows): a twig (one stem, as before), a spray (three stems fanning out) or
  a cluster (five stems, smaller leaves filling the card): 1.3–2 times the leaf cover per card at the same 8
  triangles. The plane of a spray or cluster grows by itself (×1.3, ×1.65) so each leaf stays about its twig size.
  The leaves keep inside their cell (no cut-off edges). Realistic card presets use clusters, conifers sprays; saved
  recipes keep their twigs.
- **Card size**: each plane bigger or smaller without changing how many cards there are (before, a bigger leaf size
  also meant fewer cards, so the crown never got fuller).
- **Leaf budget** (16,000 triangles by default): when the density asks for more, there are fewer, bigger cards
  covering the same, instead of 50,000–100,000 triangles.
- **Outer leaves**: cover moved from branches deep in the crown to those near its surface, and along a branch towards
  its end (and, for tufts, cards sunk less deep), where they are seen.

### What a tree costs (preview.59)

Optimise for how the canopy looks per rendering cost, not for triangles alone. Under the preview, for each level:
wood and leaf triangles, how full the crown looks (its outline, row by row between the outermost leaves, drawn
from four sides with the cards cut out by their alpha), overdraw (leaf pixels drawn per leaf pixel seen, cut-out ones
included) and the share of the card area that is see-through, and draw calls. A note says when the leaf budget made
the cards grow. First measurements (oak): twig cards 57 % full, clusters 77 % for the same triangles; about 80 % of
every card's area is see-through, so cards cut to the leaves' shape come next.

Next, from Noor's foliage notes: filling the crown by measured coverage (a Canopy Fullness target, gaps found from
several sides, a note when the budget can't reach it); cards cut to their leaves; a stem point and growth direction
for your own leaf pictures; one total triangle target split between wood and leaves; levels of detail checked to
keep the crown's outline, and camera-facing impostors.

### Cards cut to their leaves, a fuller manifest (preview.60)

- **Cards cut to their leaves** (on by default): each sprite's outline (the convex hull of its opaque pixels, cut down
  to six corners while still holding every leaf, never leaving its cell) from a 128 px copy of the picture, so the
  shape doesn't depend on the texture size. Same 8 triangles a card (a seventh corner now and then); the oak's
  see-through card area drops from 84 % to 48 % with the crown as full.
- **The manifest** with every export, for any engine: kind, name, recipe file and seed, units and axes, bounds in
  metres, the pivot, each level with its file (or node in one file), triangles and distances, and each material's
  maps with glTF slot, colour space, channels and the normal-map convention (glTF's OpenGL, green up).
- **Godot plugin kept out of a project** if you like: written beside the trees instead.

### A full crown for a few thousand triangles (preview.61)

For scenes with hundreds of thousands of trees: most are far away (the 8-triangle billboard), and the close ones
want a few thousand triangles, not fifty.

- **Canopy fullness** (85 % by default): the crown drawn from four sides as the fullness is measured; spots a little
  out from every leafy branch are scored by how many gaps (sky through the crown) a card there would cover, and the
  best, a card apart, get one, in rounds, until the crown is as full as asked or the leaf budget is spent (a note
  says so). Cards go on the branch's own mesh with its wind. 30 % of the leaf budget is kept for this fill.
- **Triangle target** for the whole tree (Mesh tab): far forest filler 2,000, forest tree 4,000 (what built-in trees
  now start as), feature tree 8,000, hero 20,000, or the budgets by hand. A quarter for the wood (with less than
  2,500 the finest twigs, hidden in the leaves, are left out and thin branches get three or four sides on every
  second or third ring), the rest for the leaves.
- The oak: 11,300 triangles 77 % full before; at the 3,000 target about 3,300 triangles, 78 % full.

### Low-poly wood (preview.62)

A welded trunk simplified to a few hundred triangles was crushed out of shape (the 2,000 target). Below 1,600 wood
triangles the wood is now clean tubes from the skeleton: the trunk with 7 sides (more for thick trunks, up to 12:
baobab, sequoia) and rings enough to follow its curve, roots 4, main limbs 4–5, the rest 3, added most important
first (trunk, roots, main limbs, then each finer level, thick before thin) while the budget lasts; the finest twigs
left out are inside the leaves. A note says how many branches made it. Also: moss shares the leaf budget (at most
30 %, strands thinned evenly, shorter ribbons when it is small); willow curtains are wider with fewer segments on
small budgets and the canopy fill also fills a willow's crown; cards grown by the budget stop at twice the leaf size
(beyond that a spruce turns into a bush; the crown is thinner instead).

Fix (preview.63): tubes were wound inwards (faces against their normals), so engines culled their outside and showed
the inside of a low-poly trunk; thin twig tubes had it from the start. Tubes and their tips now face outwards, and a
test checks every wood triangle against its normals.

### The trunk follows the level; slim conifers (preview.64)

- **The trunk's share follows the level:** low-poly trunks are round up close (10 sides or more, as thick trunks
  need, or at least the recipe's Trunk sides; 12 rings), a simple 6-sided trunk with 5 rings on the next level and
  5 sides with 3 rings beyond, where the leaves hide it; roots and limbs lose sides level by level too. A welded
  hero tree switches to these simple tubes on any farther level whose wood share is small. A 4,000 tree's second
  level costs what a whole 2,000 tree did, with a decent trunk close up.
- **Slim conifers:** pine, spruce and sequoia are 3–4 times taller than wide (taiga proportions; the pine was about
  1.9, measured across its needle cards about 1.3): shorter branches, more of them to a whorl for clear tiers, and
  needle cards the budget may grow at most 1.4 times (bigger ones stuck out past the short branches).

Fix (preview.65): in low-poly wood the flute ridges were tubes of their own, which crossed the trunk where it twists
or curves. The trunk's rings now carry the flutes as lobes (turning with the twist, as the ridges did, and keeping
the girth they stood for; far levels too simple for lobes keep the girth only). Flare and surface roots start from
where the trunk is at their height.

Fix (preview.66): leaves floated in the air where a level's wood had left out the finest twigs (small budgets,
far levels): they were still placed on the missing twigs. Each level now knows which branches are in its wood; a
card meant for a missing twig hangs from the nearest point of the nearest branch that is there, growing towards
where the twig's leaves were, and the canopy fill does the same. A test measures it (on the old code 30 % of the
oak's leaf cards at 2,000 hung in the air).

Game profiles (preview.67): trees made for one game, without NoorMD becoming that game's tool. A profile
(GameProfiles.cs) only picks settings every tree has anyway, and the files stay plain glTF and JSON:
* **Triangles per level** (`lodTriangles`): a game that knows what each distance affords sets each level (e.g.
  2,800 / 1,100 / 220) instead of one target halved; each shared out as before (a quarter to the wood), and far
  levels have no floor (a trunk and a few big cards). Mesh tab: "Set each level" / "Use one target".
* **Pixel art** (`pixels`: 32, 64 or 128): every texture shrunk to that size (each pixel the average of the opaque
  ones it covers, cut out hard), reduced to 12 colours, sampled NEAREST in the glTF; no normal or ORM maps. The
  leaf outlines are cut from the pixel texture, so they fit its hard edges.
* **Thornwake**, the first profile: its pack's nine species at their heights and triangles per level (pine, spruce,
  green and autumn birch, oak, autumn maple, sparse, poplar, willow) and the species it draws as placeholders today
  (palm, acacia, dead tree, bald cypress); 64-pixel textures, three levels, no billboard (the game bakes its own
  impostors). The 🎮 Thornwake filter in the tree list shows them; picking one sets the export to glTF, a file per
  level, no helpers. The export letters the trees (`Pine_A_LOD0.glb`…), adds the game's catalogue name
  (`TREE_Pine_A`), species and variant to the manifest, and writes `<name>.handoff.md`: the files, triangles per
  level, sizes, materials, axes, wind layout and the game's `--test-tree` line, for whoever brings them in.
* The manifest now has, for any tree: per-level bounds and object counts, height and width in metres, and the
  textures' size and sampling.
* Fix: hanging moss no longer hangs from twigs a level's wood left out.

Fix (preview.68): the Thornwake pine and spruce looked wrong: a skirt of bare limbs at the bottom and tufts glued
to the trunk above, no cone. At these budgets their twigs are dropped and the twig cards bunched up unevenly. A new
leaf arrangement, **boughs**, does what the pack's conifers do: one folded needle frond along every limb off the
trunk (broad at the trunk, pointed at the tip, sides drooping from a ridge on the limb), so the whorls make tiers
and the tiers a cone. The level's leaf budget sets each bough's segments, and far levels keep every n-th limb
from the bottom up (so each whorl keeps boughs on different sides). Both presets now use it with no twig level and
a thicker trunk; it is in the Leaves tab for any conifer. A test checks leaves in every third of the crown and a
reach that narrows upwards.

More kinds and better looks (preview.69):
* **Cactuses**, a new tree kind (`archetype: cactus`): ribbed columns (the flute lobes on every branch, all the way
  up, rounding off at the tips), arms that stay thick and turn up, kept below the crown so the top stands clear,
  rounded tips, always clean low-poly tubes (a welded surface would melt the ribs), no leaves, no wind, and a
  "cactus" skin (green streaks along the ribs, pale spine tufts). Presets in a new **Desert** group: saguaro,
  organ pipe, barrel cactus and the Joshua tree (forking branches tipped with spiky tufts).
* **Willows** rebuilt: a curtain is now a chain of leaf sprays (each segment its own sprite, stem at the top)
  facing out of the crown, arching out a little and falling nearly to the ground; one stretched leaf per ribbon
  read as a plank. The willow's limbs now arch up and out with drooping twigs, so the crown is a broad dome (about
  as wide as tall). The crown filler is off for curtains (gaps between them are natural).
* **Leaf masses**: the Thornwake oak, autumn maple, cherry and bald cypress use cards over puffy clumps ("tufts"),
  closer to the pack's oaks; the dry shrub is solid low-poly clumps (a bush in ~300 triangles).
* New general presets: Italian cypress, cherry blossom, jungle giant (buttress roots, a high flat crown), dry
  shrub. Thornwake now has 24 species: its pack's nine, larch, cherry, Italian cypress, palm, acacia, jungle tree,
  baobab, dead tree, dry shrub, bald cypress, mangrove, saguaro, organ pipe, barrel cactus and Joshua tree.
* Tests: a cactus is ribbed (a ring round its trunk is lobed), leafless and still, with arms that rise and start
  below its top; willow curtains come from a crown about as wide as tall and fall low without touching the ground.

Fix (preview.70): the conifers (pine, spruce, giant sequoia, bald cypress) had become bare poles with tufts. Found by
rendering every built-in tree from preview.60, preview.61 and the current code side by side: the broadleaf trees
were unchanged, and preview.61 still had full cones at 4,000 triangles, so the triangle target wasn't it. Two of my
changes together were: preview.64 cut the conifers' limbs to a third of their length and capped how much their leaf
cards may grow, and since preview.66 the leaves of branches the low-poly wood leaves out go on the nearest wood
left. At 4,000 triangles the wood could pay for only the thickest few limbs (11 of a pine's 42), so the crown fell
onto the trunk. Now:
* Every limb off the trunk is kept before any twig: when the budget can't pay for them all at full detail, they get
  fewer sides and rings (down to 3-sided tubes of two rings) instead of going missing. The pine keeps 44 branches
  at 4,000 triangles instead of 11, and the leaves hang out on them.
* Conifer limbs between the old full shape and the slim one (pine 0.16, spruce 0.15, sequoia 0.15): about two to
  two and a half times taller than wide, full cones. The cards' growth cap is the same for every tree again.
* The giants (sequoia, bald cypress) start at 8,000 triangles ("Feature tree"), the forest trees at 4,000.
* A test builds pine, spruce and sequoia at 4,000 triangles and at full detail and checks the upper crown reaches at
  least 80 % as far out (it fails on the old code: spruce 75 %, sequoia 55 %).

Textures (in the same version): every map keeps full colour and PBR at small sizes; leaves get normal and ORM maps
made from their shape; "Sharp pixels" (nearest-neighbour sampling) for any tree, honoured by the preview and by the
Godot plugin (v2: sharp_pixels with nearest-filtered copies of the textures); the Thornwake trees are 64 px with the
full PBR set, sampled sharp (a palette only when asked for).

Leaf masses (preview.71): the canopy's outline came from where the twigs happened to be (cards placed along them),
so crowns were lumpy, gappy and spiky: an autumn maple read as separate balls on bare stalks. A new foliage mode,
**leaf masses**, shapes the crown first and places the cards on it:
* Overlapping soft balls (flattened tiers on conifers) along the outer branches together give the crown's outline.
  A mass on a twig the level's wood left out moves until it touches wood that is there.
* The cards are spread evenly over that outer surface (Fibonacci points round each mass, none where a neighbour
  covers it), a few deeper for depth (fewer with more "outer leaves"), each lying on the surface facing out.
* The leaf budget sets how many; their size is what covers the surface. No canopy fill pass is needed.
* The default for the realistic oak, birch, maple, cherry and jungle giant, and the Thornwake oak, autumn maple,
  cherry and bald cypress. Conifers, willows, palms and acacias keep their own placement; "Leaf cards on the
  branches" is still a choice for any tree.
* Tests: at 4,000 triangles the crown is fuller (over 80 % of its outline covered, measured from four sides) than
  with cards along the twigs; at 2,000, no card is farther from the wood that is there than a mass and a card.

Fix (preview.72): leaf textures were cut off. The atlas kept a leaf inside its cell only along its length, not its
width: a maple leaf's lobes spread all round its base, and a cluster's lower side leaves pointed below the cell, so
the card's edge cut them straight (up to 386 leaf pixels on the cell edges of one atlas). Each sprite is now
measured whole (blades at full width, stems) and shrunk round its anchor, or lifted with a short stalk down to it,
to fit its cell. A test checks every leaf shape, cluster and look: no leaf pixel on a cell's edge but the stalk.

Willows (preview.73): they looked like ropes hung on sticks: thin curtains, one slender twig sprite each, hanging
from the twigs below bare arching limbs. A willow is now a leafy dome (cards over the top of the leaf masses, about
40 % of the leaf budget, hiding the limbs) with curtains leaving from round its sides, wide enough to overlap their
neighbours about twice round the crown, some deeper in for depth; each curtain segment a cluster of drooping twigs
(the willow presets use the cluster sprite). A test: the leaves reach above the wood (on the old code the bare limb
tips stood above them) and the crown is over 60 % full from the side.

Branch cards (preview.74): a fourth thing a card can show, "a whole branch": a main stem with side twigs leaving it
in turn and many small leaves (40–80 per card), back ones darker and front ones lighter, drawn back to front, on a
plane 2.3 times the leaf size: the baked branch card of game foliage, painted in 2D. Tried as the default for the oak,
birch and pine and measured: the crowns came out a little less full (oak 77 % against 81 % with clusters), the pine
wider (the big cards stand out past its short limbs), the maple coarser; finer leaves on the oak and birch, a fuller
pine body. Not a clear win, so it stays a choice (Leaves & bark → what one card shows), the defaults unchanged. The
bigger step is a real branch picture (a photographed or 3D-rendered leaf atlas) as your own leaf picture.

Leaves at a distance (preview.75): cut-out leaves thin out with distance (the smaller mipmaps average their alpha
away). The preview and the Godot shader raise the alpha by the mip level, so far and low-detail trees keep their
coverage. Leaves let light through from behind: KHR_materials_diffuse_transmission on the leaf and moss materials
(optional: engines that don't know it ignore it), and the Godot plugin (v3) lights cut-out leaves from behind.

Engine-agnostic notes from Thornwake: NoorMaterial's real-world scale and material sets are done (preview.75,
docs/TEXTURE_BENCH_PLAN.md). For rocks (stage 2): the pivot at the centre of
the ground contact, levels as files or nodes, and simple convex collision pieces in the GLB named by Godot's glTF
convention (-convcolonly), several for arches and the like.

Still open: the biome catalogue (and rocks, stage 2).

## Stage 2 — rocks

- **Realistic to hyper-realistic:** a dense implicit rock (layered noise, fractures, strata, erosion), simplified to
  budgets, with normal, AO and curvature maps baked from the dense form; PBR from NoorMaterial.
- **Stylized:** chunky, faceted shapes with bevels and crisp creases (dual contouring), painted gradients (lighter
  on top, moss or snow on upward faces), optional flat shading.
- **Families:** boulders, fractured stones, river stones, slabs, rubble and scree packs. The ground contact is
  flattened if wanted, and the pivot is at the base.

### Done in preview.76 (rocks, first cut)

- **Trees | Rocks** at the top of NoorForm list. Each keeps its own recipe, undo steps and tab while the other
  is shown; opening a `.noorrock.json` switches to rocks. Rock tabs: Rock (kind, look, size, height, stretch,
  roughness, broken faces, layers, flat underside, sink), Surface (material, colour, texture tile in metres, moss,
  snow), Mesh (levels, triangles per level, convex collision pieces), Export.
- **Shape** (`RockBuilder`): a signed distance field — a warped ellipsoid (several melted together for boulders and
  outcrops), big lumps and fine grit by roughness, fracture planes cut in with a little rounding, ledges for layers,
  a flat base — sampled on a grid and extracted with surface nets (closed, welded), then simplified to each level.
- **Kinds and budgets** (Thornwake's spec): stone ≤ 150, rock ≤ 400, boulder ≤ 1,200, outcrop ≤ 2,500 triangles in
  LOD0, then about 40 % and 15 %; scree packs many stones (one mesh, ≤ 1,500), the far levels dropping the small ones.
  Stylized rocks take a third of the budget, every face flat shaded: big facets.
- **Surface:** normals smooth within a face and split at hard edges (48°); UVs projected from the side each face looks
  to, in metres (one tile = `tileMetres`), so every rock shares one texel density. Rock materials made in the rock's
  colour (`RockTextures`: weathered, granite, sandstone, mossy, snowy, painted) or any NoorMaterial preset. Moss and
  a darker foot in the vertex colours; snow on upward faces as its own material (it stays white).
- **Pivot:** the middle of the ground contact, the base `sink` × height below it (no gaps on uneven ground).
- **Collision:** convex hulls of the closest level (≤ 34 points, ≤ 64 triangles each; outcrops in slices along the
  long side, slightly overlapping), named `Collision-convcolonly` — Godot makes them convex collision shapes by itself
  (checked in headless Godot 4.4 in CI). Listed in the manifest for other engines.
- **Export:** a file per level or one file with tagged levels (the Godot plugin, now v4, switches a rock's levels by
  distance and leaves its materials alone), a variety pack (sizes spread), the recipe and a manifest (pivot, sink,
  levels, triangles, collision pieces, materials, texel density).

### Formations and a better stylized look (preview.77)

From a stylized rock reference sheet (rounded and angular boulders, cracked rock, layered sandstone, mossy forest
stone, rock cluster, rocky outcrop, stacked formation, stone pillar, natural arch) and a photo of schist tors (thin
tilted layers breaking out of a hillside, jagged, half buried):

- **Formations of blocks** (`RockFormations.cs`): each block a rounded box (or squashed ball) with chipped corners,
  turned and placed by the kind's layout, joined with the slightest rounding so the seams stay creases (read as
  cracks). Kinds: angular, cracked, layered (flat sandstone, or tilted by `dip` into thin overhanging schist layers,
  buried to the height asked), cluster (pointed, `taper`), outcrop (stepped blocks to a crest), stacked, pillar (a
  cone of pointed blocks round a segmented middle), arch (blocks along an arc, big feet). `pieces` sets how many.
- **Fallen stones** round the foot (`debris`), a small share of the triangles, none on the farthest level.
- **Collision per group of blocks:** the blocks gathered into the asked number of neighbour groups (k-means on their
  centres), each group's surface a ≤ 34-point hull — an arch keeps its opening.
- **Painted light** in the vertex colours from the surface's bend: lighter tops and edges, darker cracks and foot
  (strong when stylized, a touch when realistic). Stylized normals keep planes flat and bevels soft (38°).
- **Moss** as its own textured material in patches on upward faces (plus a green fringe in the vertex colours); a
  softer painted rock texture.
- Presets grouped as single rocks, formations and ground; the stylized budget cut is a third for single rocks, two
  thirds for formations.

Trees: **wood only** on the Export tab — the trunk and branches without leaves, clumps, crystals or moss (the same
wood as the full tree), files ending in `_Wood`, for your own leaves or a bare tree.

### Edge wear (preview.78)

`edgeWear` (0 sharp … 1 well worn), on every rock:

- **Mesh:** within a band along each edge (where a block's two nearest faces meet, or a broken face meets the rounded
  body) the edge is rounded off and chipped, bites taken where a noise says — big and few when stylized, smaller and
  many when realistic. Each block is worn before the blocks are joined, so the surface stays smooth across seams.
- **Texture:** the rock materials tint their own ridges lighter and their hollows dirtier (curvature masks only, so
  the rock keeps its colours).
- **Vertex colours:** worn edges lighter, in patches; the wear in the alpha as a mask for a shader of your own.

### The faceted look (preview.79)

From references of stylized game rocks (kitbashed faceted chunks with a line of light along every edge):

- **Exact planes** (`RockFacets.cs`): each chunk a convex polyhedron clipped from a box (or a ball of facets when
  round) by its chips and worn corners, so its faces are truly flat; chunks overlap as they are kitbashed, the
  triangles buried inside other chunks left out.
- **Hand-cut bevels:** each edge its own width, one to three cuts tilted along it so the bevel widens and narrows,
  now and then an edge left sharp; the chamfers painted near white (each catching the light a little differently,
  their normals leaned up), the planes a touch darker, the stone darkened where chunks meet.
- **Levels within budget:** LOD0 bevels the biggest chunks first as far as the budget allows; LOD1 drops the bevels;
  LOD2 drops the small chunks. Collision: neighbouring chunks' corners, ≤ 34-point hulls.
- A **smooth stone** material (nearly the plain colour) for it; the stylized formation presets now use it, and two new
  presets: snowy peaks and desert spires.

Next for rocks: baked normal and AO maps from the dense form, dual contouring for crisper stylized edges, landform
pieces (≤ 8,000), arches with several collision pieces placed by shape rather than slices.

## Stage 3 — deeper trees and formations

- A hotpoint card editor for your own leaf and twig textures (the metadata from the concept).
- Space colonisation inside a crown shape you draw.
- Seasons, more species profiles, palms and bushes.
- Octahedral impostor atlases.
- Cliffs and modular formation pieces, biome packs, and collision proxies.

## Non-goals

- A general mesh editor or a sculpting tool (Blender is for that).
- Botanical or geological simulation.
- Automatic LOD switching inside GLB (engines do that; NoorMD exports the levels).
