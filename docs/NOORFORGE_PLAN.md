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

### Done in preview.88 (stage 1 finished)

- **Height:** every layer paints height too — a material its own relief, a plain layer the height you give it (mid
  grey: flat) — or leaves it alone ("Paints: height"). Exported as `_Height.png`.
- **A Godot material:** beside each texture set's maps the export writes `{set}.tres`, a Godot 4 ORMMaterial3D using
  them (colour, normal, ORM; the height map set but off, as parallax suits some surfaces only). Its paths are relative,
  so the folder can go anywhere in a project. CI imports one in headless Godot 4.4 and checks it.
- **Smart materials of your own:** "＋ Save these layers…" keeps the stack by name (the same name replaces it), listed
  under "Your smart materials" for any model; ✕ removes one (after asking).
- **One channel in the 3D view:** the view shows the model lit, as clay, or one channel on it as it is, unlit — colour,
  normal, roughness, metal, height, the baked AO and curvature, or the mask of the chosen layer (choosing another layer
  shows its mask). The strip under the view shows the height and the chosen layer's mask too.

## Stage 2 — painting on the model

- A brush on the 3D view: painted into the layer's mask (or as paint of its own), projected from the screen onto
  the texture through the UVs, across seams. Size, hardness, spacing, flow, pressure (pen), mirror on an axis.
- Brush tips from NoorSketch's brushes and any picture; a stencil (a picture laid over the view to paint through).
- Erase, fill a part (by ID), a straight line, and undo; strokes kept in the recipe.

### Done in preview.89 (stage 2, painting)

- **🖌 Paint** (B) beside the view: the left button paints into the chosen layer's mask (Alt+drag still turns the
  model). **＋ Paint layer** adds a colour layer shown only where painted ("Nowhere (only where painted)", a new smart
  mask kind), the brush ready.
- **The brush:** size (a share of the model; [ and ]), hardness, flow (dabs over each other build up), spacing; a pen's
  pressure for size and / or flow; **mirror across X** (the other side painted too, as if seen from the mirrored side);
  **Shift+click** a straight line from where the last stroke ended (finding the surface along it); **🧽 eraser** (E)
  takes paint away — the smart mask's too, so a smart mask can be cleaned up by hand; **🪣 fill a part** (the part
  under the click).
- **How it paints:** each dab is a sphere on the surface; every texel within it that faces the painter is painted,
  across UV seams and charts alike. A stroke is kept as its dabs (points in metres), the brush's settings and the
  direction it was painted from, so the recipe repaints it at any texture size.
- **Shown at once:** while painting, the page lays the stroke over the model (it knows where each preview texel is
  on the model, and paints them as the app will); the app's textures replace it a moment after the stroke ends. A
  ring shows the brush on the surface, an inner ring its hardness.
- Every stroke is its own undo step; a layer tells how many strokes it has, and ✕ clears them.

### Done in preview.90 (stage 2 finished: tips and a stencil)

- **Brush tips:** round (its hardness), NoorForge's own — square, chalk, splatter, grunge, scratches, stipple, leaf —
  or **any picture** (a NoorSketch painting too): its shape where it is transparent, else its brightness, turned around
  when it is dark on a light ground, so the mark is what paints. A tip faces the painter; **Angle** turns it
  (clockwise), **Turn at random** turns each dab differently (the same each time the stroke is painted: a seed).
- **A stencil:** a picture laid over the view, paint getting through where it is white (or black, turned around), as
  far as its edges or **repeated**. Hold **S**: drag to move it, the wheel to size it, Shift+wheel to turn it; Centre
  puts it back. Each stroke keeps where the stencil lay — the camera and its place, as three rows taking a point on
  the model to the stencil — so the app paints it at any texture size exactly as it showed (mirrored strokes too).
- **Pictures are kept in the recipe** (greyscale: a tip at 128 px, a stencil up to 1024), so it opens anywhere without
  the files; one strokes use can't be removed.

## Stage 3 — more

- Decals and stamps (a picture or text, placed on the surface), anchor masks (one layer's mask feeding another).
- High-poly bakes (the Asset Bench's dense rocks and trees as the high model).
- Particles (rain streaks, drips running down), procedural edge chips.
- Export presets per engine (Godot, Unity URP/HDRP, Unreal), texture-set atlases, LOD textures.

### Done in preview.91 (stage 3, first part)

- **Another layer's mask:** a layer's mask can follow one below it — as it is, **where it isn't**, **spread** over a
  distance (grown and softened on the model itself, in 3D, so UV seams don't cut it), or **only a rim** around it.
  Every layer has an id the masks name it by, so moving layers about keeps what follows what.
- **Chipped edges:** worn edges broken into chunks (a chip size and how chunky), ragged at their borders.
- **Drips running down:** from worn top edges, or from another layer's mask, over a length, fading as they go, in
  streaks (a width and how streaky), on the sides of the model.
- **🏷 Decals** (T, in the painting tools): a picture (its proportions kept, up to 1024 across) or **text** (a font,
  drawn into a picture), placed where you click — flat on the surface, or as you look at it — at a size and an angle.
  A decal is kept as one stroke with its picture as the tip, so it repaints at any size like the rest.
- A new smart material: **Chipped paint, rust drips** (paint, bare-metal chips, dark rims round them, rust running
  down from them).

### Done in preview.92 (stage 3, second part)

- **Bakes from a high-poly model:** in "Model & bakes", a dense model of the same thing (GLB or OBJ). Along each
  texel's normal (within a distance, a share of the model's size) its surface is found; its normal goes into the
  normal map (in the model's own frame, so it fits the model in an engine), and its curvature and occlusion into the
  bakes, so worn edges, dirt and moss follow its detail. NoorForge says how much of the surface found it.
- **From the Asset Bench, a lower level:** a tree's or rock's LOD1 or LOD2 can be textured with its closest level
  baked onto it (Model & bakes → Asset Bench level).
- **Export for an engine:** Godot 4 (the maps and a material), Unity URP / Built-in (BaseMap, Normal,
  MetallicSmoothness, Occlusion), Unity HDRP (BaseMap, Normal, MaskMap), Unreal (BaseColor, Normal in DirectX's
  convention, ORM), or every map; named and packed as each expects.
- Still to come: texture-set atlases (several texture sets in one set of maps) and lower-resolution textures for the
  lower levels.

## Non-goals

- A modeller or sculpting tool (Blender is for that), or animated textures.
- Rendering a final image (it is a texturing bench; the preview is for judging the textures).
