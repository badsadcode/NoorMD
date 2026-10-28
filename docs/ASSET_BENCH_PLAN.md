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
