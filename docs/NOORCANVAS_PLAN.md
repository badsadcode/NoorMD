# NoorCanvas — a layered photo and painting editor (plan)

An image editor in the spirit of Photoshop and Affinity Photo: layers with blend modes and masks, adjustments that
stay editable, selections, painting with pressure, transforms, filters, text — for photos, concept art and game
textures. NoorSketch stays as it is, a small separate sketchpad; NoorCanvas is the full editor. Pixel art has its own
bench (NoorSprite).

## Principles

- **The page draws with the GPU** (WebGL 2: layers composed, brushes stamped, filters run as shaders), so large images
  stay quick; the app reads and writes files (PSD in and out, PNG, JPEG, WebP, TIFF, its own .noorcanvas).
- **Non-destructive where it matters:** adjustment layers, layer masks, smart filters on a layer kept as settings,
  transforms kept until applied.
- **Exact files:** 8 and 16 bits per channel; colour as it was (sRGB, with the profile kept); alpha straight.
- **Files you choose only**, and undo for everything (a history panel to step back to any point).

## Stage 1 — layers and painting

- Documents up to 8192 × 8192; zoom, pan, rotate the view; rulers, guides, a grid; several open at once (tabs).
- Layers: pixel layers, groups, fill layers (colour, gradient); blend modes (the usual 27), opacity and fill, lock,
  clip to the layer below, layer masks (paint them; show, turn off, apply).
- Brushes: round and textured tips, size, hardness, flow, spacing, smoothing (stabiliser), pen pressure for size /
  opacity / flow, scatter, colour jitter; eraser, mixer-like smudge, clone stamp and healing (blend the copied texture
  into what is around it).
- Selections: rectangle, ellipse, lasso, polygonal lasso, magic wand, select by colour range, quick mask; feather,
  grow, shrink, invert; selection from a layer's alpha.
- Transform: move, scale, rotate, skew, perspective, flip; snapping.
- Files: .noorcanvas (layers, masks, adjustments), PSD (open and save, layers and masks), PNG / JPEG / WebP / TIFF;
  open from the Gallery, send to the Texture Bench and NoorForge.

## Stage 2 — adjustments and filters

- Adjustment layers: levels, curves, brightness / contrast, hue / saturation, colour balance, vibrance, black and
  white, invert, posterize, threshold, gradient map, selective colour, exposure.
- Filters (live, as smart filters on a layer): Gaussian / motion / lens blur, unsharp mask, high pass, noise (add,
  reduce), clouds, emboss, offset (for tiling), liquify (push, pinch, bloat).
- Text layers (fonts, size, tracking, alignment), shapes (rectangle, ellipse, polygon) as editable layers.

## Stage 3 — more

- Content-aware fill and remove, perspective crop, panorama and HDR merge, 16-bit and 32-bit (float) documents,
  actions (recorded steps replayed on many files), colour profiles and soft proofing.

## Non-goals

- Vector illustration (an SVG editor), RAW development beyond basics, video editing.
