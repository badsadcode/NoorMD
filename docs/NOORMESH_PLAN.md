# NoorMesh: plan (a polygon modeller for game assets)

From the functional specification *NoorMesh — Functional Specification for Sage*. North star: **MilkShape's
immediacy, Blender's modelling fluency, native NoorMD integration, game assets first.** This document is the first
response the specification asks for (its section 15): the architecture, a gap analysis against what NoorMD already
has, a phased plan with testable milestones and risks, and the decisions to make. No code and no screens are designed
here: the screens follow the workflows and the architecture, and follow the other benches' conventions (one look for
every bench).

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

Metres and +Y up, as glTF. Export presets per engine (Godot, Unity, Unreal: axis, scale, naming of collision and LODs)
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

| Milestone | Contents | Test that proves it |
|---|---|---|
| **A1. Kernel and view** | Mesh representation, primitives, triangulation for drawing, the editing viewport (orbit, pan, zoom, ortho front/side/top, frame selected/all), Object Mode: select, move/rotate/scale with axis constraints and typed values, duplicate, delete, rename | Kernel tests: primitives are closed and manifold, Euler characteristic right; UI: G/R/S with X/Y/Z and typed numbers |
| **A2. Edit Mode** | Vertex/edge/face selection (click, box, all/none/invert, linked, loops and rings, grow/shrink), transforms on components, extrude (region, individual), inset, merge (at centre, by distance), delete and dissolve, make face/edge, flip and recalculate normals, smooth/flat | Kernel tests per operation: topology valid after, no non-manifold edges where there were none, normals consistent |
| **A3. The harder operations** | Bevel (edges and vertices: width, segments, profile), loop cut and slide, knife, bridge edge loops, fill holes, subdivide, triangulate/quads, separate/join, snapping (grid, vertex, edge, face), proportional editing, symmetry editing | Golden tests on known meshes (a beveled cube's face and vertex counts, positions), fuzz tests on random edits never producing invalid topology |
| **A4. Files** | `.noormesh` save/open/autosave/recovery, undo/redo for everything, GLB and OBJ import (hierarchy kept) and export, mesh checks, origin/pivot tools | Round-trip tests with real files; Khronos validator; headless Godot import |

**Acceptance demo (A):** model a low-poly crate, a sword and a modular wall section from scratch, edit their topology,
save natively, export GLB, import it into an independent viewer (Godot headless in CI, Blender by hand), and confirm
geometry and scale.

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
   other benches. *Recommendation: Blender's.*
4. **FBX.** The Autodesk FBX SDK's licence does not suit redistribution in an open project; **ufbx** (MIT, C, an FBX
   reader) could give FBX import later through a small native wrapper; no FBX export. *Recommendation: not before
   phase C; import only, via ufbx, if it is still wanted then.*
5. **Third-party geometry libraries.** None needed for phase A. Candidates if they save real work later: **xatlas**
   (MIT, C++) for unwrap and packing (native dependency), **meshoptimizer** (MIT, C) for vertex cache and
   simplification. Both permissive; both mean native binaries in the Windows package. *Recommendation: own code first
   (LSCM, packing and QEM already half exist), revisit at B1 if quality falls short.*
6. **What happens to NoorForm assets.** "Edit a copy in NoorMesh" keeps the recipe untouched; no live link back.
   *Recommendation: yes.*
7. **Where NoorMesh sits in releases.** A bench marked *preview* from A1 so you can try it early, or hidden until
   phase A is complete. *Your call.*
8. **Engine integration.** None in phases A–C beyond export presets; Bad 3D Engine adapters only when that engine
   exists, without NoorMD depending on it. *Recommendation: as stated.*
