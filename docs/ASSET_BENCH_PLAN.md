# Asset Bench: plan (trees, rocks, and later formations)

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
- **Materials:** from the Texture Bench (bark, rock, moss), which gains a painted style for the stylized look;
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
  default), "birch" (pale with dark marks), as Texture Bench recipes, so they tile and bring normal and ORM maps.
- **Painted shading** in COLOR_0 (free now that wind is in the UVs): crowns darker inside and below with soft
  patches, trunks darker at the foot; engines and viewers multiply it with the textures.
- **Fantasy forms:** mushroom caps (a turned profile with spots on top and gills under, on the trunk and the limb
  tips), crystal shards instead of leaves, and glow (emissive) for caps, crystals and leaves. Five presets.
- **Wind shaders** written with an export: NoorTreeWind.gdshader (Godot 4) and NoorTreeWind.hlsl (Unity Shader
  Graph Custom Function, Unreal Custom node).

Still open: bring-your-own bark and leaf textures, billboards (crossed-card impostors), the biome catalogue.

## Stage 2 — rocks

- **Realistic to hyper-realistic:** a dense implicit rock (layered noise, fractures, strata, erosion), simplified to
  budgets, with normal, AO and curvature maps baked from the dense form; PBR from the Texture Bench.
- **Stylized:** chunky, faceted shapes with bevels and crisp creases (dual contouring), painted gradients (lighter
  on top, moss or snow on upward faces), optional flat shading.
- **Families:** boulders, fractured stones, river stones, slabs, rubble and scree packs. The ground contact is
  flattened if wanted, and the pivot is at the base.

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
