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

- More shapes (tiles with bevels, hexagons, planks, spots), masks between layers, erosion and weathering.
- Hand-painting in NoorSketch and coming back without losing the recipe.
- Exports registered in the Gallery; recipes in the Vault.

## Later (only if real use asks)

- A node view of the material, animated noise, and imported meshes for the preview.
