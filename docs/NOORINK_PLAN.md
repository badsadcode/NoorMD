# NoorInk: a vector editor

NoorInk draws pictures made of shapes, not pixels: they stay sharp at any size. The picture *is* SVG, so files go
back and forth with Inkscape, Illustrator, Figma and browsers. Ideas come from those programs; no code is taken
from any of them.

## How it is built

- **The page** (`wwwroot/js/ink.js`) keeps the drawing as layers of objects: paths, text, pictures and groups
  (a group can carry a clip path or a mask). It draws them as live SVG elements, so the browser does the drawing
  and the zoom costs nothing.
- **Paths** are subpaths of anchors, each with two cubic handles (`{ x, y, ix, iy, ox, oy }`). Rectangles, ellipses,
  polygons, stars and lines become paths when drawn, so every shape can be edited point by point.
- **The maths** (`wwwroot/js/inkgeom.js`, `NoorInkGeom`): SVG path parsing and writing, matrices, exact bounds,
  hit testing, nearest point, splitting, fitting curves to freehand points, shapes, and Boolean operations (unite,
  subtract, intersect, exclude) on an exact integer grid. Tested in Node (`tests/web/inkgeom.test.js`).
- **Undo** keeps the document as it was before each step (vector pictures are small).
- **The app** (`MainWindow.Ink.cs`, `NoorMD.Core/Ink/InkSvg.cs`) opens and saves the files. Every SVG is
  cleaned when it is opened: scripts, embedded web pages, sound and video, links to other files and style rules that
  load things are taken out, and what was taken out is said. DTDs are never read.
- **Opening**: the cleaned SVG is put into a blank frame where no scripts run, and the browser works out each
  element's style there (classes, style sheets, inheritance); shapes become paths, Inkscape layers become layers,
  `<use>` becomes a group, clip paths and masks are kept.

## Stage 1 (preview.123)

- Tools: select (move, scale from the handles, turn from just outside the corners; Shift keeps proportions or
  steps of 15°, Alt from the middle or a copy), edit points (drag anchors and handles; Alt+click: smooth or corner;
  Ctrl+click on the path: a new point; Delete), pen, pencil, rectangle (rounded corners), ellipse, polygon, star,
  line, text typed on the page, eyedropper, hand, zoom.
- Fill: none, a colour, a linear or radial gradient. Stroke: colour, width, dashes, ends. Opacity, blend modes.
- Arrange: position and size typed in, align (to each other or the page), distribute, flip, turn 90°, group,
  ungroup, forward / back, lock, hide, layers (new, order, show, lock, rename), to the layer above or below.
- Path: unite, subtract, intersect, exclude, simplify, reverse. Object: clip, mask, release.
- Files: SVG open / save / recent, a draft kept while unsaved, export PNG (any size, see-through or not) or an SVG
  copy, place a picture, copy and paste (as SVG text too, to and from other programs), to NoorPhoto as pixels.

## Stage 2 ideas

- Text on a path, text to outlines, fonts list from the system.
- Gradient handles on the canvas; mesh-like gradients; patterns.
- Stroke to path, offset (grow / shrink) a path, the shape builder (click regions to keep).
- Symbols (reused objects), a swatches panel, guides and smart snapping (to other objects' edges and middles).
- Artboards (several pages), PDF export.
- Trace a picture (pixels to paths), live effects (blur, drop shadow as SVG filters).
