# NoorMesh polish pass

Found by walking through NoorMesh as a new user (13 Nov): opening it, every menu, Edit Mode, the right-click menus,
an empty scene, closing with unsaved work, and timing every operation on meshes up to 40,000 faces. The bench audit
found no controls without names or tooltips.

**What's already good:** every button has a tooltip; the right-click menus; the selection counts in the properties;
clear messages for empty scenes and impossible actions ("Nothing to texture: select an object"); closing keeps the
scene and Undo brings deleted objects back; modelling operations stay fast (extrude, inset, bevel in tens of
milliseconds on 10,000 faces).

## Proposed list (✓ = you said yes)

### Fixes and polish

1. ✅ **Unwrap was very slow on bigger meshes** — 15 s for 10,000 faces, with the bench frozen. Now 0.4 s (packed
   solver, a preconditioner and a flat starting guess; the same UVs). *Done in this pass.*
2. **A Help menu** in focus mode, like the other big benches: Shortcuts (F1), a short "first five minutes" guide, and
   "for Blender users" (what's the same, what's different).
3. **Drop the "preview" label** (the badge, "NoorMesh is a preview…" in the side panel, the command name): it is a
   full modelling bench now.
4. **The Edit Mode status line** reads "1 vertices, 2 edges, 3 faces" (it means the keys). Show the selection instead,
   as Blender does — "Vertices 2/8 · Edges 1/12 · Faces 0/6" — and the keys in the hint.
5. **The falloff drop-down** ("Smooth") shows in Edit Mode even when proportional editing is off; show it only while
   it is on.
6. **A Select menu** (Blender has one): all, none, invert, box, linked, more/less, loops, by material slot — now spread
   over Edit and Mesh.
7. **Hide parts of a mesh in Edit Mode** (H, Shift+H, Alt+H): it says "comes later" today; Blender modellers use it
   all the time.
8. **The 3D cursor kept in the scene file.**
9. A "working…" note before long jobs (a big unwrap or Smart UV Project), so the bench never looks stuck.

### Small features (your call)

10. **Subdivide** (Mesh › Subdivide, cuts and smoothing): one of the most used modelling tools, missing today.
11. **Right-click select** (from the inbox): first a W key for the menu that right-click opens now, then the
    "Select with: left / right" setting.
12. **Proportional "connected only"** — and a question: Blender puts that on **Alt+O**, where NoorMesh has auto merge.
    Move auto merge (Blender has no key for it) and give Alt+O to "connected only"?
13. The active vertex/face as a pivot in Edit Mode; the 3D cursor's own rotation.
14. UV editor: pin, stitch, live unwrap.

## Done

- 13 Nov: unwrap 15× to 37× faster (item 1).
