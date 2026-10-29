# Texture Bench: plan

Step 3 of [concepts/INDIE_DEV_BENCHES.md](concepts/INDIE_DEV_BENCHES.md): one Material/Texture Bench for tileable
procedural materials and their PBR maps. Built in stages, like the Sound Bench; each stage is released and
tried before the next.

## Principles (from the concept)

- **Recipes, not just pictures:** a small `.noortex.json` (settings and seed) is saved beside the PNGs, so a
  material can be made again at any size, or changed later.
- **Seamless by construction:** every generator works on whole-number frequencies over a wrapped lattice, so
  every map tiles without a seam at any size.
- **Deterministic:** the same recipe and seed give the same pixels.
- **Quick and Advanced:** presets and plain controls first; the layer stack and surface settings for more.
- **Honest maps:** height, normal, roughness and AO are derived from the material's height; metallic is set,
  never guessed from a picture.

## Stage 1: procedural materials (MVP)

- Engine (C#, `NoorMD.Media`): a layer stack building a height field. Generators: gradient noise (fBm),
  ridged, turbulence, cells (Worley: cells, edges, cracks, stones), wood grain, bricks/tiles, weave and
  scratches. Each layer has scale (X and Y), octaves, persistence, lacunarity, domain warp, levels, invert,
  a blend mode and an opacity.
- Surface: albedo from a colour ramp over height, with colour variation and dirt in cavities; roughness from
  height (low/high) with variation; metallic; normal strength; AO strength and radius.
- Maps: albedo, normal, roughness, AO, metallic and height (16-bit).
- Host: live preview maps served from memory; presets; export at 512–4096 with naming/packing presets
  (generic, Godot, Unity metallic-smoothness, Unreal DirectX normals and ORM packing); recipe beside them;
  my presets; open a recipe.
- Page: a lit 3D preview (WebGL2: sphere, cube, plane; drag to turn; tiling), map thumbnails and a tiled
  view, a layer stack editor, a colour ramp editor, variations by seed, undo/redo, A/B with a pinned version.

## Stage 2: image → material and hybrid (done in preview.37, with painting and masks)

- Pick a picture: albedo from it (made seamless by edge blending), height from its detail (luminance with
  the large shapes removed), and the derived maps; sliders for strength, detail scale, levels.
- The picture as a layer in the stack, so noise, dirt and wear can be added over a photo.

## Stage 3: shapes, masks and round trips

- Done in preview.40: more shapes (tiles with round corners and tilt, hexagons, planks with grain, spots as
  domes, rivets, craters or cones) and erosion of the height so far: rain (droplet hydraulic erosion, after
  Beyer 2015, with the gullies cut deeper where most water ran), crumbling (thermal erosion, its slope limit
  taken from the material's own slopes) and wear (raised edges worn round). Erosion is worked out at 512 × 512
  so the preview and every export size agree, and it paints where it acted. (Masks between layers came in
  preview.37.)
- Done in preview.41: hand-painting in NoorSketch without losing the recipe. A "Hand-painted" layer is a
  .noorsketch painting (kept with the app's data, copied beside exported recipes); NoorSketch opens it with the
  material (without the painting) underneath, strokes wrap across the edges so it tiles, Alt+click picks colours
  from the material, and Ctrl+S applies it: the Texture Bench renders again. Its colours go on where it is painted;
  its brightness can raise or lower the relief; it can tint, roughen or make metal where painted.
- Done in preview.41: exports optionally shown in the Gallery (folder added, maps tagged "material" and with the
  material's name) and the recipe kept in the open Vault's Materials folder with its paintings and a picture;
  a recipe opened from the Vault opens in the Texture Bench.

## For games: real-world size and material sets (preview.75)

From Thornwake's notes (engine-agnostic: any game wants these):
* **Real-world size**: a material says how much ground one tile covers (metres, default 2) and what its height map's
  full range stands for (centimetres, default 4: about 2–8 for soil and grass, up to 20 for scree and rock). Both are
  in the recipe and on the Export tab, which also shows the texel density (pixels per metre at the export size) and
  the albedo's average brightness in linear light (grass and soil look natural about 0.15–0.35).
* **A manifest beside the maps** (`<name>.material.json`): the scale, the texel density, the height's range (and
  that low is where water collects), the albedo's average (linear RGB and luminance), and each map's file, colour
  space, normal convention, bits and channels.
* **Material sets**: several presets (built-in or yours) exported together at one size and one tile size, so they
  share a texel density, named by the export settings; `<set>.set.json` lists each material with its files and
  brightness, and the bench shows them, flagging any much darker or brighter than the set's median (a game blending
  them would show it).
* Tests: the brightness is measured in linear light; the scale's limits; the UI (texel density, brightness, the set
  export and its flag); the self-test checks the manifest.

## Later (only if real use asks)

- A node view of the material, animated noise, and imported meshes for the preview.
