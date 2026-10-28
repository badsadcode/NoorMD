# Icon set brief (prompt for an AI coding agent such as Codex)

Copy everything from "PROMPT" to the end into the agent. It is self-contained.

---

## PROMPT

You are designing and drawing a complete, consistent icon set for **NoorMD**, a Windows desktop writing studio
(Markdown editor) with creative "benches": Music, Video, Gallery, Radio, Sound (procedural sound effects), Texture
(procedural PBR materials for games), NoorSketch (drawing), a Stream Desk (for live streaming), an Apps Hub and
Vaults (folders of linked notes). The app's UI is a web page (WebView2), dark and light themes, accent colour
violet. Icons are drawn inline as SVG paths.

### What to deliver

1. `icons/noormd-icons.json`: an object mapping each icon **name** (exactly as listed below) to the SVG path
   data string (`d`) for a 24 × 24 viewBox. One path per icon (several subpaths in one `d` are fine).
2. `icons/svg/<name>.svg`: each icon as a standalone file:
   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
   stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="…"/></svg>`
3. `icons/preview.html`: a contact sheet (no external files) showing every icon at 16, 20, 24 and 32 px, on a
   dark (#14141c) and a light (#ffffff) background, with its name under it, grouped by the sections below.
4. `icons/app/`: the app icon (see the last section) as `NoorMD.svg`, and PNGs at 16, 20, 24, 32, 40, 48, 64,
   96, 128 and 256 px, and a multi-size `NoorMD.ico` (all those sizes).
5. `icons/README.md`: the style rules you followed and any icon that needed a judgement call.

### Style (every icon must follow this)

- 24 × 24 viewBox; keep shapes inside 2–22 (2 px padding); centre them optically.
- **Outline style**: stroke only, `stroke="currentColor"`, width 1.75, round caps and joins, no fill. A "dot" is a
  zero-length stroke (`M12 12h.01`). No text or letters in icons (except where a letter is the convention:
  bold "B" shape, italic slant, heading "H").
- Readable at **16 px**: at most ~3 ideas per icon, no detail smaller than 2 px, gaps of at least 1.5 px.
- Consistent metaphors: the same object always means the same thing (folder = a place, document = a file,
  play triangle = start, a circle with a dot = live/broadcast). Mirror pairs (undo/redo, zoom in/out) are exact
  mirrors or the same base with one change.
- Corner radius about 2 on rectangles; a 45° rule for diagonals; strokes on whole or half pixels so they stay
  sharp at 24 px.
- Neutral and friendly, not playful; matches Lucide/Feather in weight, but draw your own (no copying any icon
  library's paths, no brand logos, no emoji look-alikes).
- Works in one colour (it inherits the text colour); must not rely on colour to be understood.

### The icons (name — meaning)

**1. Document and editing (toolbar).** These exist today; redraw them in the same style so the set is consistent:
new — new document · open — open a file · save — save · undo · redo · bold · italic · strike — strikethrough ·
link · ul — bullet list · ol — numbered list · task — checklist · quote · code — inline code · codeblock ·
table · hr — horizontal rule · image — insert image · heading — headings (H shape) · find — find in document ·
search — search everything · sidebar — show/hide sidebar · tabs — open documents · focus — focus mode ·
width — line width · snapshot — revision snapshot (clock + document) · palette — command palette ·
gear — preferences · more — overflow (three dots) · print · export — export a copy (arrow out of a box) ·
pdf — export PDF (document with a fold, no letters) · html — export web page (document with angle brackets) ·
markdown — Markdown source mode (document with a down-arrow and an M-shaped stroke allowed) ·
visual — visual (WYSIWYG) mode · split — split view (source | preview) · theme — light/dark theme ·
recent — recent files · close — close · pin — pin · unpin.

**2. Workspace and panels.**
vault — a Vault (folder of linked notes) · vault-new · pack — pack/share a vault (a parcel) · backlinks —
linked from · tag — tag · graph — note map (connected nodes) · dock-left · dock-right · dock-bottom ·
dock-center — put a panel in the middle as a tab · window — pop out to its own window · layout — workspace
layouts · goal — writing goal (target).

**3. The benches (each needs a strong, distinct silhouette; they are shown as panel and tab icons).**
music — Music Bench (music library) · video — Video Bench · gallery — Gallery (picture manager) · radio —
Radio Bench (internet radio) · sound — Sound Bench (procedural sound effects: a waveform, not a speaker) ·
texture — Texture Bench (materials: a tiled square with a bevelled tile, or a sphere with a tile pattern) ·
sketch — NoorSketch (pen) · stream — Stream Desk (live) · apps — Apps Hub (grid of tiles) · voice — voice notes
(microphone) · sequencer — NoorSequencer, a composer coming later (piano-roll blocks on a grid).

**4. Media and transport.**
play · pause · stop · previous · next · shuffle · repeat · repeat-one · random — random track (a die) ·
volume · volume-mute · loop — play over and over · nowplaying — now playing (note + waves) · queue · favorite —
favourite (heart) · star — rating · label — colour label (tag shape, no colour) · rotate-left · rotate-right ·
slideshow · fullscreen · fullscreen-exit · subtitles · speed — playback speed · equalizer · record — record (a
filled-looking circle drawn as a ring with a dot) · mic — microphone · mic-off · live — on air ·
credits — rolling credits · overlay — stream overlay (a frame inside a frame).

**5. Bench tools (used in the Sound and Texture Benches).**
variation — a new variation (die with a curved arrow) · pin-ab — pin as A for A/B compare · compare — A/B ·
reference — a reference to compare with (headphones) · generate — generate (sparkle) · layer — a layer ·
layer-add · layer-up · layer-down · duplicate · mute-layer — hide a layer (eye with a slash) · reseed — reseed
one layer (small die) · modulation — modulation (sine wave with an arrow) · knob — a control knob · automation —
automation curve · map — the sound as connected blocks · meters — loudness meters · spectrogram · bus — a bus
(lines merging) · send — send to a bus · stems — stems (stacked waves) · reverb — reverb (expanding arcs) ·
filter — filter (a curve falling off) · resonator — resonator (a string or bowl) · loop-seam — seamless loop
(a loop with a join mark) · wav-export — export audio (waveform with a down arrow) · png-export — export maps
(stacked squares with a down arrow) · folder-open — reveal the folder · project — a game project (folder with a
game-controller-like corner, no brand) · preset — a preset · preset-save — save as preset.

**6. Texture Bench: views, lights, shapes, maps and layer kinds.**
view-3d — 3D preview · view-flat — flat tiled map · sphere · cube · rounded-cube · plane · light — a light
(bulb) · light-orbit — light going round (bulb on a circular arrow) · zoom-in · zoom-out · reset-view ·
side-by-side — preview and controls side by side · list — show/hide a list · depth — parallax depth ·
clay — lighting only (a plain grey sphere) · tiling — 2 × 2 tiles ·
Maps: map-albedo (colour: a square with a gradient band drawn in strokes) · map-normal (a square with small
tilted arrows) · map-roughness (a square with fine dots) · map-ao (a square with shadowed corners) ·
map-height (a square with a mountain profile) · map-metallic (a square with a shine stroke) ·
Layer kinds: noise · ridged · turbulence · cells (voronoi) · wood (grain) · bricks · tiles · hexagons ·
planks · spots · weave · scratches · photo (a picture layer) · painted (brush over a square) · mask-height
(height-so-far mask: a level line over hills) · mask-edges (edges & cavities: a square with highlighted edges) ·
erosion (raindrops over a slope).

**7. Status and feedback.**
check · warning · error · info · help · loading (a ring with a gap) · lock · unlock · link-broken · sync ·
cloud-off · saved · unsaved (a dot) · dirty-draft · new-badge · external — opens outside the app.

**8. The app icon (`icons/app/`).**
NoorMD's mark: "Noor" means light. A rounded square (corner radius ~22 % of the size) in violet (#7c5cff to
#9b8cff, a soft diagonal gradient), with a white symbol: a simple stylised "N" whose diagonal is a beam of light,
or a page with a small light ray. It must read at 16 px (simplify the 16–24 px versions: thicker strokes, no
gradient detail) and look at home in the Windows 11 taskbar on light and dark. No text other than the symbol.

### Checks before you finish

- Every name above is in the JSON exactly once; nothing extra unless you list it in the README.
- Each path parses, stays inside 0–24, uses only M, L, H, V, C, S, Q, A, Z (upper or lower case) commands.
- Look at `preview.html` at 16 px: no icon turns into a blob, no two icons look alike, mirror pairs match.
- The same stroke width everywhere (no icon scaled to fit).

---

## Notes for the NoorMD side (not part of the prompt)

- Where the icons go: the toolbar and menus use the path map in `src/NoorMD/wwwroot/js/chrome.js` (`const P`,
  24 × 24, stroke 1.75, `currentColor`), so the JSON can replace it name for name. The benches and panels still use
  emoji or text glyphs (`js/dock.js` `ICON`, the `glyph` in each bench header, buttons like 🎲 📌 🎧 ⟳ ◫ ☰);
  those would switch to the new set's names.
- The app icon goes to `src/NoorMD/Assets/NoorMD.ico` and `src/NoorMD/Assets/NoorMD-256.png` (the .ico is used by the window and the exe).
- Keep the emoji fallbacks until every place is switched, and check both themes and 16 px in the real app.
