# NoorSprite — a pixel art and animation bench (plan)

A bench for pixel art and sprite animation, after the ideas of Aseprite and LibreSprite: a sprite is layers × frames
of cels, drawn pixel by pixel with tools made for it, played back with each frame's own duration, and exported as the
sprite sheets, GIFs and engine files games use. LibreSprite is GPL: NoorSprite borrows ideas only, no code. Aseprite's
file format is publicly documented; NoorSprite reads and writes it from that specification.

NoorSketch stays as it is (a small sketchpad). NoorCanvas, a layered photo and painting editor, has its own plan
(NOORCANVAS_PLAN.md).

## Principles

- **The page draws, the app keeps files.** Pixels are edited in the page (exact integer RGBA, straight alpha — never
  through a browser canvas's premultiplied buffer); the app reads and writes files: .noorsprite, .aseprite, PNG, GIF,
  sprite sheets. Exports are composed by the page (the same blending it shows) and written by the app.
- **Files you choose only:** a sprite, a picture to import or a palette file is read only because you picked it.
- **Pixel-exact:** saving and reopening is identical; scaling for export is nearest-neighbour by whole numbers.
- **Undo for everything**, step by step, with a memory cap.

## The document

- A sprite: width × height (up to 2048 × 2048), a palette, layers (name, visible, locked, opacity, blend mode),
  frames (each with a duration in milliseconds), cels (a layer's picture on a frame: pixels, a position, an opacity;
  empty cels take no room), tags (named frame ranges with a direction: forward, reverse, ping-pong) and slices later.
- **.noorsprite**: a ZIP with manifest.json (everything but pixels) and a PNG per cel, written atomically.

## Stage 1 — the editor

- **Canvas:** zoom by whole steps (wheel, keys), pan (Space+drag, middle drag), a checkerboard under transparency,
  the pixel grid when zoomed in, a grid of your own (e.g. 16 × 16) to draw tiles to; a small preview at real size,
  playing.
- **Tools:** pencil (size, square or round, pixel-perfect lines), eraser, bucket (contiguous or every like colour,
  tolerance), line, rectangle and ellipse (outline or filled; Shift squares them), eyedropper (Alt held),
  selections (rectangle, ellipse, lasso, magic wand; add / subtract with Shift / Alt), move (the selection or the
  layer; arrow keys nudge), hand. Mirror drawing across the middle (vertical, horizontal or both).
- **Colours:** a foreground and a background colour (X swaps), with alpha; palettes — DawnBringer 32, PICO-8,
  Endesga 32, Sweetie 16, Game Boy, NES-like — and your own colours added and removed.
- **Layers:** add, duplicate, delete, rename, show / hide, lock, opacity, blend modes (normal, multiply, screen,
  overlay, darken, lighten, add, difference), move up and down, merge down.
- **Frames and the timeline:** layers as rows, frames as columns, a cell per cel; add (a copy of the current), new
  empty, duplicate, delete, move; each frame's duration; play / stop (Enter), loop; onion skin (frames before in red,
  after in blue, how many and how strongly).
- **Tags:** name a range of frames, its direction and colour; play just a tag.
- **Editing:** copy, cut, paste (as a floating selection to place), delete, flip and rotate (the selection, the layer
  or the whole sprite), resize the canvas (with an anchor), scale the sprite (nearest neighbour), crop to the
  selection.
- **Files:** new (sizes from 8 to 512, or any), open and save .noorsprite; open and save .aseprite / .ase; import a
  PNG as a new sprite, or a sprite sheet cut into frames by a grid.
- **Export:** the current frame as PNG; every frame as PNG files; a sprite sheet (a row, a column, or a grid) with a
  JSON in the Aseprite style engines read (frames, durations, tags); an animated GIF — all at 1× to 10×.

### Done in preview.94 (stage 1)

- **NoorSprite** (Tools, or Ctrl+Alt+P), a bench like the others. Everything listed in stage 1 above: the canvas
  (whole-number zoom about the cursor, pan, checkerboard, pixel grid, a grid of your own, a playing preview), the
  tools (pencil with pixel-perfect lines and round or square sizes, eraser, fill with tolerance, line, rectangle and
  ellipse, eyedropper, rectangle / ellipse / lasso / magic-wand selections with add and take away, move, hand),
  mirror drawing, colours and six palettes, layers (blend modes, opacity, hide, lock, merge down), the timeline with
  frames and their durations, playing (all frames or a tag, forward, reverse, ping-pong), onion skin, tags, copy / cut
  / paste as a floating selection, flips and quarter turns (selection, layer or sprite), canvas size with an anchor,
  scale, crop.
- **Files:** .noorsprite (a ZIP of the sprite and a PNG per cel); .aseprite / .ase opened and saved (RGBA; indexed
  and greyscale sprites are opened as RGBA, groups and tilemaps left out with a note); PNG and other pictures opened
  as sprites, imported as a layer, or cut into frames as a sprite sheet.
- **Exports:** the frame as PNG, every frame as PNG files, a sprite sheet (row, column or grid, with spacing) with a
  JSON in Aseprite's form (frames, durations, tags, layers), an animated GIF (each frame's delay, transparency,
  looping; colours reduced by median cut past 255) — all at 1× to 10×, for every frame or one tag.
- Every change is a snapshot sharing the pictures it didn't touch: undo and redo for everything (200 steps).

## Stage 2 — drawing like a pixel artist

- Shading ink (step a colour up or down its palette ramp), dithering patterns as brushes, custom brushes cut from the
  sprite, colour replace, outline (inside or outside, 4- or 8-connected).
- Indexed colour mode (pixels as palette indices; changing a palette colour changes the sprite), palette ops: sort,
  ramps between two colours, load / save .gpl, .pal, .hex palettes.
- Linked cels (the same picture on several frames), rotation of pixel art without mush (RotSprite-like), scale by
  2× / 3× with a pixel-art upscaler (Scale2x / EPX).
- Recovery drafts like the editor's.

### Done in preview.95 (stage 2)

- **Inks and patterns** (the pencil): **shading** — each pixel steps one along the palette (left click one way,
  right click the other; once a stroke), so a palette ramp shades as you go over it; **dithering** patterns (12 % to
  88 %, an ordered 4 × 4 Bayer matrix fixed to the sprite, so strokes join up).
- **Brushes from the sprite** (Ctrl+B): the selection becomes the pencil's brush, stamped with its own colours
  (mirrored too).
- **Outline** (around the shape or on its edge, sides only or corners too) and **Replace a colour** (with a
  tolerance) — in this cel, the layer on every frame, or the whole sprite; inside the selection when there is one.
- **Palettes:** double-click a colour to change it — every pixel of that colour changes with it, as in an indexed
  sprite; sort by hue or brightness, reverse, a ramp from the drawing colour to the second, the sprite's own
  colours, make every pixel a palette colour; load GIMP .gpl, JASC and RIFF .pal and .hex palettes, save .gpl, .pal
  or .hex.
- **Linked cels** (🔗, Alt+Shift+N): a new frame with the same pictures, drawn once for both; the timeline shows
  them joined; Unlink gives a frame its own. Kept linked in .noorsprite and .aseprite files (both ways).
- **Rotate by any angle** without mush (RotSprite-style: 8× by Scale2x three times, turned, each pixel taken from the
  middle of its block) and **Scale2x / Scale3x** upscaling (diagonals smoothed, not blocks).
- **Recovery:** an unsaved sprite is kept as a draft every 20 seconds; the next time NoorSprite opens it offers it
  back.
- Still to come from stage 2: a true indexed colour mode (pixels as palette indices).

## Stage 3 — for games

- Tilemap layers and tilesets (draw with tiles; the tileset grows as you draw), slices (named rectangles, 9-slice
  centres and pivots), reference layers (a picture to trace, not exported).
- Engine exports: Godot SpriteFrames (.tres) and AnimatedSprite2D scenes from tags, Godot TileSet; Unity sprite sheet
  metadata; packed sheets (trimmed, deduplicated), JSON in hash or array form.
- Animation helpers: frame interpolation of a moved cel (tweening position), a timeline that scales durations.

### Done in preview.96 (stage 3, first part)

- **Slices** (C): named rectangles dragged on the sprite — a **9-slice** centre (the part that stretches) and a
  **pivot** (an origin), typed exactly in the panel; drawn with their names; kept in .noorsprite and .aseprite files
  (both ways) and in the sheet's JSON (scaled with the export).
- **Reference layers:** any layer can be one (shown while drawing, never exported); "A picture to trace" brings a
  picture in as one, fitted, half see-through and locked, on every frame.
- **Packed sheets:** each frame trimmed to what it shows, frames that are the same stored once, packed in rows —
  the JSON says where each frame sits in its full size (spriteSourceSize, sourceSize), as engines expect; the JSON
  in Aseprite's either form: frames by name (hash) or a list (array).
- **Godot:** SpriteFrames (.tres) with an animation per tag — reverse turned round, ping-pong there and back — each
  frame its own duration (at 10 fps × its length), trimmed frames put back in place; and an AnimatedSprite2D scene
  (.tscn) with sharp pixels, playing the first animation. Checked in headless Godot 4.4 on CI.
- Still to come for stage 3: tilemap layers and tilesets (and Godot TileSets), animation helpers.

### Done in preview.97 (stage 3, tilemaps)

- **Tilemap layers** (▦ in the timeline, or ☰): a layer drawn as a grid of tiles from a tileset of the grid's size.
  Draw pixels as anywhere and the tiles follow, as in Aseprite's automatic mode — an empty cell has no tile, the same
  picture twice is one tile, a tile used only there changes in place (and wherever else it is drawn), anything new
  joins the tileset. **Tiles** (T, or a tile chosen in the panel): the pencil places the chosen tile (a stroke fills
  every cell it crosses), fill puts it in the touching cells alike, the eraser takes tiles away, the eyedropper picks
  one; the cell under the cursor shows the tile that would go there.
- Any picture layer can be **made a tilemap** (cut into tiles, the same ones stored once), and back.
- Kept as tiles in .noorsprite files (the tileset as a picture, the cels as tile numbers); .aseprite files get the
  tilemap drawn as a picture layer.
- **Godot TileSet:** the tileset as a picture, a TileSet (.tres) with an atlas of it and a scene with a TileMap
  placing the tiles as drawn, sharp pixels — checked in headless Godot 4.4 on CI.

### Done in preview.98 (stage 3, animation helpers)

- **In-betweens** (⇢ in the timeline): from this frame to a later one, new frames in which the layer's picture moves
  from where it is to where it is on the later frame (the middles of what is drawn) — evenly, slow–fast–slow,
  speeding up or slowing down; the other layers keep this frame's pictures; one undo step.
- **Frame timing** (⏱): every frame's, a tag's, or this frame's on — scaled by a percentage (50 % plays twice as
  fast), each set to a length, or a total length shared out evenly.
- Stage 3 is done. Still to come from stage 2: a true indexed colour mode.

## Non-goals

- Vector drawing or painting with soft brushes (NoorCanvas is for that), 3D, video.
