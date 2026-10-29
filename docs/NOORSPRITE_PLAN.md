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

## Stage 4 — more for pixel artists and games (planned after stage 3)

Indexed colour and colour cycling; tiled drawing; symmetry about any axis and radial; smooth lines (a stabilizer);
turned tiles; layer groups; gradients with dithering and pattern fills; squash, stretch and smears for in-betweens;
cel offsets with a motion path; onion skin by tag and as outlines; a timeline of thumbnails; Unity and Unreal
(Paper2D) exports; autotiling (Godot terrains); every tilemap layer in one Godot scene; hitboxes that move with the
frames; links to NoorForge, the Texture Bench, NoorSequencer, the Vault and the Gallery; command search, shortcuts of
one's own, a floating reference picture, pen pressure.

### Done in preview.99

- **Smooth lines** (the pencil's and eraser's "Smooth", S cycles it): the brush hangs on a string behind the cursor —
  gentle to very strong — so a shaky hand draws round, even curves; the string shows while drawing.
- **Indexed colour** (palette ⋯): every pixel is a palette colour by its number. Changing a colour changes every
  pixel of it; sorting, reversing or removing colours keeps the picture (the numbers follow); off-palette colours
  drawn become the nearest. Indexed .aseprite files are opened as such and saved at 8 bits (a clear entry added
  when needed); exported PNGs are palette PNGs when every pixel allows.
- **Colour cycling** (🌈): palette colours from one to another turn round at a speed — water, fire, lights —
  played on the canvas and the preview, kept in the .noorsprite file.
- **Tiling** (View): the sprite shown repeated around itself (both ways, across or down), and drawing that wraps
  round the edges — for seamless tiles and textures.
- **Symmetry** about axes of one's own (half-pixel steps, shown dashed) and **radial** symmetry (2 to 8 copies
  turned round where the axes cross).
- **Turned tiles** (⇋ ⇵ ⟳ in the tileset panel; Shift+X, Shift+Y, R in tile mode): tiles placed flipped or turned a
  quarter, kept with the tile (as Aseprite keeps them), drawn turned, and exported to Godot with its flip and
  transpose flags (checked in headless Godot 4.4).

### Done in preview.100

- **Layer groups** (📁, Ctrl+G; Ctrl+Shift+G ungroups): a group holds layers (and groups); hiding, locking and its
  opacity go for everything in it; it folds in the timeline (▸ ▾), where its row sits above its layers, indented. A new
  layer on a group goes in it; ↑ / ↓ move a layer (a group with all it holds) past the next one beside it, and out of
  its group at the edge; "In" puts a layer into any group or takes it out; duplicating a group copies all it holds.
  Kept in .noorsprite and .aseprite files (Aseprite's groups opened and saved), and named in the sheet's JSON.
- **Gradients** (D): dragged from the drawing colour to the second — straight or round, **dithered** (only the two
  colours, in an even 4 × 4 pattern, as pixel artists do) or smooth; inside the selection when there is one.
- **Pattern fills** (the fill tool's Pattern): checkers, dots, lines across or down, diagonals, bricks, 25 % and 75 %
  of the two colours (the right button swaps them).
- **In-betweens that look alive:** squash and stretch (longer along the move and thinner across, most in the middle)
  or a smear (copies trailing back to where it was a frame before).

### Done in preview.102

- **The motion path** (View): the layer's way through the frames — the middle of its picture on each, numbered and
  joined; with the move tool, drag a frame's point to move that frame's picture (one undo step).
- **Onion skin** from the frames of the tag you are in only, and as **outlines** (easier to see through).
- **A timeline of thumbnails** (View): a small picture of each frame and of each layer's picture on it.
- **Frames dragged** in the timeline to a new place, with their pictures; **Ctrl+drag** copies a frame there.
- **Terrains** (autotiling, in the tileset panel): a terrain names the tile for each of the 16 ways its neighbours
  can join a cell (by sides: up, right, down, left); drawing with it in tile mode — pencil, eraser, fill — gives each
  cell the tile for how it joins, and fits its neighbours again. Kept in the file, and exported to Godot as a terrain
  set (match sides) with each tile's peering bits.
- **Every map layer in one Godot scene** ("All map layers…"): a TileMap per tilemap layer, bottom first, each with
  its TileSet, hidden or see-through as the layer is.
- **Hitboxes:** a slice can move with the frames (a place of its own from any frame on); kept in .noorsprite and
  .aseprite files (Aseprite's slice keys) and in the sheet's JSON. The Godot export can make each slice an Area2D
  with its CollisionShape2D, and an AnimationPlayer that turns the frames with their durations and moves the
  hitboxes with them. All checked in headless Godot 4.4.
- **Unity:** the sheet with its .meta — a sprite per frame (point filtering, no compression, pixels per unit, the
  pivot and a 9-slice border from the slices) — and an AnimationClip (.anim) per tag swapping the sprites with each
  frame's duration. **Unreal Paper2D:** the sheet and its JSON in the form Paper2D's sprite-sheet import reads, with
  pivots. (Written to those formats; not opened in Unity or Unreal here.)

### Done in preview.103

- **With the other benches** (☰): this frame to **NoorForge** as a decal for the stamp tool (its shape, grown by whole
  steps to stay crisp); this frame — or on a tilemap layer, its tiles in a row — to the **Texture Bench** as a new
  material (a picture of the app's own, allowed for it); a **sound for a frame** (a .wav, .ogg or .mp3 you choose —
  NoorSequencer's and the Sound Bench's exports among them), ♪ in the timeline, played by the Godot export's
  AnimationPlayer each time the frame comes (the sound copied beside the scene; checked in headless Godot 4.4).
- **The Gallery** shows .noorsprite and .aseprite files (their first frame as the preview, composed by the app) and
  opens them — or any picture — in NoorSprite (Open in › NoorSprite).
- **The command search** (Ctrl+K here, ⌕): every NoorSprite command by name — tools, menus, palette, view, frames,
  layers — Enter runs it. **Shortcuts of your own:** ⌨ beside a command, then press the keys; they go first, and are
  kept on this computer.
- **A floating reference picture:** a picture in a window of its own over NoorSprite — dragged by its title,
  resized from its corner, made see-through — to look at while drawing.
- **Pen pressure** (pencil and eraser): with a pen, pressing lightly draws thinner, up to the brush size.
- Still to come: sprites shown inside Vault notes.

## Non-goals

- Vector drawing or painting with soft brushes (NoorCanvas is for that), 3D, video.
