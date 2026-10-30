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

## Stage 2 (preview.124)

- Smart snapping: what is moved, scaled or drawn lines up with other objects' edges and middles, the page and
  guides (pink lines show what it snapped to; hold Ctrl not to snap). Guides: View › Add a guide, guides around the
  selection; drag one to move it, off the view to remove it; saved in the SVG.
- The gradient tool (G): drag across an object to lay its gradient, drag the ends to move them; colour stops added,
  moved and removed in the panel; reverse. Gradients from other programs keep their ends (box or page units).
- Swatches: click for the fill, Shift+click for the stroke, ＋ keeps a colour.
- Live effects: a blur and a drop shadow (SVG filters, read back from files too).
- Text on a path (SVG textPath, with where it starts); text to outlines (the app gives the letters' shapes from the
  font, Ctrl+Shift+O); the system's fonts in the font list.
- Stroke to path (an outline becomes a shape); grow or shrink a shape by a distance.
- Trace a picture (File, or Object for a placed one): its colours (or black and white) become filled paths.

## Stage 3 ideas

- PDF export, several pages (artboards).
- The shape builder (click regions to keep), symbols (reused objects), patterns, mesh gradients.
- More live effects (glow, noise), and filters from other programs kept as they are.
