# NoorMD Procedural Asset Bench
## Trees, Vegetation, Rocks & Land Formations

**Status:** Future development concept / design reference, **not** an implementation order  
**Date:** 28 October 2026  
**Goal:** Generate useful, editable-in-Blender, game-ready 3D nature assets with controllable variation, materials, and LODs. NoorMD does not need to become Blender or a game engine.

---

## 1. Vision and boundaries

A dedicated, optionally modular **3D Asset Bench** produces individual assets and curated packs of trees, vegetation, rocks, boulders, cliffs and modular land formations. Users adjust parameters, view a live 3D preview, regenerate deterministic variations, and export assets for further use in Blender or game engines.

**Guiding rules**

- Native generation in NoorMD is preferred, but a self-contained Python-based generator or an optional Blender-assisted pipeline is acceptable where pragmatic. **Blender must not be required just to consume a GLB/glTF export.**
- Assets are normal exported meshes. **No Blender plug-in or live NoorMD regeneration link is required** after export.
- Preserve a procedural recipe **inside NoorMD for optional later editing**, not as a requirement imposed on imported assets.
- Emphasize plausible silhouettes, clean UVs, efficient geometry, consistent pivots and predictable exports over sheer parameter count.
- Scope this initially to nature assets, not arbitrary 3D modeling, scenes, terrain engines or a replacement for Blender.
- Different generators should share preview, mesh, PBR, LOD, impostor, preset, batch and export infrastructure.

## 2. Shared asset architecture

**Suggested conceptual pipeline**

`Preset (species/geology + style + biome) -> Seeded procedural geometry -> UVs/normals/tangents -> Materials/PBR -> LODs -> Billboard/impostor -> Validation -> Preview/export`

Store a neutral intermediate representation of an asset: named meshes, transform hierarchy, submeshes, materials, textures, UV sets, normals/tangents, vertex colors if useful, bounds, pivot, collision proxies and metadata. This separates the generator from preview and export.

**Reusable controls:** seed and variation lock; real-world size and units; quality profile; polygon budget; material selection; season/weathering; batch count; output naming; UV layout; atlas settings; LOD policy; billboard policy; export preset.

## 3. Tree generator: species, growth and style

### 3.1 Separate four independent layers

1. **Growth archetype:** broad round-crown deciduous; tall irregular deciduous; columnar tree; conical conifer; layered conifer; drooping/weeping tree; palm; spreading umbrella crown; twisted/dead tree; buttress-rooted tropical tree; multi-stem shrub/small tree.
2. **Species profile:** biologically informed parameters such as trunk taper, node spacing, branching angles and orders, crown profile, foliage geometry, leaf density, bark characteristics, root exposure and average dimensions. A species is more than a texture swap.
3. **Art direction:** realistic, semi-realistic, stylized, hand-painted, low-poly, retro, dark fantasy, cartoon and cinematic/hero asset; sets geometry exaggeration, surface detail, palettes, crown clumping and polygon budgets without erasing species identity.
4. **Biome / world scheme:** compatible species mix and weights, growth conditions, size distribution, age, stress and seasonal variation. Packs should remain geographically and ecologically coherent when realism is selected.

### 3.2 Broad, expandable species library

Use a **data-driven, extensible species registry**, not hundreds of separate hardcoded algorithms. Start from tested archetypes and add species profiles over time; distinguish genus-level templates from species-level presets when fidelity permits.

| Environment | Example profiles |
|---|---|
| Temperate deciduous | oak, birch, beech, maple, ash, elm, poplar, willow, chestnut, alder, hornbeam |
| Boreal / montane | Scots pine, spruce, fir, larch, cedar, juniper, hemlock |
| Mediterranean / dry woodland | olive, cork oak, stone pine, cypress, eucalyptus, acacia |
| Tropical / subtropical | coconut palm, date palm, banyan, kapok, rubber tree, tropical broadleaf, baobab |
| Wetland / riparian | mangrove forms, bald cypress, willow, alder |
| Rare / remarkable | redwood, giant sequoia, ginkgo, dragon blood tree |
| Artistic / fantasy | ancient giant, haunted deadwood, glowing canopy, thorn tree, corrupted or crystal growth |

These are examples, **not** claims of scientifically exact simulations. Additional profiles should be measured and visually validated rather than labeled realistic by default.

### 3.3 Tree controls

- Height, age, trunk radius, taper, lean, sweep, asymmetry, branch count/order and branching noise.
- Crown profile, canopy density, branch death, broken limbs, exposed roots and trunk bifurcation.
- Leaf/needle shape, scale, seasonal state, branch-tip distribution, clumping and droop.
- Environmental responses: sunlight/competition, prevailing wind bias, slope, moisture/stress; stylized modes may exaggerate these.
- Bark, foliage and optional moss/lichen material families; color variation with reproducible seed.
- Mature, sapling, ancient, dead and damaged variants; spring/summer/autumn/winter where botanically applicable.

## 4. Foliage and branch-card metadata: attachment hotpoints

**Problem:** Imported alpha textures may represent isolated leaves, clusters, twigs or whole small branches. Their visible stem origin may be at a corner, an edge or the middle. Placing cards with fully random orientation makes stems appear detached, reversed or growing into the parent branch.

### 4.1 Minimum card metadata

- **Anchor / hotpoint:** 2D normalized position `(u,v)` in the source image identifying the **actual connection point** of the visible twig or cluster; distinguish texture pixel coordinates from UV orientation.
- **Growth vector:** normalized 2D direction **away from the anchor**, along the primary visible stem or foliage growth axis. Author as a draggable arrow; it need not point toward the image center.
- **Preferred facing/up:** orientation reference, plus optional front/back preference.
- **Card class:** leaf-only, leaf cluster, twig-with-leaves, compound branch, conifer tuft, hanging foliage, dead twig, flower/fruit cluster.
- **Attachment rule:** branch tip, side branch, trunk-adjacent, hanging, or broadly free placement.
- **Allowed variation:** yaw/pitch/roll/twist ranges, scale distribution, mirroring permission, gravity/droop bias and placement weight.
- **Bounds and opacity:** trimmed alpha silhouette and optional safe margins; preserve transparent texels as needed to prevent texture bleeding.

### 4.2 Placement algorithm

1. Choose a valid location on an actual branch segment or branch tip, according to class/species/crown zone.
2. Place the card's **anchor at the world-space attachment point**, not its geometric center.
3. Construct a local frame from the parent branch tangent, outward crown direction and optionally gravity/sun direction.
4. Map the card's growth vector into that frame, so the visible stem extends plausibly **away from** the parent connection.
5. Introduce **bounded, deterministic randomness**, maintaining the attachment constraint. A prohibited 180-degree inversion must remain prohibited even with random rotation.
6. Resolve collisions/overlap heuristically, vary clusters and test silhouette and density from multiple camera angles.
7. For hanging cards, apply gravity-guided orientation while keeping the anchor at its attachment location.

**Important:** The 2D growth arrow alone does not define a complete 3D orientation. Use a third axis or surface-facing hint and the parent-branch frame to eliminate ambiguous flips.

### 4.3 Card authoring UI

A **Foliage Card Editor** shows an alpha texture with a movable anchor dot, draggable growth arrow and optional facing marker. Preview it attached to a rotating sample branch with controlled randomness; allow flipping UVs explicitly. Save a small companion metadata record next to the texture or in NoorMD's asset library.

**Illustrative metadata (concept only):**

```json
{
  "name": "oak_twig_cluster_03",
  "class": "twig_with_leaves",
  "anchor_uv": [0.16, 0.90],
  "growth_vector_uv": [0.60, -0.80],
  "attach_to": ["side_branch", "branch_tip"],
  "max_roll_degrees": 18,
  "max_growth_deviation_degrees": 25,
  "allow_mirror": false,
  "droop_bias": 0.1,
  "placement_weight": 0.8
}
```

Further extensions: multiple sockets, curved stem guide, masked regions, several card orientations, scanned branch texture atlas, authorable branch-tip attachment zones. These are **optional**, not first-release requirements.

## 5. Rock, stone and geological formation generator

### 5.1 Asset families

- Pebbles and small scatter stones; river-rounded stones and cobbles.
- Boulders, erratics, fractured blocks, slabs, rubble and scree.
- Exposed bedrock, outcrops, stratified layers, cliffs and modular cliff wall/corner/cap pieces.
- Natural arches, ledges, columns, cave-mouth modules and overhangs; avoid claims that any generated geometry will be game-playable without validation.
- Stylized shapes and fantasy formations as separate art-direction profiles.

### 5.2 Geological shape profiles

Profiles can include granite-like blocky massing, basalt-like columnar fracture, sandstone strata, limestone erosion/karst-inspired forms, shale-like layering, slate-like cleavage and volcanic/scoria-like rough surfaces. These are *visual generators*, not full geophysics simulations.

### 5.3 Controls and generation methods

- Base shape from primitive deformation, SDF/implicit surfaces or authored modular profiles.
- Multi-scale coherent noise for large silhouette, medium fracture planes and fine surface texture.
- Directional strata, bedding, joint spacing, chipped edges, crack/cleavage patterns, rounded erosion and sediment deposition cues.
- Width/height/depth, anisotropy, gravity orientation, overhang amount, weathering, brokenness and scale.
- Slope/ground-contact region and flat underside options for placing rocks in game worlds.
- Surface material blending by slope, curvature, height, crevice and exposure (rock, dirt, lichen, moss, snow).
- Collision-friendly simplified meshes and reasonable pivot placement (often ground-centered).
- Optional modular connection faces for cliffs so adjacent pieces meet without obvious seams.

## 6. Materials and UV workflow

Integrate with NoorMD's **Texture Bench** when available; do not couple the geometry algorithm to any particular texture generator.

- Physically plausible PBR outputs where appropriate: base color, normal, roughness, metallic (usually low for natural rock/wood), AO and optionally height.
- UV generation tailored to trunks, branches, cards and rocks; avoid stretching, flipped tangents and obvious seams.
- Texture atlases for foliage with alpha and correct padding; support alpha cutout or blend choices depending on target engine.
- Material variants with per-instance color/roughness variation; wind-compatible foliage data or masks as an optional output.
- Texture resolution and output budget configurable per asset or batch.
- Verify material appearance on sphere/plane plus the actual generated asset under multiple lighting conditions.

## 7. LODs: 1 to N, with cards and billboards

The user chooses **any practical number of mesh LODs**, with presets (e.g. mobile, desktop, hero asset) and an optional final impostor. LOD0 is the high-detail original; subsequent levels target reduced triangles, draw calls, overdraw and material complexity.

- **Trees:** remove minor branch orders, reduce ring segments, merge foliage clusters, reduce card counts/texture complexity and preserve crown silhouette. Pure geometric decimation is insufficient.
- **Rocks:** use feature-aware simplification preserving outline, major fractures and contact regions; bake high-frequency detail into normal maps.
- **Billboard options:** single camera-facing card, crossed cards, and multi-view impostor atlas (including normals/roughness and optional depth where supported).
- Generate billboard views from the model with a consistent pivot and bounds; do **not** assume a camera-facing billboard works in every engine without an engine-side component.
- Ensure reasonable alpha cutout, shadows, mipmaps, texture gutters and cross-fade options to reduce popping and shimmer.
- Expose manual overrides and per-LOD preview with triangle/draw-call/texture statistics; automatic thresholds may be recommended but not universal.
- Keep LOD switching runtime-specific. **glTF 2.0 does not guarantee portable automatic LOD selection.** Export named independent meshes/nodes or separate files, plus an optional manifest and target-engine adapters later.

**Illustrative output:**

```text
Oak_07/
  Oak_07_LOD0.glb
  Oak_07_LOD1.glb
  Oak_07_LOD2.glb
  Oak_07_LOD3.glb
  Oak_07_Billboard.glb
  Oak_07_Impostor_Atlas.png
  Oak_07.manifest.json
```

## 8. Export and Blender interoperability

**Required:** `.glb` (single portable package) and `.gltf` with sidecar resources. **Optional:** `.obj` + `.mtl` for static meshes; `.blend` and `.fbx` via an optional Blender background-mode conversion step.

- Meshes should import into Blender as ordinary editable objects with useful naming, transforms, units, materials and texture paths.
- No persistent NoorMD-to-Blender regeneration link is required. Blender is where the exported result can be modified normally.
- Export LODs as separate files or distinct named objects in one GLB; include a small JSON manifest for asset relationships if helpful.
- Export collision proxies separately, clearly labelled; no assumptions about how individual engines interpret collision or billboard meshes.
- Choose sensible axis convention and scaling; validate import in Blender and a target engine (e.g. Godot).
- Save NoorMD's procedural recipe separately **only if useful to edit/re-export in NoorMD**.
- If adapting Blender add-on code, audit its provenance and licenses. Reimplement algorithms or use approved dependencies as appropriate; merely having written an add-on for Blender does not guarantee its code runs outside `bpy`.

## 9. UI proposal

**Bench navigation:** `Trees | Rocks | Formations | Asset Library | Batch Export`.

**Tree view:** species search + biome filters; style preset; age/season; trunk/branch/canopy settings; foliage card library/editor; material presets; seed/variants.

**Rock view:** geology/shape preset; major silhouette, fracture/strata, erosion and weathering; material masks; scatter pack generator.

**Shared preview:** orbit camera, perspective/orthographic, material/wireframe/normal/LOD views, triangle statistics, lighting/environment rotation, grounding grid and silhouette check.

**Shared export panel:** GLB/glTF, unit scale, mesh quality, texture resolution, N LODs, final billboard/impostor, material packing, collision, naming and variation batch. Present a preview of generated files before export.

## 10. Reliability and validation

Automated checks should test:

- Deterministic output for fixed seed and settings.
- Valid indices, finite vertex positions, correct winding, acceptable normals/tangents and UV bounds.
- No detached card stems caused by anchor misplacement; sensible outward growth on multiple tree shapes.
- Correct alpha appearance and tangent-space normals after export and re-import.
- No unexpected changes in dimensions, pivot or material assignments across LODs.
- Geometry budgets, batch memory consumption and cancellation responsiveness.
- Visual checks on multiple species/styles and geology profiles, including extreme input parameters.
- Successful GLB/glTF import into Blender, plus actual test scenes in at least one game engine.

## 11. Sensible development sequence (future)

1. **Shared foundation:** parameter schema, seed control, mesh data model, 3D preview, material binding and GLB/glTF export.
2. **One excellent tree archetype** with real branches, basic foliage cards and a hotpoint/growth-vector editor.
3. **One excellent rock family** (boulder and fractured stone) with clean UVs/PBR.
4. **Validated LOD pipeline** and simple billboards; add multi-view impostors after quality is proven.
5. Expand tree archetypes and data-driven species, style overlays and biome collections.
6. Expand rock families to cliffs, stratified formations and modular kits.
7. Add batch generation, collision proxies, target-engine presets and optional `.blend`/FBX conversion.

### Non-goals for initial implementation

- Full Blender replacement, sculpting suite or general-purpose mesh editor.
- Fully simulated botany, geology, erosion or ecosystem evolution.
- Infinite species library available on day one.
- Engine-specific runtime LOD switching embedded magically in GLB.
- Dependency on a NoorMD plug-in to edit exported assets in Blender.
- Making this a blocker for NoorMD's current stabilization/release.

## 12. Definition of a useful first milestone

A user can select **Oak (realistic)** or **Oak (stylized)**, adjust seed and form, assign a twig-card texture with a visible attachment hotpoint, see correctly oriented foliage in the viewport, generate 3 mesh LODs and an optional crossed-card impostor, and export GLB files that import into Blender correctly. The same bench can create a randomized fractured boulder, apply a stone PBR material and export clean LODs.

**Core principle:** *Generate assets quickly, control their silhouette and orientation, export cleanly, then use them anywhere.*
