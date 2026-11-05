# NoorMaterial: plan

Step 3 of [concepts/INDIE_DEV_BENCHES.md](concepts/INDIE_DEV_BENCHES.md): one Material/NoorMaterial for tileable
procedural materials and their PBR maps. Built in stages, like NoorSound; each stage is released and
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
  from the material, and Ctrl+S applies it: NoorMaterial renders again. Its colours go on where it is painted;
  its brightness can raise or lower the relief; it can tint, roughen or make metal where painted.
- Done in preview.41: exports optionally shown in NoorGallery (folder added, maps tagged "material" and with the
  material's name) and the recipe kept in the open Vault's Materials folder with its paintings and a picture;
  a recipe opened from the Vault opens in NoorMaterial.

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

## Done in preview.155 (from the ideas below)

* **Each piece its own:** bricks, tiles, hexagons and planks are told apart piece by piece (as a flood fill would), so
  each piece gets its own brightness (lighter or darker), hue, roughness (rougher or glossier) and a shading gradient
  across it in its own direction — beside the height each already had (Variation) and the tilt. Only the pieces change;
  the mortar and gaps keep their colour. The warp and the shift are followed, so it tiles as before.
* **Another material, blended by height:** a "material" layer brings in a built-in material and shows it where its
  height, raised or sunk (−1…1), is above the height so far, with a soft border; its colours, roughness and metal come
  with it. Stones poking through dirt, moss filling the gaps (sunk), sand in the low places. (A material inside a
  material doesn't bring its own material layers: no loops.)
* **New presets:** Stone pavers (every slab its own shade and slope) and Stony soil (cobblestones poking through
  forest soil, blended by height).

## Done in preview.156 (from the ideas below)

* **Exposed inputs and sets of values:** a material names the sliders that matter (Surface tab › Inputs): each input a
  name, the setting it moves (any of the surface's or a layer's numbers) and its range. Every material also has six
  standard ones (dirt, colour variation, relief, roughness of the high parts, hue, brightness). Sets of values ("Dry",
  "Overgrown") are saved from the inputs as they are. The built-in Mossy stone, Stony soil and Stone pavers come with
  their own (moss; stones poking through; slabs differ, uneven) and two sets each.
* **Live in NoorForge:** a material layer shows its material's inputs as sliders and its sets as a list; the values are
  kept on the layer only (the material itself unchanged), and the material is made again with them (kept in a small
  cache, so going back is quick). Choosing another material drops them; "↺ As it is" clears them.

## Ideas from MaterialCraft (ideas only — nothing of its code is used)

MaterialCraft (MIT / Apache-2.0, a Substance-Designer-like node editor) was looked at for what NoorMaterial lacks. Its
README only; ideas, never code. Ranked by what they would add here:

1. **Flood fill for tiles and bricks:** each tile, brick or plank told apart, so each gets its own random colour,
   brightness, turn, height or gradient — the single biggest step towards real brick, paving and plank floors.
2. **Height blending of materials:** two or three materials mixed by their heights (stones poking through dirt, moss
   grown in the gaps, sand settling in the low places), not by a flat mask.
3. (Done in preview.156) **Exposed inputs and presets:** a material saying which of its sliders matter (wear, moss, colour, scale) and
   keeping named presets of them, so NoorForge (and NoorMesh) can show just those, and a material can be weathered or
   recoloured without opening it.
4. **Weathering as one step:** whole-material wear (edges worn, dirt in the cavities, rust or moss) applied to any
   material, using its own height and curvature.
5. **Templates to start from:** a gallery of starting materials (brick wall, stone tiles, wood planks, painted metal
   plates, rusty metal, lava rock, marble, wicker, fabric, mossy ground), each a recipe to change.
6. **A levels editor over a histogram** of its input, and an alpha / opacity map (cut-outs: leaves, fences, lace).
7. **Tileable everywhere:** noises and patterns on whole-number lattices so every map tiles at every size (check
   ours: the warps and erosion especially), and tileable 3D noises.
8. **A node view** (already "later"): every layer a node with a live thumbnail, wires between them — only if the layer
   stack stops being enough.

## Later (only if real use asks)

- A node view of the material, animated noise, and imported meshes for the preview.
