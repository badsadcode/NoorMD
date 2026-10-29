# NoorForge — texturing models with layers and smart masks (plan)

An idea taken from Substance Painter (and ArmorPaint): open a model, and build its textures as a stack of layers —
each a material (from the Texture Bench) shown only where its mask says — with masks that understand the shape:
worn edges, dirt in the cracks, moss and snow on top, a colour per part. Then paint on the model itself. The result is
a texture set for game engines (base colour, normal, roughness, metallic, AO, height), and the model with them.

NoorForge is a bench like the others: it docks, opens recipes from the Vault, and exports into the same folder
structures as the Texture and Asset Benches. Nothing leaves the computer.

## Principles

- **The app computes, the page shows.** Baking, layer compositing and exports run in the app (C#, the same code for
  the preview and the export, as in the other benches); the page draws the 3D preview (WebGL 2) and takes the brush.
- **A recipe, not pixels:** a `.noorforge.json` keeps the model's path, the bakes' settings, the layers (materials by
  recipe, masks by their settings) and the brush strokes (as strokes, so they can be repainted at another size).
  Every texture is made again from it; nothing is lost when the resolution changes.
- **Files you choose only:** the model (and any image a layer uses) is read only because you picked it or an opened
  recipe names it.
- **Engine-first export:** Godot first (a material and the GLB with its textures, checked headless in CI), plain PNG
  sets with the usual names for Unity and Unreal (packed ORM / mask maps as the export settings say).

## The shared foundation

- **Models:** GLB (from the Asset Bench, or any), and OBJ. Meshes, their UVs, their materials (each its own texture
  set, as Substance's texture sets).
- **UVs:** a model without good UVs (none, or overlapping, as the Asset Bench's rocks — tiled, projected per side)
  gets an automatic unwrap: faces grouped into charts by direction and connection, each flattened, the charts packed
  into the square with padding, the texture edges bled outwards so no seam shows. The original UVs are kept if they
  are already unique.
- **Bakes (the mesh maps):** from the model itself — ambient occlusion (rays over the hemisphere), curvature (convex
  and concave, from the normals' change across the surface), world-space normal and position (for "from the top",
  "from the side", height gradients), thickness, and an ID map (one colour per material / part). Later: from a
  high-poly model (normals and height onto the low one).
- **Compositing:** layers top to bottom, each with its material channels, an opacity and a blend mode per channel
  (normal, multiply, overlay, add, height-aware for normals), and its mask.

## Stage 1 — smart materials on a model

- Open a model (or "Send to NoorForge" from the Asset Bench), unwrap if it needs it, bake its maps.
- **Layers:** fill layers with a Texture Bench material (any preset or recipe, tiled at a world size in metres, or
  projected triplanar so no UV seam shows); a plain colour / roughness / metal layer.
- **Smart masks** (generators, each with its sliders and a noise to break it up): edge wear (convex curvature), cavity
  dirt (concave + AO), top coverage (dust, moss, snow: the world normal facing up), bottom grime, height gradient,
  by part (ID), fill everything; combined (multiply, add, subtract) and levelled.
- **Smart materials:** stacks saved as presets — painted metal with worn edges, mossy stone, dusty wood, rusty
  iron, snowy rock — usable on any model.
- **Preview:** the model lit (sun and sky, as the Asset Bench), each channel on its own, the mask of the chosen
  layer, the bakes.
- **Export:** the texture set at 512–4096 px per material, the GLB with them, a Godot material; the recipe.

### Done in preview.87 (stage 1, first cut)

- **NoorForge** (Tools, or Ctrl+Alt+F), or **🔥 Texture in NoorForge** on the Asset Bench (its tree or rock, the
  closest level). Opens GLB and OBJ; collision meshes are left out; models whose UVs are missing or overlap (as the
  Asset Bench's rocks) are unwrapped.
- Bakes per texture set: AO (rays through a BVH), curvature (smooth curvature and sharp edges / creases near each
  texel), world normal and position, part. Kept in memory while only the layers change.
- Layers: a Texture Bench material (any preset, triplanar at a tile size in metres, with a tint and its relief) or a
  plain colour / roughness / metal; opacity; which channels it paints. Smart masks: everywhere, worn edges, cracks and
  corners, on top, underneath, low down, one part, one material — amount, softness, noise break-up and its size,
  invert. Smart materials: mossy stone, snowy rock, painted metal (worn), rusty iron, dusty wood, weathered
  sandstone, clay.
- The preview is the textured GLB (512 px textures) with its maps beside it (colour, normal, ORM, baked AO,
  curvature); the export writes each texture set's base colour, normal (OpenGL), ORM, roughness, metallic and AO at
  256–4096 px, the textured GLB and the recipe, which opens again (finding the model beside it if it moved).
- Still to come for stage 1: a Godot material, saving smart materials of your own, height output, viewing one channel
  in the 3D view.

## Stage 2 — painting on the model

- A brush on the 3D view: painted into the layer's mask (or as paint of its own), projected from the screen onto
  the texture through the UVs, across seams. Size, hardness, spacing, flow, pressure (pen), mirror on an axis.
- Brush tips from NoorSketch's brushes and any picture; a stencil (a picture laid over the view to paint through).
- Erase, fill a part (by ID), a straight line, and undo; strokes kept in the recipe.

## Stage 3 — more

- Decals and stamps (a picture or text, placed on the surface), anchor masks (one layer's mask feeding another).
- High-poly bakes (the Asset Bench's dense rocks and trees as the high model).
- Particles (rain streaks, drips running down), procedural edge chips.
- Export presets per engine (Godot, Unity URP/HDRP, Unreal), texture-set atlases, LOD textures.

## Non-goals

- A modeller or sculpting tool (Blender is for that), or animated textures.
- Rendering a final image (it is a texturing bench; the preview is for judging the textures).
