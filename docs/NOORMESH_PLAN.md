# NoorMesh: plan (a polygon modeller for game assets)

From the functional specification *NoorMesh — Functional Specification for Sage*. North star: **MilkShape's
immediacy, Blender's modelling fluency, native NoorMD integration, game assets first.** This document is the first
response the specification asks for (its section 15): the architecture, a gap analysis against what NoorMD already
has, a phased plan with testable milestones and risks, and the decisions to make. No code and no screens are designed
here: the screens follow the workflows and the architecture, and follow the other benches' conventions (one look for
every bench).

**The rule of thumb: Blender stripped down to its modelling.** Where NoorMesh does something Blender does, it does it
the way Blender does it (the keys, the order of the clicks, the names, the axes, how selection and transforms behave),
so a Blender user feels at home and a beginner learns skills that carry over. Everything in Blender that is not about
making a game asset's mesh (rendering, compositing, nodes, physics, video editing, scripting) is left out.

What NoorMesh is not (from the specification's guardrails): a sculpting suite, an offline renderer, VFX or physics, a
geometry-nodes system, CAD, a game engine, or FBX parity on day one. It must not hold up NoorMD's stable release, and
it must not depend on any game engine (Bad 3D Engine included).

---

## 1. Architecture

### 1.1 The parts, kept apart

| Part | Where | What it does |
|---|---|---|
| **Document model** | page (JS) + app (C#, the same JSON shape) | Scene: objects (name, transform, parent, visibility, lock, role: mesh / collision proxy / LOD level), collections, materials, per-object mesh, modifier stack, LOD groups, editor metadata. Versioned. |
| **Geometry kernel** | page: `meshkernel.js` (pure functions, no DOM) | The editable mesh and every edit operation (§1.2). Tested on its own in Node, as `inkgeom.js` is for NoorInk. |
| **Viewport** | page: `meshview.js` (WebGL 2) | Draws objects, the edit overlay (vertices, edges, faces, selection, normals, face orientation), grid, gizmo; picking; orthographic and perspective views. Shares the look-dev shading and camera maths with NoorForge's view (`assetview.js`), moved into a shared module. |
| **Undo** | page | A command history (§1.4). |
| **Heavy jobs** | app (C#, NoorMD.Media) | Import and export (glTF/GLB, OBJ), validation, triangulation for export, UV unwrap and packing, decimation (LODs), convex hulls, baking hand-off. Run off the UI thread, cancellable, with progress. |
| **Files and integration** | app (C#) | Open/save/autosave/recovery, recent files, the Vault, asset hand-off to NoorForm / NoorForge / NoorMaterial. |

The page talks to the app through the existing bridge (`req(...)`), with the same rules as every bench: no file
system access from the page, every path chosen by the user or named by an opened document, all input validated.

### 1.2 Geometry representation

**Recommendation: the editable mesh lives in the page (JS), as an index-based polygon mesh with derived adjacency.**

Why the page and not C#: modelling is interactive. Dragging a vertex, sliding an edge loop or scrubbing a bevel's
width changes the mesh on every mouse move, and the viewport must redraw from it at once. Sending meshes across the
bridge on every move is too slow and doubles the state. NoorInk already works this way (geometry in `inkgeom.js`, files
in C#) and it has held up.

The representation (BMesh-like, kept small):

- **Vertices**: positions (`Float32Array`), plus a stable id each.
- **Faces**: n-gons (3 or more corners), each a loop of vertex indices, with a material slot and a smooth flag.
- **Face corners (loops)**: per-corner attributes (UV0, UV1, later colour and custom normals). A UV seam is simply two
  corners of one vertex with different UVs, so seams survive every edit and export.
- **Edges**: derived from the faces; edge flags (seam, sharp, crease for subdivision) stored by vertex pair.
- **Adjacency**: a half-edge structure built from the above when an operation needs it and dropped after a change
  (cheap to rebuild at game-asset sizes; no cache to get out of step).

Every operation is a pure function `(mesh, selection, params) → { mesh, selection }`, so it can be previewed live, undone
and tested. Non-manifold input (imported meshes) is allowed; operations that need manifold topology say so and refuse
rather than corrupt it.

The renderer gets its own triangulated buffers (with split vertices where UVs or smoothing differ), made from the
mesh after each change; the mesh is never the GPU format.

The C# side has a matching plain data class (the JSON/binary shape, n-gons and corners) with no editing operations:
it reads, validates, triangulates and writes. One kernel, one place for the edit logic.

### 1.3 The document format

- **`.noormesh`**: a zip container (as Vault packs are): `scene.json` (versioned: objects, hierarchy, materials,
  modifiers, LOD groups, metadata), one binary buffer per mesh (positions, faces, corners, flags: compact and fast),
  and, only if the user packs them, textures. Textures are otherwise referenced by relative path.
- Versioned with migrations: a newer file opened by an older NoorMD is refused with a clear message, never half-read.
- **Autosave and recovery** through the app's existing recovery store (app data, not browser storage), with the same
  "no silent data loss" rules as documents: unsaved marker, prompt on close, recovery after a crash.
- Export never changes the source: the editable document and the exported, triangulated asset are separate files.

### 1.4 Undo

- A **command history**: each command records the objects it changed (their mesh and/or properties before and after),
  never the whole scene. Game assets are small (thousands to tens of thousands of vertices), so a changed object's
  compact typed-array copy is cheap; a step that moves one vertex in a 20k-vertex mesh stores one object, not twenty.
- **History boundaries**: one step per finished operation (a whole drag, a confirmed bevel, an applied modifier, a UV
  unwrap), never per mouse move. Live previews change a working copy and commit once.
- Selection changes are not undo steps but are restored with the step they belong to (as Blender does).
- A memory budget (e.g. 256 MB of history) drops the oldest steps first, and says so.

### 1.5 Import and export

- **glTF 2.0 / GLB (primary)**: a new reader that keeps the node hierarchy, transforms, meshes and primitives,
  materials and textures, UV0/UV1, normals, vertex colours, and (phase C) skins and animations. The existing
  `ForgeModel.ReadGlb` flattens everything into texture sets for painting, which is right for NoorForge but not for
  editing. Writer: the existing `GlbWriter` (already validated in CI with the Khronos validator), extended with node
  hierarchy and, later, skins and animation.
  - glTF has no n-gons: on import, triangles can optionally be joined back into quads ("tris to quads"); on export,
    n-gons are triangulated robustly (ear clipping on the face's best-fit plane, handling concave faces).
- **OBJ + MTL**: read and write with n-gons kept (OBJ supports them); limits stated in the UI (no hierarchy, no
  skins, materials as MTL only).
- **FBX**: not in phases A–C (§4).
- **Round-trip tests with real files**: export → import → compare (vertex positions within tolerance, face count,
  UVs, materials, hierarchy, scale), plus the Khronos validator in CI, plus a headless import into Godot (already in
  CI for NoorForm) for the acceptance assets.

### 1.6 Units and axes

Metres and **+Z up, as in Blender** (the floor is X by Y; X red, Y green, Z blue; the front view looks from −Y), so
numbers and directions read the same as in Blender. Exports turn it to glTF's +Y up (and OBJ's), as Blender's
exporters do. Export presets per engine (Godot, Unity, Unreal: axis, scale, naming of collision and LODs)
reuse NoorForm's export profiles (`GameProfiles.cs`).

---

## 2. Gap analysis: what NoorMD has, what must be built

| Need (spec §) | Already in NoorMD | To build |
|---|---|---|
| Bench shell, menus, focus mode, settings, translations (§10, §11) | All benches share these (preview.114, .118) | The NoorMesh bench using them |
| Command search, shortcuts of one's own (§2) | NoorSprite has both (preview.104) | Move them to a shared module; Blender-like defaults for NoorMesh |
| 3D viewport (§2) | `assetview.js`: WebGL 2, orbit/pan/zoom, frame, ray picking, wireframe, PBR look-dev light (preview.139–140) | Editing viewport: dynamic buffers, vertex/edge/face overlays, box/circle select, orthographic front/side/top, transform gizmo, snapping feedback, isolate. Shared shading and camera code split out of `assetview.js` |
| Editable mesh and operations (§3) | `Mesh3D` is a triangle export mesh (no topology); NoorForm builds meshes procedurally | Everything in `meshkernel.js`: the representation and every operation |
| Primitives (§3) | NoorForm has procedural shapes, not editable primitives | Cube, plane, UV sphere, ico sphere, cylinder, cone, torus, grid with parameters |
| Normals, smoothing (§3) | `ComputeNormals`, `ComputeTangents` (tangent handedness fixed in preview.139) | Smooth/flat per face, by angle, sharp edges, weighted normals; custom normals later |
| Mesh checks (§3, §7) | `Mesh3D.Problems()` (finite values, unit normals, index ranges) | Non-manifold edges, open borders, degenerate faces, duplicate vertices, inverted normals, UV problems, report and select |
| Undo (§2) | Each bench has its own JSON snapshot undo | Command history per object (§1.4) |
| Native file, autosave, recovery (§9) | Recovery store, recent files, Vault | `.noormesh` container and migrations |
| glTF/GLB (§9) | `GlbWriter` (validated); `ForgeModel.ReadGlb` (flattening) | Hierarchy-preserving reader; writer hierarchy, then skins and animation |
| OBJ (§9) | `ForgeModel.ReadObj` (flattening, triangles) | N-gon-preserving reader and writer, MTL |
| Modifiers (§4) | Simplifier (QEM, for LODs) | Mirror, bevel, array, solidify, subdivision (Catmull-Clark), decimate (wrapping the existing simplifier), weighted normals; stack with preview and apply |
| UV editing (§5) | `UvAtlas`: automatic charts by facing side, packing; seams handled across baking | Seams, LSCM unwrap, projections (planar, cylindrical, box), the UV editor (select, move, rotate, scale, align, stitch, pin, relax), packing with padding, texel density, stretch display, checker texture, UV layout export |
| Materials (§6) | `Material3D` (PBR, alpha, double-sided); NoorForge/NoorMaterial make texture sets | Material slots per face, texture linking and relinking, missing-texture repair, packing on save |
| LODs (§7) | NoorForm: LOD levels by budget with the QEM simplifier, Godot LOD extras | LOD groups of any object; suggestions with silhouette preservation, shown for review |
| Collision (§7) | NoorForm: convex pieces, Godot `-convcolonly` naming | Box/sphere/capsule/convex hull proxies from a selection, simplified mesh colliders |
| Pivots, origin, naming, export checks (§7) | NoorForm export profiles | Origin tools, pre-export checklist |
| Baking normals/AO (§7, later) | NoorForge bakes high-poly to low-poly (preview.13x) | Hand-off: "Texture this in NoorForge" with its high-poly |
| Procedural sources (§10) | NoorForm trees and rocks with recipes | "Edit a copy in NoorMesh": the recipe stays, the copy becomes editable |
| Painting and texturing (§10) | NoorForge: layers, Paints (preview.141), export | "Texture in NoorForge" / "back to NoorMesh" through the asset interface |
| Skeletons, weights, animation (§8) | NoorSprite's 2D bones (preview.106) as a pattern only | Armatures, skinning, weights, pose mode, keyframes, clips, IK, glTF skins and animation |

Summary: NoorMD has the shell, the bridge, a good 3D view, GLB writing, simplification, automatic UV charts, baking
and texturing. The **editable geometry kernel, the editing viewport, the hierarchy-preserving importers and the UV
editor** are new, and they are most of the work.

---

## 3. Phased plan

Each milestone ships in a preview release with automated tests (kernel tests in Node, C# tests for files, UI tests in
Chromium) and is usable on its own. The bench is marked *preview* until phase A's acceptance demo passes.

### Phase A: a working modeller (MVP)

**Done in preview.142: A1** — the geometry kernel (`meshkernel.js`: polygon faces with per-corner UVs, the eight
primitives, checks, triangulation of concave n-gons, transforms; tested in Node), the viewport (`meshview.js`: look-dev
light, grid with axes, orthographic front/side/top and perspective, picking, outlines), and the bench in Object Mode
(Shift+A, click and box select, G/R/S with X/Y/Z, typed numbers and Ctrl steps, Shift+D, X, H/Alt+H/Shift+H, Ctrl+A
apply, Alt+G/R/S clear, the Adjust panel for the last primitive, the properties' numbers, undo and redo, focus-mode
menus, F1 shortcuts). preview.143: Blender's axes (Z up) and the middle button picking an axis during G/R/S.

**Done in preview.144: A2** — Edit Mode (Tab) on the active object: vertices, edges and faces (1, 2, 3) with Blender's
selection rules (the mode's own set, the others following from it); click, Shift+click, box select, Alt+click loops
(edge loops through quads, border loops, face loops), L / Ctrl+L linked, Ctrl+Numpad +/− more and less; only what can be
seen is picked (X-ray off). G/R/S on the selection (axes, numbers, Ctrl, middle button) and the Median in the
properties; E extrude (faces as a region, then along their normal; border edges), I inset (each face by itself), X
delete (vertices, edges, faces, only faces, dissolve…), Ctrl+X dissolve, M merge (at the centre, at the 3D cursor,
collapse, by distance), F make face (fills a border loop), Alt+N / Shift+N normals, shade smooth/flat, Shift+D duplicate
faces, the right-click menu, undo across modes. Not yet: region inset (several faces as one), vertex extrude into loose
edges, hiding parts of a mesh, A3's bevel / loop cut / knife.

| Milestone | Contents | Test that proves it |
|---|---|---|
| **A1. Kernel and view** | Mesh representation, primitives, triangulation for drawing, the editing viewport (orbit, pan, zoom, ortho front/side/top, frame selected/all), Object Mode: select, move/rotate/scale with axis constraints and typed values, duplicate, delete, rename | Kernel tests: primitives are closed and manifold, Euler characteristic right; UI: G/R/S with X/Y/Z and typed numbers |
| **A2. Edit Mode** | Vertex/edge/face selection (click, box, all/none/invert, linked, loops and rings, grow/shrink), transforms on components, extrude (region, individual), inset, merge (at centre, by distance), delete and dissolve, make face/edge, flip and recalculate normals, smooth/flat | Kernel tests per operation: topology valid after, no non-manifold edges where there were none, normals consistent |
| **A3. The harder operations** | Bevel (edges and vertices: width, segments, profile), loop cut and slide, knife, bridge edge loops, fill holes, subdivide, triangulate/quads, separate/join, snapping (grid, vertex, edge, face), proportional editing, symmetry editing | Golden tests on known meshes (a beveled cube's face and vertex counts, positions), fuzz tests on random edits never producing invalid topology |
| **A4. Files** | `.noormesh` save/open/autosave/recovery, undo/redo for everything, GLB and OBJ import (hierarchy kept) and export, mesh checks, origin/pivot tools | Round-trip tests with real files; Khronos validator; headless Godot import |

**Acceptance demo (A):** model a low-poly crate, a sword and a modular wall section from scratch, edit their topology,
save natively, export GLB, import it into an independent viewer (Godot headless in CI, Blender by hand), and confirm
geometry and scale.

**Done in preview.145: A4 (before A3, by choice)** — files. `.noormesh` (a zip holding scene.json: objects, placements,
n-gon meshes with per-corner UVs, smoothing; versioned, checked on reading, a newer format explained), Save (Ctrl+S, Save
as the first time), Save as (Ctrl+Shift+S), Open (Ctrl+O, asking about unsaved changes), Open recent, New; the title marks
unsaved changes; a draft is kept a few seconds after each change and offered back after a crash. Export: GLB (one node
per shown object with its location, rotation and scale; n-gons triangulated by ear clipping; flat and smooth normals;
UVs) and OBJ (n-gons kept, in the world), both turned to +Y up; checked by the Khronos validator in CI and read back by
an independent reader in the tests. Import: GLB (each node with a mesh an object, its world placement kept, vertices
welded, smooth faces found from the normals) and OBJ (n-gons, "o"/"g" objects, smoothing groups), turned to +Z up. Not
yet: tris-to-quads after a GLB import, materials and textures in exports (phase B), glTF (.gltf with a separate .bin).

**Done in preview.146: A3, first half** — gizmos for move, rotate and scale (each switched on or off with the ✥ ⟳ ⤡
buttons or the View menu, remembered; the arrows hold to an axis, the squares to a plane, the rings turn about an axis or
the view, the boxes scale along one, the middle ring evenly; in Object and Edit Mode); Shift+X/Y/Z during G holds to a
plane leaving that axis out; the coloured axis line shows during G/R/S in Edit Mode too. Region inset (I: a ring along
the region's border only; I again: each face by itself). Loop cut and slide (Ctrl+R: point at an edge, the wheel or + −
or a number for how many cuts, click, slide, click; right-click while sliding keeps it in the middle; faces at the
loop's ends get the new vertices on their edges). Bridge edge loops (Ctrl+E, or the right-click menu: two runs of edges
with the same count, lined up for the shortest joins and turned to agree with the faces beside them; two selected faces
are taken out and their borders joined). Snapping (Shift+Tab or the magnet: steps of 0.1 m / 5° / 0.1, or a move onto
the vertex nearest the mouse; Ctrl does the other). The Edit Mode overlay now hides behind nearby surfaces properly (its
lift is a share of the distance, not a fixed depth). Next (preview.147): bevel (Ctrl+B), knife (K), proportional
editing (O), mirror editing.

**Done in preview.147: A3, second half** — bevel (Ctrl+B: edges between two faces become strips, the width from the
mouse or typed, the wheel or + − for segments rounded towards the old edge, V for vertices; Ctrl+Shift+B: vertices cut
off; corners where beveled edges meet get a patch, two beveled edges meeting share one rounded edge; the width held
back so nothing overlaps); knife (K: click points, onto a vertex when near, the crossings shown, Enter or Space cuts the
faces it crosses, Backspace takes the last point back); proportional editing (O, Shift+O cycles the falloff: smooth,
sphere, root, linear, sharp, constant; the wheel or Page Up / Down sets its radius while moving, rotating or scaling,
shown as a circle); mirror editing (the ⇋X ⇋Y ⇋Z buttons: the twin across each chosen axis moves too); slide (G twice:
an edge loop between its neighbours on each side, E even, F flip; a vertex along the edge most the way the mouse goes);
Shift+X/Y/Z while scaling (two axes, the third left alone); auto merge (Alt+O or ⊕: vertices moved onto others are
merged into them, in the same undo step). Not yet: proportional "connected only", the bevel profile shape, knife
through face interiors (points inside a face), Blender's grid-filled bevel corners (an n-gon patch here).

**Done in preview.148** — the 3D cursor (drawn as Blender's red and white ring; Shift+right-click puts it on the surface
under the mouse, or in the view's plane off every object; Shift+S: selection to cursor, with or without keeping its
offset, cursor to selected / active / world origin / grid; Shift+C: back to the origin and everything framed; new
objects and "merge at the cursor" go there); the pivot point (".", or the toolbar: median point, 3D cursor, individual
origins: each object, or each connected part of an Edit Mode selection, turns and scales about its own middle; active
element: the active object; remembered) for G/R/S and the gizmos; join (Ctrl+J: into the active object, its placement
kept, mirrored objects turned the right way out); separate (P: the selected faces, or each loose part, as new objects
with the same placement); origins (origin to geometry, origin to 3D cursor, geometry to origin; the object's look
unchanged). Not yet: the cursor's own rotation, the active vertex or face as a pivot in Edit Mode, the cursor kept in
the file.

**Done in preview.149: the knife, as Blender's K** — each point is kept on the mesh itself (a vertex, a place on an edge,
an edge's middle, or a point inside a face hit by a ray from the mouse; in the object's own space), so turning, moving
or zooming the view (middle-drag, wheel, the numpad views all work while cutting) leaves it exactly where it was put;
the preview is drawn from those points again after every frame. Between two points the cut runs over the surface: the
plane through both and the camera (where it was when the second was placed) is followed face by face, over edges and
through vertices, onto the faces beside. Enter splits every face it runs across (from an edge or corner to another,
through the points inside it); ends left hanging inside a face are dropped, and edges crossed for nothing are left
whole, so no loose edges or stray vertices are made. One undo step.

**Done in preview.150: Edit Mode on several objects at once** — Tab with several meshes selected edits them together
(as Blender's): their meshes are put into the active object's space for editing, each face knowing whose it is, so
every Edit Mode tool reaches all of them at once (selecting, G/R/S, gizmos, extrude, bevel, loop cut, knife…); new
faces belong to the object of the faces beside them. Undo and redo work inside it and across leaving it; saving while
editing writes each object's own mesh; Tab splits them back into the objects, each in its own space, placement kept
(mirrored objects turned the right way out).

**Next, agreed after preview.146:**

- **preview.147:** bevel (Ctrl+B: width, segments, profile; Ctrl+Shift+B for vertices), knife (K), proportional editing
  (O: falloff shapes, the wheel for its size, connected only), mirror editing (X/Y/Z symmetry in Edit Mode); vertex and
  edge slide (G pressed twice in Edit Mode, as Blender's: a vertex slides along one of its edges, an edge loop along the
  faces beside it; Alt or C for even, F to flip); Shift+X/Y/Z for scaling too (scale on two axes, the third left alone),
  not only for moving; auto merge vertices (a toggle beside snapping, as Blender's: after a move in Edit Mode, vertices
  that land on others within a small distance are merged into them; the distance adjustable, remembered).
- **preview.148:** the 3D cursor (Shift+right-click places it on the surface under the mouse; Shift+S: cursor to selected,
  to world origin, selection to cursor; Shift+C: reset it and frame everything; new objects and "merge at the cursor" use
  it); the pivot point menu (`.`: median, 3D cursor, individual origins, active element) for G/R/S, the gizmos and
  scaling; join (Ctrl+J) and separate (P: selection, loose parts); origin tools (origin to geometry, to the 3D cursor,
  geometry to origin).
- **preview.149:** Edit Mode on several objects at once (Tab with several meshes selected; each keeps its own mesh,
  selection, transforms and the operations above working across them).

### Phase B: production-friendly static assets

| Milestone | Contents |
|---|---|
| **B1. UVs** | Seams, LSCM unwrap, projections, the UV editor, packing with padding, texel density, stretch and overlap display, checker texture, UV1 for lightmaps |
| **B2. Materials** | Slots per face, PBR materials, textures linked/relinked/packed, missing-texture repair; NoorForge and NoorMaterial hand-off |
| **B3. Modifiers** | Mirror, array, solidify, bevel, subdivision, decimate, weighted normals: a stack with preview, reorder and apply |
| **B4. Game prep** | LOD groups with reviewed suggestions, collision proxies (box, sphere, capsule, convex hull, simplified mesh), export presets per engine, the pre-export checklist; NoorForm "edit a copy" |

**Acceptance demo (B):** import a NoorForm rock or tree or an external prop, edit its mesh and UVs, assign textures,
generate and review LODs and collisions, export a complete engine-ready asset (checked in Godot).

### Phase C: animated assets

Armatures (bones, hierarchy, rest pose), binding with automatic weights (heat or distance-based), weight painting,
pose mode, keyframes and clips with a timeline and curves, basic IK, glTF skins and animation in and out.
**Acceptance demo (C):** rig a simple low-poly character, author idle and walk clips, export GLB and play them in an
independent runtime (Godot headless in CI).

### Phase D: later, optional

Better retopology, more UV tools, baking inside NoorMesh, impostors, selective procedural tools, live engine links,
richer animation.

### Critical technical risks

| Risk | Why it is hard | How it is contained |
|---|---|---|
| **Bevel** | Blender's bevel is famously the hardest modelling operation: corners where three or more beveled edges meet, profiles, clamping overlap | Ship edge bevel with one or more segments first, vertex bevel second; clamp by default; golden and fuzz tests; refuse (with a message) rather than produce bad topology |
| **Robustness of every edit** | N-gons, concave faces, non-manifold imports | Pure operations with topology validation after each in tests; fuzzing; operations state what they need and refuse otherwise |
| **Interaction speed in the page** | JS kernel and WebGL redraws on every move | Typed arrays, incremental buffer updates for transforms (no rebuild), adjacency built only when needed; measured on 50k-triangle assets as a budget |
| **Undo memory** | Copies per step | Per-object copies, a memory budget, delta encoding later if needed |
| **Round trips** | glTF has no n-gons, OBJ no hierarchy | Native format keeps everything; export is one-way and says what it drops; tris-to-quads on import |
| **UV unwrap quality** | LSCM needs a sparse least-squares solver; packing must be tight | Own conjugate-gradient solver (small); tested against stretch metrics; the existing chart packer as the base |
| **Skinning (phase C)** | Automatic weights and glTF skin conventions | Kept for after phase B; Godot round trip in CI |
| **Scope** | The specification is large | Narrow and reliable first: each milestone usable alone; no tool ships half-working |

---

## 4. Decisions to make (and library and licence concerns)

1. **Where the kernel lives.** Recommended: the page (JS), as above. The alternative (C#) gives one language with
   the app's other geometry but makes every live edit cross the bridge. *Recommendation: page.*
2. **Native format.** Recommended: a zip container with JSON plus binary buffers (`.noormesh`). *Recommendation:
   yes.*
3. **Default shortcuts.** Blender's (G/R/S, E, I, Ctrl+B, Ctrl+R, K, 1/2/3, Tab, A, Alt+A, numpad views), all
   remappable. Some clash with NoorMD's own (Ctrl+K is the command palette): inside NoorMesh, NoorMesh's win, as in the
   other benches. **Decided: Blender's.**
4. **FBX.** The Autodesk FBX SDK's licence does not suit redistribution in an open project; **ufbx** (MIT, C, an FBX
   reader) could give FBX import later through a small native wrapper; no FBX export. *Recommendation: not before
   phase C; import only, via ufbx, if it is still wanted then.*
5. **Third-party geometry libraries.** None needed for phase A. Candidates if they save real work later: **xatlas**
   (MIT, C++) for unwrap and packing (native dependency), **meshoptimizer** (MIT, C) for vertex cache and
   simplification. Both permissive; both mean native binaries in the Windows package. *Recommendation: own code first
   (LSCM, packing and QEM already half exist), revisit at B1 if quality falls short.*
6. **What happens to NoorForm assets.** "Edit a copy in NoorMesh" keeps the recipe untouched; no live link back.
   *Recommendation: yes.*
7. **Where NoorMesh sits in releases.** **Decided: visible from A1 as a bench marked *preview*,** so each step can be
   tried and steered early.
8. **Engine integration.** None in phases A–C beyond export presets; Bad 3D Engine adapters only when that engine
   exists, without NoorMD depending on it. *Recommendation: as stated.*
