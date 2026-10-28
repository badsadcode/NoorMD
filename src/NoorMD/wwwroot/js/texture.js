// NoorMD Texture Bench: tileable procedural materials for games (stone, ground, wood, metal, walls, fabric). The page
// edits a recipe; the app renders its maps (the same recipe and seed always give the same pixels) and the page shows
// them lit in 3D and as flat, tiled maps. Export writes PNG maps for a game engine with the recipe beside them.
window.NoorTexture = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);

  const LAYER_LABEL = { noise: 'Noise', ridged: 'Ridged noise', turbulence: 'Turbulence', cells: 'Cells (stones, cracks)', wood: 'Wood grain', bricks: 'Bricks', tiles: 'Tiles', hexagons: 'Hexagons', planks: 'Planks', spots: 'Spots (pebbles, rivets, craters)', weave: 'Weave', scratches: 'Scratches', image: 'Photo / picture', painted: 'Hand-painted (NoorSketch)', current: 'Height so far (mask)', curvature: 'Edges & cavities (mask)', erosion: 'Erosion (rain, crumble, wear)' };
  const NEW_LAYER = {
    noise: { scaleX: 4, scaleY: 4, octaves: 5 }, ridged: { scaleX: 3, scaleY: 3, octaves: 6 }, turbulence: { scaleX: 6, scaleY: 6, octaves: 4 },
    cells: { scaleX: 6, scaleY: 6, mode: 'cells', jitter: 1, variation: 0.3 }, wood: { scaleX: 9, scaleY: 3, octaves: 5 },
    bricks: { scaleX: 4, scaleY: 8, mortar: 0.1, bevel: 0.08, offset: 0.5, variation: 0.3 },
    tiles: { scaleX: 4, scaleY: 4, mortar: 0.08, bevel: 0.06, roundness: 0.2, tilt: 0.2, variation: 0.1 },
    hexagons: { scaleX: 7, scaleY: 8, mortar: 0.1, bevel: 0.08, tilt: 0.2, variation: 0.15 },
    planks: { scaleX: 6, scaleY: 2, mortar: 0.05, bevel: 0.05, offset: 1, tilt: 0.2, variation: 0.2, grain: 0.7 },
    spots: { scaleX: 8, scaleY: 8, size: 0.5, density: 0.8, jitter: 1, variation: 0.4, profile: 'dome' },
    weave: { scaleX: 32, scaleY: 32 },
    scratches: { scaleX: 1, scaleY: 1, count: 40, length: 0.2, width: 0.004 },
    current: { scaleX: 1, scaleY: 1, opacity: 0, low: 0.6, high: 0.7, warp: 0.3, warpScale: 8 },
    curvature: { scaleX: 2, scaleY: 1, opacity: 0, low: 0.55, high: 0.65, warp: 0.3, warpScale: 12 },
    erosion: { scaleX: 1, scaleY: 1, mode: 'rain', amount: 0.6 },
    painted: { scaleX: 1, scaleY: 1, colorAmount: 1, opacity: 0, blend: 'normal' },
    image: { scaleX: 1, scaleY: 1, seamBlend: 0.15, delight: 0.5, delightRadius: 0.25, detailFine: 0.4, detailMedium: 0.7, detailLarge: 0.5, colorAmount: 1, heightColor: null, heightColorAmount: 0, heightColorTolerance: 0.15 },
  };
  // Sliders: [key, label, min, max, step, kind]; 'int' are whole numbers, 'pct' shows 0–100.
  const SCALE = [['scaleX', 'Repeats across', 1, 128, 1, 'int'], ['scaleY', 'Repeats down', 1, 128, 1, 'int']];
  const FRACTAL = [['octaves', 'Detail (octaves)', 1, 10, 1, 'int'], ['persistence', 'Roughness of detail', 0, 1, 0.01, 'pct'], ['lacunarity', 'Detail step', 2, 4, 1, 'int']];
  const WARP = [['warp', 'Warp (swirl)', 0, 1, 0.01, 'pct'], ['warpScale', 'Warp size (repeats)', 1, 32, 1, 'int']];
  const FIELDS = {
    noise: [...SCALE, ...FRACTAL, ...WARP], ridged: [...SCALE, ...FRACTAL, ...WARP], turbulence: [...SCALE, ...FRACTAL, ...WARP],
    cells: [...SCALE, ['jitter', 'Irregular', 0, 1, 0.01, 'pct'], ['variation', 'Stones differ', 0, 1, 0.01, 'pct'], ...WARP],
    wood: [['scaleX', 'Grain lines across', 1, 64, 1, 'int'], ['scaleY', 'Waviness', 1, 16, 1, 'int'], ['octaves', 'Detail (octaves)', 1, 10, 1, 'int'], ...WARP],
    bricks: [['scaleX', 'Bricks across', 1, 64, 1, 'int'], ['scaleY', 'Rows', 1, 64, 1, 'int'], ['mortar', 'Mortar', 0, 0.5, 0.005, 'pct'], ['bevel', 'Bevel', 0, 0.5, 0.005, 'pct'],
      ['offset', 'Row offset', 0, 1, 0.01, 'pct'], ['variation', 'Bricks differ', 0, 1, 0.01, 'pct'], ...WARP],
    tiles: [['scaleX', 'Tiles across', 1, 64, 1, 'int'], ['scaleY', 'Tiles down', 1, 64, 1, 'int'], ['mortar', 'Joints', 0, 0.5, 0.005, 'pct'], ['bevel', 'Bevel', 0, 0.5, 0.005, 'pct'],
      ['roundness', 'Round corners', 0, 1, 0.01, 'pct'], ['tilt', 'Uneven (tilted tiles)', 0, 1, 0.01, 'pct'], ['variation', 'Tiles differ', 0, 1, 0.01, 'pct'], ...WARP],
    hexagons: [['scaleX', 'Across', 1, 64, 1, 'int'], ['scaleY', 'Rows (≈ 1.15 × across for even ones)', 2, 64, 2, 'int'], ['mortar', 'Joints', 0, 0.5, 0.005, 'pct'], ['bevel', 'Bevel', 0, 0.5, 0.005, 'pct'],
      ['tilt', 'Uneven (tilted)', 0, 1, 0.01, 'pct'], ['variation', 'They differ', 0, 1, 0.01, 'pct'], ...WARP],
    planks: [['scaleX', 'Boards across', 1, 64, 1, 'int'], ['scaleY', 'Boards along the tile', 1, 16, 1, 'int'], ['offset', 'Joints staggered', 0, 1, 0.01, 'pct'],
      ['mortar', 'Gaps', 0, 0.5, 0.005, 'pct'], ['bevel', 'Bevel', 0, 0.5, 0.005, 'pct'], ['grain', 'Wood grain', 0, 1, 0.01, 'pct'],
      ['tilt', 'Uneven (warped boards)', 0, 1, 0.01, 'pct'], ['variation', 'Boards differ', 0, 1, 0.01, 'pct'], ...WARP],
    spots: [['scaleX', 'Grid across', 1, 128, 1, 'int'], ['scaleY', 'Grid down', 1, 128, 1, 'int'], ['size', 'Size', 0.05, 1, 0.01, 'pct'], ['density', 'How many', 0, 1, 0.01, 'pct'],
      ['jitter', 'Scattered (0 = in rows)', 0, 1, 0.01, 'pct'], ['variation', 'Sizes differ', 0, 1, 0.01, 'pct'], ...WARP],
    erosion: [['amount', 'Amount', 0, 1, 0.01, 'pct']],
    painted: [['colorAmount', 'Its colours on the surface', 0, 1, 0.01, 'pct']],
    weave: [['scaleX', 'Threads across', 2, 128, 2, 'int'], ['scaleY', 'Threads down', 2, 128, 2, 'int'], ...WARP],
    scratches: [['count', 'How many', 0, 500, 1, 'int'], ['length', 'Length', 0.005, 1, 0.005, 'pct'], ['width', 'Width', 0.0005, 0.05, 0.0005, 'pct']],
    current: [...WARP],
    curvature: [['scaleX', 'Width of the edges', 1, 64, 1, 'int'], ...WARP],
    image: [['scaleX', 'Repeats across', 1, 16, 1, 'int'], ['scaleY', 'Repeats down', 1, 16, 1, 'int'], ['seamBlend', 'Seam blend (to tile)', 0, 0.5, 0.01, 'pct'],
      ['delight', 'Even out the light', 0, 1, 0.01, 'pct'], ['delightRadius', '…over (size of the light)', 0.02, 1, 0.01, 'pct'],
      ['detailFine', 'Height from fine detail', 0, 1, 0.01, 'pct'], ['detailMedium', 'Height from medium detail', 0, 1, 0.01, 'pct'], ['detailLarge', 'Height from large shapes', 0, 1, 0.01, 'pct'],
      ['colorAmount', 'Its colours on the surface', 0, 1, 0.01, 'pct']],
  };
  // Painting the surface, for any layer: where the layer is high.
  const PAINT = [['tintAmount', 'Tint strength', 0, 1, 0.01, 'pct'], ['roughnessShift', 'Roughness change', -1, 1, 0.01, 'spct'], ['metallicShift', 'Metallic change', -1, 1, 0.01, 'spct']];
  const SHAPE = [['opacity', 'Strength', 0, 1, 0.01, 'pct'], ['low', 'Levels: low', 0, 1, 0.01, 'pct'], ['high', 'Levels: high', 0, 1, 0.01, 'pct'], ['gamma', 'Levels: middle (gamma)', 0.1, 5, 0.01, 'num']];
  // Erosion's height is used as it comes; its levels shape where it paints.
  const EROSION_SHAPE = [['opacity', 'Strength', 0, 1, 0.01, 'pct'], ['low', 'Paints from (fainter traces)', 0, 1, 0.01, 'pct'], ['high', 'Paints fully at', 0, 1, 0.01, 'pct'], ['gamma', 'Paint: middle (gamma)', 0.1, 5, 0.01, 'num']];
  // A painting raises the relief where it is light and lowers it where it is dark (mid-grey: no change).
  const PAINTED_SHAPE = [['opacity', 'Relief from its brightness (white up, black down)', 0, 1, 0.01, 'pct']];
  const BLENDS = [['normal', 'Replace'], ['add', 'Add'], ['subtract', 'Subtract'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['max', 'Higher of the two'], ['min', 'Lower of the two']];
  const SURFACE = [['colorVariation', 'Colour variation', 0, 1, 0.01, 'pct'], ['dirt', 'Dirt in the cavities', 0, 1, 0.01, 'pct'],
    ['roughnessLow', 'Roughness, low parts', 0, 1, 0.01, 'pct'], ['roughnessHigh', 'Roughness, high parts', 0, 1, 0.01, 'pct'], ['roughnessVariation', 'Roughness variation', 0, 1, 0.01, 'pct'],
    ['metallic', 'Metallic', 0, 1, 0.01, 'pct'], ['normalStrength', 'Relief (normal strength)', 0, 20, 0.1, 'num'], ['aoStrength', 'Ambient occlusion', 0, 1, 0.01, 'pct'], ['aoRadius', 'Occlusion width', 0.002, 0.1, 0.001, 'pct']];
  const VIEWS = [['3d', '3D'], ['albedo', 'Albedo'], ['normal', 'Normal'], ['roughness', 'Roughness'], ['ao', 'AO'], ['height', 'Height'], ['metallic', 'Metallic']];
  /**
   * Lights for the preview, relative to the camera (x right, y up, z towards you). The key light can be moved
   * (Shift+drag or right-drag) or set going round; a low light from the side shows the relief best.
   */
  const LIGHTS = {
    studio: { label: 'Studio', az: 0.58, el: 0.6, key: [3.0, 2.95, 2.85], fill: [-0.8, 0.2, 0.4], fillCol: [0.7, 0.75, 0.9], sky: [0.72, 0.8, 0.95], ground: [0.22, 0.2, 0.17], amb: 0.55 },
    sun: { label: 'Sun', az: 0.9, el: 0.75, key: [4.4, 4.1, 3.6], fill: [-0.5, 0.6, 0.3], fillCol: [0.12, 0.16, 0.25], sky: [0.5, 0.66, 1.0], ground: [0.26, 0.22, 0.17], amb: 0.45 },
    side: { label: 'Low side light (shows relief)', az: 1.45, el: 0.12, key: [4.2, 4.1, 3.9], fill: [-0.8, 0.2, 0.4], fillCol: [0.03, 0.03, 0.04], sky: [0.2, 0.22, 0.26], ground: [0.08, 0.075, 0.07], amb: 0.12 },
    overcast: { label: 'Overcast (soft)', az: 0.2, el: 1.2, key: [0.9, 0.92, 0.95], fill: [-0.6, 0.5, 0.6], fillCol: [0.35, 0.36, 0.38], sky: [0.86, 0.88, 0.92], ground: [0.4, 0.39, 0.37], amb: 0.95 },
    night: { label: 'Night (rim light)', az: 2.6, el: 0.35, key: [1.6, 2.2, 3.4], fill: [0.7, -0.1, 0.6], fillCol: [0.5, 0.32, 0.18], sky: [0.05, 0.06, 0.1], ground: [0.03, 0.03, 0.03], amb: 0.2 },
  };
  /** What the 3D preview shows: the whole material, its lighting alone (grey clay: judge the normals), or one map on the shape. */
  const SHOW = [['material', 'Material'], ['clay', 'Lighting only (grey)'], ['albedo', 'Albedo'], ['normal', 'Normal'], ['roughness', 'Roughness'], ['metallic', 'Metallic'], ['ao', 'AO'], ['height', 'Height']];

  const TARGETS = [['generic', 'Generic (one PNG per map)'], ['godot', 'Godot (StandardMaterial3D)'], ['unity', 'Unity (metallic + smoothness)'], ['unreal', 'Unreal (ORM, DirectX normal)']];

  let hooks = { showError: (e) => console.error(e) };
  let built = false;
  let presets = { builtIn: [], mine: [] };
  let recipe = null;
  let tab = 'layers';
  let render = null; // { key, size, maps: { albedo: url, … }, ms }
  let renderGen = 0, fastTimer = null, fullTimer = null;
  let pinned = null, listening = 'B';
  const history = []; let future = [];
  let lastSnapshot = null, snapTimer = null;
  let view = (() => { try { return localStorage.getItem('noormd.texture.view') || '3d'; } catch { return '3d'; } })();
  let shape = 'sphere', tiling = 2;
  // How the 3D preview is lit and what it shows (only for looking: never in the recipe or the export).
  let lightsId = (() => { try { const v = localStorage.getItem('noormd.texture.lights'); return v && v in LIGHTS ? v : 'studio'; } catch { return 'studio'; } })();
  let show = 'material', depth = 0, orbit = false;
  let gl3d = null; // the 3D preview (null when WebGL2 isn't there)

  const isOpen = () => document.body.classList.contains('texture-open');
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function init(h) {
    hooks = { ...hooks, ...h };
    NoorBridge.on('texture.paintingChanged', paintingChanged);
    NoorBridge.on('texture.openRecipe', async (p) => { await open(); setRecipe(p.recipe, true); notice(`Opened “${p.recipe.name}” from the Vault`, 1600); });
    NoorBridge.on('texture.exportProgress', (p) => { const s = $('#tb-export-status'); if (s) s.textContent = `Writing map ${p.done} of ${p.total}…`; });
  }

  async function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('texture');
    document.body.classList.add('texture-open');
    $('#texturebench').hidden = false;
    if (!presets.builtIn.length) {
      try { presets = await req('texture.presets'); } catch (err) { hooks.showError(err); return; }
      renderPresets();
    }
    if (!recipe) await loadPreset(presets.builtIn[0].id);
    $('#texturebench').focus({ preventScroll: true });
    if (gl3d) gl3d.resize();
  }

  function close() {
    if (!built || !isOpen()) return;
    document.body.classList.remove('texture-open');
    $('#texturebench').hidden = true;
    if (orbit) setOrbit(false);
    if (window.NoorDock) NoorDock.closed('texture');
  }

  function toggle() { if (isOpen()) close(); else open(); }

  // ---------------------------------------------------------------- recipe, preview, history

  async function loadPreset(id) {
    try { setRecipe(await req('texture.preset', { id }), true); } catch (err) { hooks.showError(err); }
  }

  function setRecipe(r, fresh) {
    if (!fresh && recipe) pushHistory();
    recipe = r;
    if (fresh) { history.length = 0; future = []; pinned = null; listening = 'B'; }
    lastSnapshot = JSON.stringify(recipe);
    renderEditor();
    preview(512);
  }

  /** Something changed: a quick small preview at once, the full one when it settles, and an undo step. */
  function changed(rebuild) {
    listening = 'B';
    if (rebuild) renderEditor(); else renderHeader();
    clearTimeout(snapTimer);
    snapTimer = setTimeout(pushHistory, 600);
    clearTimeout(fastTimer); clearTimeout(fullTimer);
    fastTimer = setTimeout(() => preview(256), 90);
    fullTimer = setTimeout(() => preview(512), 650);
  }

  function pushHistory() {
    const now = JSON.stringify(recipe);
    if (lastSnapshot && lastSnapshot !== now) { history.push(lastSnapshot); if (history.length > 100) history.shift(); future = []; }
    lastSnapshot = now;
  }

  function undo(redo) {
    clearTimeout(snapTimer);
    pushHistory();
    const from = redo ? future : history;
    const to = redo ? history : future;
    if (!from.length) { notice(redo ? 'Nothing to redo' : 'Nothing to undo', 900); return; }
    to.push(JSON.stringify(recipe));
    recipe = JSON.parse(from.pop());
    lastSnapshot = JSON.stringify(recipe);
    renderEditor();
    preview(512);
  }

  async function preview(size) {
    const gen = ++renderGen;
    const r = listening === 'A' && pinned ? pinned.recipe : recipe;
    setStatus(size < 512 ? 'Rendering (quick)…' : 'Rendering…');
    try {
      const out = await req('texture.render', { recipe: r, size });
      if (gen !== renderGen) return;
      render = out;
      showMaps();
      setStatus(`${listening === 'A' ? 'A (pinned) · ' : ''}${out.size} × ${out.size} px preview${out.ms ? ` · ${out.ms} ms` : ''} · tiles seamlessly${out.warnings && out.warnings.length ? ' · ⚠ ' + out.warnings.join('; ') : ''}`);
    } catch (err) { if (gen === renderGen) setStatus(err && err.message ? err.message : String(err)); }
  }

  function setStatus(t) { const s = $('#tb-status'); if (s) s.textContent = t; }

  /** The rendered maps: the thumbnails, the flat tiled view and the 3D preview. */
  function showMaps() {
    if (!render) return;
    document.querySelectorAll('#tb-thumbs [data-map]').forEach((b) => { b.style.backgroundImage = `url("${render.maps[b.dataset.map]}")`; });
    const flat = $('#tb-flat');
    if (view !== '3d' && render.maps[view]) {
      flat.style.backgroundImage = `url("${render.maps[view]}")`;
      fitFlat();
    }
    if (gl3d) gl3d.setMaps(render.maps);
  }

  /**
   * The flat view's tiles stay square (the maps are): as many tiles as chosen fit the shorter side, centred, and the
   * pattern carries on across the longer side, as the material would.
   */
  function fitFlat() {
    const flat = $('#tb-flat');
    if (!flat || flat.hidden) return;
    const w = flat.clientWidth, h = flat.clientHeight;
    if (!w || !h) return;
    const t = Math.min(w, h) / tiling;
    flat.style.backgroundSize = `${t}px ${t}px`;
    flat.style.backgroundPosition = `${(w - t * tiling) / 2}px ${(h - t * tiling) / 2}px`;
  }

  function setView(v) {
    view = v;
    try { localStorage.setItem('noormd.texture.view', v); } catch { /* private storage off */ }
    const threeD = v === '3d' && !!gl3d;
    $('#tb-canvas').hidden = !threeD;
    $('#tb-flat').hidden = threeD;
    $('#tb-shape').hidden = !threeD;
    $('#tb-3dbar').hidden = !threeD;
    document.querySelectorAll('#tb-views button').forEach((b) => { b.classList.toggle('active', b.dataset.view === v); b.setAttribute('aria-pressed', String(b.dataset.view === v)); });
    if (v === '3d' && !gl3d) $('#tb-flat').dataset.note = 'The 3D preview needs WebGL 2, which is not available here: showing the albedo.';
    else delete $('#tb-flat').dataset.note;
    if (v === '3d' && !gl3d && render) { $('#tb-flat').style.backgroundImage = `url("${render.maps.albedo}")`; }
    showMaps();
    fitFlat();
    if (threeD) gl3d.resize();
  }

  // ---------------------------------------------------------------- panel

  function build() {
    built = true;
    const root = el('section', { id: 'texturebench', class: 'soundbench texbench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'Texture Bench' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '🧱' }), el('strong', { text: 'Texture Bench' }), el('small', { id: 'tb-family' })),
        el('span', { class: 'panel-head-buttons' },
          el('button', { class: 'icon-btn', id: 'tb-open', title: 'Open a recipe (.noortex.json)', 'aria-label': 'Open a recipe', onclick: openRecipe }, '📂'),
          el('button', { class: 'icon-btn', title: 'Where this panel goes', 'aria-label': 'Move the Texture Bench', onclick: (e) => NoorDock.showMenu('texture', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn', title: 'Close (Ctrl+Alt+T)', 'aria-label': 'Close the Texture Bench', onclick: close }, '✕'))),
      el('div', { class: 'sb-main' },
        el('nav', { class: 'sb-presets', id: 'tb-presets', 'aria-label': 'Materials' }),
        el('div', { class: 'sb-editor' },
          el('div', { class: 'sb-top' },
            el('input', { type: 'text', id: 'tb-name', class: 'tb-name', 'aria-label': 'Name of the material', spellcheck: 'false', maxlength: '80' }),
            el('label', { class: 'sb-seed', title: 'The random seed: the same seed gives the same material' }, el('span', { text: 'Seed' }), el('input', { type: 'number', id: 'tb-seed', min: '0', max: '2147483647', step: '1' })),
            el('button', { class: 'utility-btn', id: 'tb-vary', title: 'Another variation: same recipe, another seed (V)', onclick: newVariation }, '🎲 Variation'),
            el('button', { class: 'utility-btn', id: 'tb-pin', title: 'Keep this version as A, to compare while you change things', onclick: pin }, '📌 Pin as A'),
            el('button', { class: 'utility-btn', id: 'tb-ab', title: 'Show A (pinned) or B (now) (B)', hidden: true, onclick: flipAB }, 'A/B: B'),
            el('button', { class: 'icon-btn', id: 'tb-side', title: 'Preview and controls side by side, or one above the other', 'aria-label': 'Side by side', 'aria-pressed': 'false', onclick: () => setLayout({ side: !layoutPrefs.side }) }, '◫'),
            el('button', { class: 'icon-btn', id: 'tb-list', title: 'Show or hide the list of materials', 'aria-label': 'Materials list', 'aria-pressed': 'true', onclick: () => setLayout({ list: !layoutPrefs.list }) }, '☰')),
          el('div', { class: 'tb-split', id: 'tb-split' },
          el('div', { class: 'tb-view-col', id: 'tb-view-col' },
          el('div', { class: 'tb-views', id: 'tb-views', role: 'group', 'aria-label': 'What to show' },
            ...VIEWS.map(([v, label]) => el('button', { class: 'utility-btn', 'data-view': v, onclick: () => setView(v) }, label)),
            el('span', { class: 'sb-fx-space' }),
            (() => {
              const s = el('select', { id: 'tb-shape', 'aria-label': 'Preview shape' }, ...[['sphere', 'Sphere'], ['rounded', 'Rounded cube'], ['cube', 'Cube'], ['plane', 'Plane']].map(([v, t]) => el('option', { value: v, text: t })));
              s.addEventListener('change', () => { shape = s.value; if (gl3d) gl3d.setShape(shape); });
              return s;
            })(),
            (() => {
              const s = el('select', { id: 'tb-tiling', 'aria-label': 'Tiling' }, ...[1, 2, 3, 4].map((n) => el('option', { value: String(n), text: `${n} × ${n}` })));
              s.value = String(tiling);
              s.addEventListener('change', () => { tiling = Number(s.value); if (gl3d) gl3d.setTiling(tiling); showMaps(); setView(view); });
              return s;
            })()),
          el('div', { class: 'tb-views tb-3dbar', id: 'tb-3dbar', role: 'group', 'aria-label': '3D preview' },
            (() => {
              const s = el('select', { id: 'tb-show', 'aria-label': 'Show on the shape', title: 'What the shape shows: the whole material, its lighting alone in grey (to judge the relief and the normals), or one map' }, ...SHOW.map(([v, t]) => el('option', { value: v, text: t })));
              s.value = show;
              s.addEventListener('change', () => { show = s.value; if (gl3d) gl3d.setMode(show); });
              return s;
            })(),
            (() => {
              const s = el('select', { id: 'tb-lights', 'aria-label': 'Lighting', title: 'How the shape is lit. Shift+drag (or right-drag) on the shape moves the light' }, ...Object.entries(LIGHTS).map(([v, l]) => el('option', { value: v, text: '💡 ' + l.label })));
              s.value = lightsId;
              s.addEventListener('change', () => {
                lightsId = s.value;
                try { localStorage.setItem('noormd.texture.lights', lightsId); } catch { /* private storage off */ }
                if (gl3d) gl3d.setLights(lightsId);
              });
              return s;
            })(),
            el('button', { class: 'utility-btn', id: 'tb-orbit', 'aria-pressed': 'false', title: 'Send the light round the shape, so every slope catches it in turn', onclick: () => setOrbit(!orbit) }, '⟳ Light round'),
            el('label', { class: 'sb-inline tb-depth', title: 'Depth from the height map (parallax): the relief sinks in as you turn the shape. Only for the preview' },
              el('span', { text: 'Depth' }),
              (() => {
                const r = el('input', { type: 'range', id: 'tb-depth', min: '0', max: '100', step: '1', value: '0', 'aria-label': 'Depth from the height map' });
                r.addEventListener('input', () => { depth = Number(r.value) / 100 * 0.1; if (gl3d) gl3d.setDepth(depth); });
                return r;
              })()),
            el('span', { class: 'sb-fx-space' }),
el('span', { class: 'tb-zoom' },
            el('button', { class: 'icon-btn', id: 'tb-zoomout', title: 'Zoom out (−, or the mouse wheel)', 'aria-label': 'Zoom out', onclick: () => gl3d && gl3d.zoom(1.2) }, '−'),
            el('button', { class: 'icon-btn', id: 'tb-zoomin', title: 'Zoom in (+, or the mouse wheel)', 'aria-label': 'Zoom in', onclick: () => gl3d && gl3d.zoom(1 / 1.2) }, '+'),
            el('button', { class: 'icon-btn', id: 'tb-reset', title: 'Back to the starting view and light', 'aria-label': 'Reset the view', onclick: () => gl3d && gl3d.reset() }, '⟲'))),
          el('div', { class: 'tb-stage', id: 'tb-stage' },
            el('canvas', { id: 'tb-canvas', class: 'tb-canvas', 'aria-label': 'The material on a lit shape: drag to turn it, wheel to zoom, Shift+drag to move the light', title: 'Drag: turn · wheel: zoom · Shift+drag or right-drag: move the light', role: 'img' }),
            el('div', { id: 'tb-flat', class: 'tb-flat', role: 'img', 'aria-label': 'The map, tiled', hidden: true }),
            el('div', { class: 'tb-thumbs', id: 'tb-thumbs' }, ...VIEWS.slice(1).map(([m, label]) => el('button', { class: 'tb-thumb', 'data-map': m, title: `${label} map`, 'aria-label': `Show the ${label} map`, onclick: () => setView(m) }, el('span', { text: label }))))),
          el('p', { class: 'pref-hint sb-status', id: 'tb-status', 'aria-live': 'polite' })),
          el('div', { class: 'tb-splitter', id: 'tb-splitter', role: 'separator', tabindex: '0', 'aria-label': 'Drag to change how much room the preview and the controls get (double-click: back to normal)' }),
          el('div', { class: 'tb-edit-col', id: 'tb-edit-col' },
          el('div', { class: 'music-tabs sb-tabs', role: 'tablist' }, ...[['layers', 'Layers'], ['surface', 'Surface'], ['export', 'Export']].map(([id, label]) =>
            el('button', { role: 'tab', 'data-tab': id, class: id === tab ? 'active' : '', onclick: () => { tab = id; renderEditor(); } }, label))),
          el('div', { class: 'sb-pane', id: 'tb-pane' }))))));
    ($('#app') || document.body).append(root);
    $('#tb-name').addEventListener('input', (e) => { recipe.name = e.target.value; changed(false); });
    $('#tb-seed').addEventListener('change', (e) => { recipe.seed = Math.max(0, Math.min(2147483647, Math.round(Number(e.target.value) || 0))); changed(false); });
    new ResizeObserver(() => { root.classList.toggle('wide', root.clientWidth >= 820); fitFlat(); if (gl3d) gl3d.resize(); }).observe(root);
    root.addEventListener('keydown', (e) => {
      const typing = e.target.closest('input[type=text], input[type=number], select, textarea');
      if (e.key === 'Escape' && !typing) { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (typing) return;
      if (e.key.toLowerCase() === 'z' && e.ctrlKey) { e.preventDefault(); undo(e.shiftKey); }
      else if (e.key.toLowerCase() === 'y' && e.ctrlKey) { e.preventDefault(); undo(true); }
      else if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.altKey) { e.preventDefault(); newVariation(); }
      else if (e.key.toLowerCase() === 'b' && !e.ctrlKey && !e.altKey && pinned) { e.preventDefault(); flipAB(); }
    });
    try { gl3d = Viewer($('#tb-canvas')); gl3d.setLights(lightsId); } catch (err) { console.warn('Texture Bench: no 3D preview', err); gl3d = null; }
    setupSplitter();
    applyLayout();
    setView(view);
  }

  function setOrbit(on) {
    orbit = !!on;
    const b = $('#tb-orbit');
    b.setAttribute('aria-pressed', String(orbit)); b.classList.toggle('active', orbit);
    if (gl3d) gl3d.setOrbit(orbit);
  }

  // ---------------------------------------------------------------- layout: how much room the preview gets

  /** Side by side or stacked, the preview's share (px, per arrangement), and whether the materials list shows. Remembered. */
  let layoutPrefs = (() => { try { return { side: false, list: true, height: 0, width: 0, ...JSON.parse(localStorage.getItem('noormd.texture.layout') || '{}') }; } catch { return { side: false, list: true, height: 0, width: 0 }; } })();

  function setLayout(change) {
    layoutPrefs = { ...layoutPrefs, ...change };
    try { localStorage.setItem('noormd.texture.layout', JSON.stringify(layoutPrefs)); } catch { /* private storage off */ }
    applyLayout();
  }

  function applyLayout() {
    const root = $('#texturebench');
    if (!root) return;
    root.classList.toggle('tb-side', !!layoutPrefs.side);
    root.classList.toggle('tb-no-list', !layoutPrefs.list);
    const col = $('#tb-view-col');
    col.style.height = !layoutPrefs.side && layoutPrefs.height ? layoutPrefs.height + 'px' : '';
    col.style.width = layoutPrefs.side && layoutPrefs.width ? layoutPrefs.width + 'px' : '';
    $('#tb-side').setAttribute('aria-pressed', String(!!layoutPrefs.side));
    $('#tb-side').classList.toggle('on', !!layoutPrefs.side);
    $('#tb-list').setAttribute('aria-pressed', String(!!layoutPrefs.list));
    const sp = $('#tb-splitter');
    sp.setAttribute('aria-orientation', layoutPrefs.side ? 'vertical' : 'horizontal');
    fitFlat();
    if (gl3d) gl3d.resize();
  }

  /** Dragging (or arrow keys on) the bar between the preview and the controls. */
  function setupSplitter() {
    const sp = $('#tb-splitter'), split = $('#tb-split'), col = $('#tb-view-col');
    const limit = (v) => {
      const box = split.getBoundingClientRect();
      const total = layoutPrefs.side ? box.width : box.height;
      return Math.round(Math.max(layoutPrefs.side ? 240 : 150, Math.min(total - (layoutPrefs.side ? 300 : 140), v)));
    };
    const set = (v) => setLayout(layoutPrefs.side ? { width: limit(v) } : { height: limit(v) });
    let drag = null;
    sp.addEventListener('pointerdown', (e) => {
      e.preventDefault(); sp.setPointerCapture(e.pointerId);
      const r = col.getBoundingClientRect();
      drag = { start: layoutPrefs.side ? e.clientX : e.clientY, size: layoutPrefs.side ? r.width : r.height };
      sp.classList.add('dragging');
    });
    sp.addEventListener('pointermove', (e) => { if (drag) set(drag.size + (layoutPrefs.side ? e.clientX : e.clientY) - drag.start); });
    const end = () => { drag = null; sp.classList.remove('dragging'); };
    sp.addEventListener('pointerup', end); sp.addEventListener('pointercancel', end);
    sp.addEventListener('dblclick', () => setLayout(layoutPrefs.side ? { width: 0 } : { height: 0 }));
    sp.addEventListener('keydown', (e) => {
      const step = { ArrowUp: -24, ArrowLeft: -24, ArrowDown: 24, ArrowRight: 24 }[e.key];
      if (!step) return;
      e.preventDefault();
      const r = col.getBoundingClientRect();
      set((layoutPrefs.side ? r.width : r.height) + step);
    });
    new ResizeObserver(() => { fitFlat(); if (gl3d) gl3d.resize(); }).observe($('#tb-stage'));
  }

  function renderPresets() {
    const nav = $('#tb-presets');
    const groups = new Map();
    for (const p of presets.builtIn) { if (!groups.has(p.family)) groups.set(p.family, []); groups.get(p.family).push(p); }
    const item = (p) => el('button', { class: 'gnav-item' + (recipe && recipe.name === p.name ? ' active' : ''), 'data-preset': p.id, title: p.description, onclick: () => loadPreset(p.id) },
      el('span', { text: p.name }), ...(p.id.startsWith('user:') ? [el('span', { class: 'icon-btn', role: 'button', title: 'Delete this preset', onclick: (e) => { e.stopPropagation(); deletePreset(p); } }, '✕')] : []));
    nav.replaceChildren(
      el('div', { class: 'tb-start' },
        el('button', { class: 'utility-btn', id: 'tb-new', title: 'Start from scratch: one noise layer on a plain grey surface; add layers, shapes and photos from there', onclick: newMaterial }, '＋ New material'),
        el('button', { class: 'utility-btn', id: 'tb-random', title: 'A random stack of layers and colours to start from (press again for another)', onclick: randomMaterial }, '🎲 Random')),
      ...[...groups].flatMap(([family, list]) => [el('div', { class: 'gnav-head', text: family }), ...list.map(item)]),
      el('div', { class: 'gnav-head', text: 'My presets' }),
      ...(presets.mine.length ? presets.mine.map(item) : [el('p', { class: 'pref-hint', text: 'Save a material you like with “Save as my preset”.' })]));
  }

  // ---------------------------------------------------------------- from scratch

  /** A plain grey surface: the colours, relief and shine are yours to set. */
  const PLAIN_SURFACE = { ramp: [{ pos: 0, color: '#3c3c3c' }, { pos: 1, color: '#c4c4c4' }], colorVariation: 0, dirt: 0.2, roughnessLow: 0.9, roughnessHigh: 0.6,
    roughnessVariation: 0.05, metallic: 0, normalStrength: 4, aoStrength: 0.5, aoRadius: 0.02 };

  function newMaterial() {
    setRecipe({ version: 1, name: 'New material', family: 'Custom', seed: 1 + Math.floor(Math.random() * 99999), layers: [layerOf('noise', 0, { name: 'Base' })], surface: clone(PLAIN_SURFACE) }, true);
    tab = 'layers'; renderEditor();
    notice('A new material: one noise layer to start. Add layers below; the Surface tab sets colours and shine.', 2600);
  }

  /** A random starting point: 2–4 layers of any kind, blended in different ways, with colours that go together. */
  function randomMaterial() {
    let a = (Math.random() * 2 ** 31) >>> 0;
    const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
    const num = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
    const base = {
      noise: () => ({ scaleX: int(2, 8), scaleY: int(2, 8), octaves: int(3, 7) }), ridged: () => ({ scaleX: int(2, 6), scaleY: int(2, 6), octaves: int(4, 7) }),
      cells: () => ({ scaleX: int(3, 10), scaleY: int(3, 10), mode: pick(['cells', 'edges', 'cracks', 'stones']), jitter: num(0.5, 1), variation: num(0.1, 0.5) }),
      bricks: () => ({ scaleX: int(2, 8), scaleY: 2 * int(2, 8), mortar: num(0.05, 0.2), bevel: num(0.03, 0.15), offset: pick([0.5, 0.25, 0.33]), variation: num(0.1, 0.4) }),
      tiles: () => ({ scaleX: int(2, 8), scaleY: int(2, 8), mortar: num(0.04, 0.15), bevel: num(0.03, 0.12), roundness: num(0, 0.5), tilt: num(0, 0.4), variation: num(0, 0.3) }),
      hexagons: () => { const x = int(4, 10); return { scaleX: x, scaleY: 2 * Math.round(x * 1.155 / 2), mortar: num(0.05, 0.15), bevel: num(0.03, 0.12), tilt: num(0, 0.3), variation: num(0, 0.3) }; },
      planks: () => ({ scaleX: int(3, 10), scaleY: int(1, 4), mortar: num(0.02, 0.08), bevel: num(0.02, 0.08), offset: num(0.5, 1), tilt: num(0, 0.3), variation: num(0.1, 0.3), grain: num(0.4, 1) }),
      wood: () => ({ scaleX: int(4, 16), scaleY: int(1, 5), octaves: int(3, 6) }),
      weave: () => ({ scaleX: 2 * int(6, 24), scaleY: 2 * int(6, 24) }),
      spots: () => ({ scaleX: int(4, 16), scaleY: int(4, 16), size: num(0.3, 0.9), density: num(0.4, 1), jitter: num(0, 1), variation: num(0, 0.6), profile: pick(['dome', 'dome', 'flat', 'crater', 'cone']) }),
    };
    const detail = {
      noise: () => ({ scaleX: int(8, 32), scaleY: int(8, 32), octaves: int(3, 5) }), turbulence: () => ({ scaleX: int(4, 16), scaleY: int(4, 16), octaves: int(3, 5) }),
      ridged: () => ({ scaleX: int(4, 12), scaleY: int(4, 12), octaves: int(3, 6) }), cells: () => ({ scaleX: int(6, 20), scaleY: int(6, 20), mode: pick(['cracks', 'edges']), jitter: 1 }),
      scratches: () => ({ count: int(20, 120), length: num(0.05, 0.3), width: num(0.001, 0.004) }), spots: () => ({ scaleX: int(10, 32), scaleY: int(10, 32), size: num(0.2, 0.6), density: num(0.2, 0.7), jitter: 1, variation: 0.5 }),
    };
    const first = pick(Object.keys(base));
    const layers = [layerOf(first, 0, { ...base[first](), warp: rnd() < 0.4 ? num(0.1, 0.5) : 0 })];
    for (let i = 1, n = int(1, 3); i <= n; i++) {
      const t = pick(Object.keys(detail));
      layers.push(layerOf(t, i, { ...detail[t](), blend: pick(['overlay', 'multiply', 'add', 'subtract', 'max', 'screen']), opacity: num(0.2, 0.6) }));
    }
    if (rnd() < 0.3) layers.push(layerOf('erosion', layers.length, { mode: pick(['rain', 'crumble', 'wear']), amount: num(0.3, 0.8), blend: 'normal', opacity: 1, tint: null }));
    // Colours that go together: one hue, from dark to light, with a touch of a neighbouring hue at the top.
    const hue = rnd() * 360, sat = num(0.1, 0.6), hex = (h, s2, l) => {
      const f = (n) => { const k = (n + h / 30) % 12, c = s2 * Math.min(l, 1 - l); return Math.round(255 * (l - c * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
      return '#' + f(0) + f(8) + f(4);
    };
    const metal = rnd() < 0.15;
    const surface = { ramp: [{ pos: 0, color: hex(hue, sat, 0.12) }, { pos: 0.5, color: hex(hue, sat, 0.38) }, { pos: 1, color: hex((hue + num(-30, 30) + 360) % 360, sat * 0.8, 0.68) }],
      colorVariation: num(0, 0.4), dirt: num(0.1, 0.6), roughnessLow: num(0.6, 1), roughnessHigh: metal ? num(0.2, 0.5) : num(0.4, 0.9), roughnessVariation: num(0, 0.2),
      metallic: metal ? 1 : 0, normalStrength: num(3, 9), aoStrength: num(0.4, 0.8), aoRadius: num(0.01, 0.04) };
    setRecipe({ version: 1, name: 'Random material', family: 'Custom', seed: 1 + Math.floor(rnd() * 99999), layers, surface }, true);
    notice(`A random start: ${layers.map((l) => LAYER_LABEL[l.type].replace(/ \(.*/, '').toLowerCase()).join(' + ')}. 🎲 again for another.`, 2600);
  }

  function renderHeader() {
    if (!recipe) return;
    $('#tb-family').textContent = recipe.family || '';
    if (document.activeElement !== $('#tb-name')) $('#tb-name').value = recipe.name;
    $('#tb-seed').value = String(recipe.seed);
    const ab = $('#tb-ab');
    ab.hidden = !pinned;
    ab.textContent = `A/B: ${listening}`;
    ab.classList.toggle('on', listening === 'A');
  }

  function renderEditor() {
    if (!built || !recipe) return;
    renderHeader();
    document.querySelectorAll('#texturebench .sb-tabs button').forEach((b) => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    const pane = $('#tb-pane');
    const keep = pane.scrollTop;
    pane.replaceChildren(...(tab === 'layers' ? layersPane() : tab === 'surface' ? surfacePane() : exportPane()));
    pane.scrollTop = keep;
    document.querySelectorAll('#tb-presets .gnav-item').forEach((b) => b.classList.toggle('active', b.textContent.startsWith(recipe.name)));
  }

  const UNIT = { pct: ['%', 100], spct: ['%', 100], int: ['', 1], num: ['', 1] };

  /** A slider bound to obj[key], with a number box beside it for an exact value. */
  function slider(obj, [key, label, min, max, step, kind]) {
    const [unit, factor] = UNIT[kind] || ['', 1];
    const clamp = (v) => Math.max(min, Math.min(max, v));
    const shown = (v) => String(Number((v * factor).toFixed(kind === 'int' ? 0 : 2)));
    const value = Number(obj[key]) || 0;
    const box = el('input', { type: 'number', class: 'sb-num', value: shown(value), step: 'any', 'aria-label': `${label}${unit ? ` (${unit})` : ''}`, 'data-num': key });
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(clamp(value)), 'aria-label': label, 'data-key': key });
    const set = (v) => { obj[key] = kind === 'int' ? Math.round(v / step) * step : Number(v.toFixed(5)); };
    input.addEventListener('input', () => { set(Number(input.value)); box.value = shown(obj[key]); changed(false); });
    box.addEventListener('change', () => {
      const typed = Number(box.value);
      if (!Number.isFinite(typed)) { box.value = shown(obj[key]); return; }
      set(clamp(typed / factor));
      box.value = shown(obj[key]); input.value = String(obj[key]);
      changed(false);
    });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.dispatchEvent(new Event('change')); } });
    return el('label', { class: 'sb-slider' }, el('span', { text: label }), input, el('span', { class: 'sb-numwrap' }, box, unit ? el('small', { text: unit }) : null));
  }

  // ---------------------------------------------------------------- layers

  function layersPane() {
    const cards = recipe.layers.map((l, i) => {
      const name = el('input', { type: 'text', value: l.name, 'aria-label': 'Layer name', spellcheck: 'false', maxlength: '40' });
      name.addEventListener('input', () => { l.name = name.value; changed(false); });
      const blend = el('select', { 'aria-label': 'Blend with the layers below', 'data-key': 'blend' }, ...BLENDS.map(([v, t]) => el('option', { value: v, text: t })));
      blend.value = l.blend || 'normal';
      blend.addEventListener('change', () => { l.blend = blend.value; changed(false); });
      const invert = el('input', { type: 'checkbox', checked: l.invert || undefined, 'data-key': 'invert' });
      invert.addEventListener('change', () => { l.invert = invert.checked; changed(false); });
      const move = (d) => { const j = i + d; if (j < 0 || j >= recipe.layers.length) return; [recipe.layers[i], recipe.layers[j]] = [recipe.layers[j], recipe.layers[i]]; changed(true); };
      // A painting goes on as painted: no blend mode or invert.
      const choices = l.type === 'painted' ? [] : [el('label', { class: 'sb-inline' }, el('span', { text: 'Blend' }), blend), el('label', { class: 'sb-inline' }, invert, el('span', { text: 'Invert' }))];
      if (l.type === 'image') {
        choices.unshift(el('span', { class: 'sb-file', title: l.path || '', text: '🖼 ' + (l.imageName || 'no picture') }),
          el('button', { class: 'utility-btn', 'data-pickimage': '', onclick: async () => { const f = await pickImage(); if (f) { Object.assign(l, { path: f.path, imageName: f.name, ...keepProportions(f) }); changed(true); } } }, 'Change picture…'));
      }
      if (l.type === 'painted') {
        choices.unshift(el('span', { class: 'sb-file', title: l.path || '', text: '🖌 ' + (l.imageName || 'no painting') }),
          el('button', { class: 'utility-btn', 'data-paint': '', title: 'Open it in NoorSketch with the material underneath; Ctrl+S there applies it here', onclick: () => paintIn(l) }, '✏ Paint in NoorSketch'));
      }
      if (l.type === 'spots') {
        const prof = el('select', { 'aria-label': 'Spots as', 'data-key': 'profile' }, ...[['dome', 'domes (pebbles, studs)'], ['flat', 'flat (rivets, coins)'], ['crater', 'craters'], ['cone', 'cones']].map(([v, t]) => el('option', { value: v, text: t })));
        prof.value = l.profile || 'dome';
        prof.addEventListener('change', () => { l.profile = prof.value; changed(false); });
        choices.unshift(el('label', { class: 'sb-inline' }, el('span', { text: 'As' }), prof));
      }
      if (l.type === 'erosion') {
        const kind = el('select', { 'aria-label': 'Erosion by', 'data-key': 'mode' }, ...[['rain', 'rain (gullies down the slopes)'], ['crumble', 'crumbling (steep parts slide down)'], ['wear', 'wear (edges worn round)']].map(([v, t]) => el('option', { value: v, text: t })));
        kind.value = l.mode || 'rain';
        kind.addEventListener('change', () => { l.mode = kind.value; changed(false); });
        choices.unshift(el('label', { class: 'sb-inline' }, el('span', { text: 'By' }), kind));
      }
      if (l.type === 'cells') {
        const mode = el('select', { 'aria-label': 'Cells as', 'data-key': 'mode' }, ...[['cells', 'round bumps'], ['edges', 'raised edges'], ['cracks', 'cracks'], ['stones', 'flat stones']].map(([v, t]) => el('option', { value: v, text: t })));
        mode.value = l.mode || 'cells';
        mode.addEventListener('change', () => { l.mode = mode.value; changed(false); });
        choices.unshift(el('label', { class: 'sb-inline' }, el('span', { text: 'As' }), mode));
      }
      return el('section', { class: 'sb-layer' + (l.mute ? ' muted' : ''), 'data-index': String(i), 'data-layer': l.id || '' },
        el('div', { class: 'sb-layer-head' },
          el('span', { class: 'sb-type', text: LAYER_LABEL[l.type] || l.type }), name,
          el('button', { class: 'icon-btn sb-ms' + (l.mute ? ' on' : ''), title: 'Hide this layer', 'aria-pressed': String(!!l.mute), onclick: () => { l.mute = !l.mute; changed(true); } }, 'M'),
          el('button', { class: 'icon-btn', title: 'Another random version of this layer only', 'aria-label': 'Reseed this layer', onclick: () => { l.seedShift = Math.floor(Math.random() * 99999); changed(false); } }, '🎲'),
          el('button', { class: 'icon-btn', title: 'Up (applied earlier)', 'aria-label': 'Move up', disabled: i === 0 || undefined, onclick: () => move(-1) }, '↑'),
          el('button', { class: 'icon-btn', title: 'Down (applied later)', 'aria-label': 'Move down', disabled: i === recipe.layers.length - 1 || undefined, onclick: () => move(1) }, '↓'),
          el('button', { class: 'icon-btn', title: 'Copy this layer', 'aria-label': 'Copy this layer', onclick: () => { recipe.layers.splice(i + 1, 0, { ...clone(l), id: '', name: l.name + ' copy' }); changed(true); } }, '⧉'),
          el('button', { class: 'icon-btn', title: 'Remove this layer', 'aria-label': 'Remove this layer', onclick: () => { recipe.layers.splice(i, 1); changed(true); } }, '✕')),
        el('div', { class: 'sb-choices' }, ...choices),
        el('div', { class: 'sb-fields' }, ...(FIELDS[l.type] || []).map((f) => slider(l, f)), ...(l.type === 'erosion' ? EROSION_SHAPE : l.type === 'painted' ? PAINTED_SHAPE : SHAPE).map((f) => slider(l, f))),
        ...(l.type === 'image' ? [heightByColour(l)] : []),
        paintGroup(l));
    });
    return [
      el('p', { class: 'pref-hint', text: 'Layers build the height of the material, from the first down: each is blended onto the ones before it, and any layer can also paint the surface where it is high (tint, roughness, metal). The masks see the height made by the layers above them: tops for snow, dips for moss and puddles, edges for wear. Erosion reshapes the height made above it: rain cuts gullies, steep parts crumble, edges wear round. The Surface tab sets the base colour, relief and shine.' }),
      ...cards,
      el('div', { class: 'sb-row' }, el('span', { text: 'Add:' }), ...Object.keys(NEW_LAYER).map((t) => el('button', { class: 'utility-btn', 'data-addlayer': t, disabled: recipe.layers.length >= 12 || undefined, onclick: () => {
        const add = (extra) => { recipe.layers.push(layerOf(t, recipe.layers.length, extra)); changed(true); };
        // A picture is asked for first; it then replaces what is below it (its own colours and height).
        if (t === 'image') { pickImage().then((f) => { if (f) add({ path: f.path, imageName: f.name, name: f.name.replace(/\.[^.]+$/, ''), blend: 'normal', opacity: 1, ...keepProportions(f) }); }); return; }
        // Masks paint rather than build height: they start with a tint to show where they are.
        if (t === 'current' || t === 'curvature') { add({ opacity: 0, blend: 'normal', tint: t === 'current' ? '#eef3f8' : '#c9c2b4', tintAmount: 0.8 }); return; }
        // Erosion reshapes what is already there: it replaces it, and marks where the water ran.
        if (t === 'erosion') { add({ opacity: 1, blend: 'normal', tint: '#3b2c20', tintAmount: 0.5 }); return; }
        // A painting starts empty and opens in NoorSketch, the material underneath.
        if (t === 'painted') {
          req('texture.paint.new', { recipe }).then((r) => { if (r && r.path) add({ path: r.path, imageName: r.name, name: 'Painting' }); }).catch(hooks.showError);
          return;
        }
        add({});
      } }, '＋ ' + LAYER_LABEL[t].replace(/ \(.*/, '')))),
    ];
  }

  /** A new layer of type t, as the index-th layer: blended over the others (the first replaces), with its defaults. */
  function layerOf(t, index, extra) {
    return { name: LAYER_LABEL[t].replace(/ \(.*/, '').replace(/ \/.*/, ''), type: t, octaves: 5, persistence: 0.5, lacunarity: 2, warp: 0, warpScale: 3, low: 0, high: 1, gamma: 1, invert: false,
      blend: index ? 'overlay' : 'normal', opacity: index ? 0.5 : 1, seedShift: index * 11, mute: false,
      tint: null, tintAmount: 0, roughnessShift: 0, metallicShift: 0, ...clone(NEW_LAYER[t]), ...extra };
  }

  /** A plain surface for a material made from photos: their own colours, a little dirt and relief. */
  const PHOTO_SURFACE = { ramp: [{ pos: 0, color: '#3a3a3a' }, { pos: 1, color: '#bdbdbd' }], colorVariation: 0, dirt: 0.2, roughnessLow: 0.9, roughnessHigh: 0.7,
    roughnessVariation: 0.05, metallic: 0, normalStrength: 6, aoStrength: 0.6, aoRadius: 0.02 };

  /**
   * Pictures from the Gallery as photo layers: a new material from them (the first one as its base, the others over
   * it), or added over the material you are making. A layer is a starting point: everything stays editable.
   */
  async function fromPictures(pics, mode) {
    if (!pics || !pics.length) return;
    await open();
    const photo = (f, i, base) => layerOf('image', i, { path: f.path, imageName: f.name, name: f.name.replace(/\.[^.]+$/, ''), ...(base ? { blend: 'normal', opacity: 1 } : {}), ...keepProportions(f) });
    if (mode === 'new' || !recipe) {
      const list = pics.slice(0, 12);
      setRecipe({ version: 1, name: list[0].name.replace(/\.[^.]+$/, ''), family: 'Custom', seed: 1, layers: list.map((f, i) => photo(f, i, i === 0)), surface: clone(PHOTO_SURFACE) }, true);
      notice(list.length === 1 ? 'A new material from the picture' : `A new material from ${list.length} pictures`, 1800);
      return;
    }
    const room = 12 - recipe.layers.length;
    if (room <= 0) { notice('This material already has 12 layers: remove one first.', 2400); return; }
    pics.slice(0, room).forEach((f) => recipe.layers.push(photo(f, recipe.layers.length, false)));
    changed(true);
    notice(pics.length > room ? `Added ${room} of the ${pics.length} pictures (a material has at most 12 layers)` : `Added ${pics.length === 1 ? 'the picture' : `${pics.length} pictures`} over the material`, 2200);
  }

  /** A colour of the picture that should be high (or low): picked with the eyedropper, or chosen. */
  function heightByColour(l) {
    const on = el('input', { type: 'checkbox', checked: l.heightColor ? true : undefined, 'data-key': 'useHeightColor' });
    const color = el('input', { type: 'color', value: l.heightColor || '#808080', 'aria-label': 'The colour', 'data-key': 'heightColor', disabled: l.heightColor ? undefined : true });
    on.addEventListener('change', () => { l.heightColor = on.checked ? color.value : null; if (on.checked && !l.heightColorAmount) l.heightColorAmount = -0.6; changed(true); });
    color.addEventListener('input', () => { if (l.heightColor) { l.heightColor = color.value; changed(false); } });
    const dropper = window.EyeDropper ? el('button', { class: 'utility-btn', title: 'Pick the colour from anywhere on screen (the flat map view shows the picture)', onclick: async () => {
      try { const r = await new window.EyeDropper().open(); l.heightColor = r.sRGBHex.slice(0, 7).toLowerCase(); if (!l.heightColorAmount) l.heightColorAmount = -0.6; changed(true); } catch { /* cancelled */ }
    } }, '💧 Pick') : null;
    return el('details', { class: 'sb-fxgroup', open: l.heightColor ? true : undefined },
      el('summary', { text: 'Height by colour (this colour is high or low)' }),
      el('div', { class: 'sb-choices' }, el('label', { class: 'sb-inline' }, on, el('span', { text: 'Use a colour' })), color, ...(dropper ? [dropper] : [])),
      ...(l.heightColor ? [el('div', { class: 'sb-fields' },
        slider(l, ['heightColorAmount', 'Low ↔ high', -1, 1, 0.01, 'spct']), slider(l, ['heightColorTolerance', 'How alike counts', 0.02, 1, 0.01, 'pct']))] : []));
  }

  /** Painting the surface where this layer is high: a tint, roughness and metallic (for any layer, with or without height). */
  function paintGroup(l) {
    const on = el('input', { type: 'checkbox', checked: l.tint ? true : undefined, 'data-key': 'useTint' });
    const color = el('input', { type: 'color', value: l.tint || '#4f7a2b', 'aria-label': 'Tint colour', 'data-key': 'tint', disabled: l.tint ? undefined : true });
    on.addEventListener('change', () => { l.tint = on.checked ? color.value : null; if (on.checked && !l.tintAmount) l.tintAmount = 0.8; changed(true); });
    color.addEventListener('input', () => { if (l.tint) { l.tint = color.value; changed(false); } });
    const active = !!l.tint || !!l.roughnessShift || !!l.metallicShift;
    return el('details', { class: 'sb-fxgroup', open: active || undefined },
      el('summary', { text: `${l.type === 'erosion' ? 'Paint the surface where it acted' : l.type === 'painted' ? 'Tint, roughness and metal where it is painted' : 'Paint the surface where this is high'}${active ? ' (on)' : ''}` }),
      el('p', { class: 'pref-hint', text: l.type === 'erosion'
        ? 'Where the water ran (silt, wet streaks), where the rubble settled, or where the edges wore (lighter, bare). Set Strength to 0 above to paint without changing the height.'
        : 'Moss on the tops of stones, wet patches in the dips, rust that is no longer metal. Set Strength to 0 above to paint without changing the height.' }),
      el('div', { class: 'sb-choices' }, el('label', { class: 'sb-inline' }, on, el('span', { text: 'Tint' })), color),
      el('div', { class: 'sb-fields' }, ...PAINT.map((f) => slider(l, f))));
  }

  // ---------------------------------------------------------------- surface

  function surfacePane() {
    const s = recipe.surface;
    const bar = el('div', { class: 'tb-ramp', id: 'tb-ramp', 'aria-hidden': 'true' });
    const paintBar = () => { bar.style.background = `linear-gradient(to right, ${s.ramp.map((r) => `${r.color} ${Math.round(r.pos * 100)}%`).join(', ')})`; };
    paintBar();
    const stops = s.ramp.map((r, i) => {
      const color = el('input', { type: 'color', value: r.color, 'aria-label': `Colour ${i + 1}`, 'data-stop': String(i) });
      color.addEventListener('input', () => { r.color = color.value; paintBar(); changed(false); });
      const pos = slider(r, ['pos', `At height`, 0, 1, 0.01, 'pct']);
      return el('div', { class: 'tb-stop' }, color, pos,
        el('button', { class: 'icon-btn', title: 'Remove this colour', 'aria-label': 'Remove this colour', disabled: s.ramp.length <= 1 || undefined, onclick: () => { s.ramp.splice(i, 1); changed(true); } }, '✕'));
    });
    return [
      el('h4', { class: 'music-subhead', text: 'Colour along the height (low → high)' }),
      bar,
      ...stops,
      el('div', { class: 'sb-row' },
        el('button', { class: 'utility-btn', id: 'tb-addstop', disabled: s.ramp.length >= 16 || undefined, onclick: () => {
          const last = s.ramp[s.ramp.length - 1];
          s.ramp.push({ pos: Math.min(1, (last ? last.pos : 0.5) + 0.1), color: last ? last.color : '#808080' });
          changed(true);
        } }, '＋ Colour'),
        el('button', { class: 'utility-btn', onclick: () => { s.ramp.sort((a, b) => a.pos - b.pos); changed(true); } }, 'Sort by height')),
      el('h4', { class: 'music-subhead', text: 'Surface' }),
      el('div', { class: 'sb-fields' }, ...SURFACE.map((f) => slider(s, f))),
      el('p', { class: 'pref-hint', text: 'Metallic is set here, never guessed: a metal is 100 %, stone, wood and paint 0 %. Roughness 0 % is a mirror, 100 % fully matte.' }),
    ];
  }

  // ---------------------------------------------------------------- painting in NoorSketch

  /** Opens a painting layer in NoorSketch, with the material as it is without it shown underneath. */
  async function paintIn(l) {
    const under = clone(recipe);
    const mine = under.layers.find((x) => x.id === l.id && x.path === l.path);
    if (mine) mine.mute = true;
    try { await req('texture.paint.edit', { recipe: under, path: l.path }); notice('Opening NoorSketch… Ctrl+S there applies the painting here.', 2200); }
    catch (err) { hooks.showError(err); }
  }

  /** A painting was applied in NoorSketch: the material renders again with it (its file's time is part of the render). */
  function paintingChanged(p) {
    if (!recipe || !recipe.layers.some((l) => l.type === 'painted' && l.path === p.path)) return;
    notice('Painting applied', 1000);
    preview(512);
  }

  // ---------------------------------------------------------------- export

  function exportPrefs() { try { return { size: 1024, target: 'generic', ...JSON.parse(localStorage.getItem('noormd.texture.export') || '{}') }; } catch { return { size: 1024, target: 'generic' }; } }
  function saveExportPrefs(p) { try { localStorage.setItem('noormd.texture.export', JSON.stringify(p)); } catch { /* private storage off */ } }

  function exportPane() {
    const prefs = exportPrefs();
    const sel = (id, label, options, value, key, num) => {
      const s = el('select', { id, 'aria-label': label }, ...options.map(([v, t]) => el('option', { value: String(v), text: t })));
      s.value = String(value);
      s.addEventListener('change', () => { saveExportPrefs({ ...exportPrefs(), [key]: num ? Number(s.value) : s.value }); where.refresh(); });
      return el('label', { class: 'sb-inline' }, el('span', { text: label }), s);
    };
    where = NoorExportWhere.panel('texture', () => ({ name: recipe.name, family: recipe.family || '', size: exportPrefs().size, target: exportPrefs().target }), hooks.showError);
    const check = (id, label, title, key) => {
      const c = el('input', { type: 'checkbox', id, checked: prefs[key] ? true : undefined });
      c.addEventListener('change', () => saveExportPrefs({ ...exportPrefs(), [key]: c.checked }));
      return el('label', { class: 'sb-inline', title }, c, el('span', { text: label }));
    };
    return [
      el('div', { class: 'sb-row' },
        sel('tb-size', 'Size', [512, 1024, 2048, 4096].map((n) => [n, `${n} × ${n}`]), prefs.size, 'size', true),
        sel('tb-target', 'For', TARGETS, prefs.target, 'target', false)),
      where.node,
      el('div', { class: 'sb-row' },
        check('tb-to-gallery', 'Show them in the Gallery', 'Adds the folder to the Gallery (if no Gallery folder holds it yet) and tags the maps “material” and with its name', 'gallery'),
        check('tb-to-vault', 'Keep the recipe in the Vault', 'Copies the recipe (with its paintings) and a small picture to the open Vault’s Materials folder; open it from there later', 'vault')),
      el('div', { class: 'sb-row' },
        el('button', { class: 'action primary', id: 'tb-export', onclick: exportMaps }, '⤓ Export PNG maps…'),
        el('button', { class: 'action', id: 'tb-save', onclick: savePreset }, '★ Save as my preset…')),
      el('p', { class: 'pref-hint', id: 'tb-export-status', text: 'Every map tiles seamlessly at any size. The recipe (.noortex.json) is saved with the maps: open it later to make another size or change it. Height is 16-bit; Unreal gets DirectX normals and an ORM map (occlusion, roughness, metallic).' }),
    ];
  }

  // ---------------------------------------------------------------- actions

  function newVariation() { if (!recipe) return; recipe.seed = (recipe.seed + 1) % 2147483647; changed(false); }

  function pin() {
    if (!recipe) return;
    pinned = { recipe: clone(recipe) };
    listening = 'B';
    renderHeader();
    notice('Pinned as A. Change things, then press B (or A/B) to compare.', 2200);
  }

  function flipAB() {
    if (!pinned) return;
    listening = listening === 'A' ? 'B' : 'A';
    renderHeader();
    preview(512);
  }

  let where = null; // where exports go (the Export tab)

  async function exportMaps() {
    const p = exportPrefs();
    const status = $('#tb-export-status');
    try {
      const r = await req('texture.export', { recipe, size: p.size, target: p.target, gallery: !!p.gallery, vault: !!p.vault, ...(where ? where.payload() : {}) });
      if (!r || r.cancelled) return;
      if (status) {
        const more = [r.paintings ? `${r.paintings === 1 ? 'Its painting went' : `Its ${r.paintings} paintings went`} along.` : '',
          r.gallery != null ? `In the Gallery, tagged “material”.` : '', r.vault ? `Recipe kept in the Vault: ${r.vault}.` : '', ...(r.notes || [])].filter(Boolean).join(' ');
        const into = r.project ? `${r.project}: ${r.relative && r.relative !== '.' ? r.relative : 'its folder'}` : r.folder;
        status.replaceChildren(el('span', { text: `Saved ${r.files.length} maps and the recipe in ${into}. ${more} ` }),
          el('button', { class: 'utility-btn', id: 'tb-reveal', onclick: () => req('texture.reveal', { folder: r.folder }).catch(hooks.showError) }, '📁 Open the folder'));
      }
      notice(`Exported ${r.files.join(', ')}`, 2600);
    } catch (err) { hooks.showError(err); }
  }

  async function savePreset() {
    const name = await NoorUI.prompt('Save as my preset', 'Name of the preset:', recipe.name, { okLabel: 'Save' });
    if (!name || !name.trim()) return;
    try {
      const r = await req('texture.save', { recipe: { ...recipe, name: name.trim() } });
      presets.mine = r.mine;
      recipe.name = name.trim();
      renderPresets(); renderHeader();
      notice(r.replaced ? 'Preset updated' : 'Saved to My presets', 1500);
    } catch (err) { hooks.showError(err); }
  }

  async function deletePreset(p) {
    if (!await NoorUI.confirm(`Delete “${p.name}”?`, 'Only the preset is deleted; maps you exported stay.', 'Delete')) return;
    try { presets.mine = (await req('texture.delete', { id: p.id })).mine; renderPresets(); } catch (err) { hooks.showError(err); }
  }

  /**
   * Whole-number repeats (to tile) that keep a picture's proportions as near as they can: a 900 × 640 photo becomes
   * 2 across × 3 down (its pieces 1.5 times as wide as tall, against 1.41). Changed by hand afterwards as you like.
   */
  function keepProportions(f) {
    const aspect = f.width && f.height ? f.width / f.height : 1;
    let best = { scaleX: 1, scaleY: 1 }, err = Infinity;
    for (let x = 1; x <= 6; x++) for (let y = 1; y <= 6; y++) {
      const e = Math.abs(Math.log((y / x) / aspect)) + (x + y) * 0.01; // prefer few repeats when it's close either way
      if (e < err) { err = e; best = { scaleX: x, scaleY: y }; }
    }
    return best;
  }

  async function pickImage() {
    try { const f = await req('texture.image.pick'); return f && !f.cancelled ? f : null; } catch (err) { hooks.showError(err); return null; }
  }

  async function openRecipe() {
    try {
      const r = await req('texture.open');
      if (!r || r.cancelled) return;
      setRecipe(r.recipe, true);
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- 3D preview (WebGL 2)

  /**
   * A lit shape wearing the maps: albedo, normal (tangent space, OpenGL), roughness, metallic, AO and height (as
   * parallax depth), with a key and a fill light and a sky; drag to turn it, wheel to zoom, Shift+drag to move the
   * light. Physically based in the usual way (GGX, Schlick, Smith).
   */
  function Viewer(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: true }); // kept, so it can be copied or captured
    if (!gl) throw new Error('WebGL 2 is not available');
    const vs = `#version 300 es
      in vec3 aPos; in vec3 aNorm; in vec3 aTan; in vec2 aUv;
      uniform mat4 uModel, uView, uProj; uniform float uTile;
      out vec3 vPos; out vec3 vNorm; out vec3 vTan; out vec2 vUv;
      void main() { vec4 w = uModel * vec4(aPos, 1.0); vPos = w.xyz; vNorm = mat3(uModel) * aNorm; vTan = mat3(uModel) * aTan; vUv = aUv * uTile; gl_Position = uProj * uView * w; }`;
    const fs = `#version 300 es
      precision highp float;
      in vec3 vPos; in vec3 vNorm; in vec3 vTan; in vec2 vUv;
      uniform sampler2D tAlbedo, tNormal, tRough, tAo, tMetal, tHeight; uniform vec3 uEye;
      uniform vec3 uKeyDir, uKeyCol, uFillDir, uFillCol, uSky, uGround; uniform float uAmb, uDepth; uniform int uMode;
      out vec4 outColor;
      const float PI = 3.14159265;
      vec3 light(vec3 n, vec3 v, vec3 l, vec3 col, vec3 albedo, float rough, float metal) {
        vec3 h = normalize(v + l);
        float nl = max(dot(n, l), 0.0), nv = max(dot(n, v), 1e-3), nh = max(dot(n, h), 0.0), vh = max(dot(v, h), 0.0);
        float a = rough * rough, a2 = a * a;
        float d = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
        float k = (rough + 1.0) * (rough + 1.0) / 8.0;
        float g = (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k));
        vec3 f0 = mix(vec3(0.04), albedo, metal);
        vec3 f = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
        vec3 spec = d * g * f / max(4.0 * nv * nl, 1e-3);
        vec3 diff = (1.0 - f) * (1.0 - metal) * albedo / PI;
        return (diff + spec) * col * nl;
      }
      // Parallax occlusion: step into the height map along the view, so the relief has depth (not the outline).
      vec2 parallax(vec2 uv, vec3 vts, vec2 dx, vec2 dy) {
        if (uDepth <= 0.0) return uv;
        float n = mix(32.0, 8.0, clamp(vts.z, 0.0, 1.0)), layer = 1.0 / n;
        vec2 d = vec2(vts.x, -vts.y) / max(vts.z, 0.2) * uDepth / n;
        vec2 c = uv; float depth = 0.0, h = 1.0 - textureGrad(tHeight, c, dx, dy).r;
        for (int i = 0; i < 32; i++) { if (depth >= h || float(i) >= n) break; c -= d; depth += layer; h = 1.0 - textureGrad(tHeight, c, dx, dy).r; }
        float after = h - depth, before = (1.0 - textureGrad(tHeight, c + d, dx, dy).r) - depth + layer;
        float w = after / (after - before + 1e-5);
        return mix(c, c + d, clamp(w, 0.0, 1.0));
      }
      void main() {
        vec3 N = normalize(vNorm), T = normalize(vTan - N * dot(N, vTan)), B = cross(N, T);
        vec3 v = normalize(uEye - vPos);
        vec2 dx = dFdx(vUv), dy = dFdy(vUv);
        vec2 uv = parallax(vUv, vec3(dot(v, T), dot(v, B), dot(v, N)), dx, dy);
        vec3 albedoTex = textureGrad(tAlbedo, uv, dx, dy).rgb;
        float rough = clamp(textureGrad(tRough, uv, dx, dy).r, 0.04, 1.0), metal = textureGrad(tMetal, uv, dx, dy).r, ao = textureGrad(tAo, uv, dx, dy).r;
        vec3 tnTex = textureGrad(tNormal, uv, dx, dy).rgb;
        if (uMode >= 2) {
          vec3 m = uMode == 2 ? albedoTex : uMode == 3 ? tnTex : uMode == 4 ? vec3(rough) : uMode == 5 ? vec3(metal) : uMode == 6 ? vec3(ao) : textureGrad(tHeight, uv, dx, dy).rrr;
          outColor = vec4(m * (0.82 + 0.18 * max(dot(N, v), 0.0)), 1.0); // the map as it is, with a hint of the shape
          return;
        }
        vec3 albedo = uMode == 1 ? vec3(0.18) : pow(albedoTex, vec3(2.2));
        if (uMode == 1) metal = 0.0;
        vec3 tn = tnTex * 2.0 - 1.0;
        vec3 n = normalize(T * tn.x + B * tn.y + N * tn.z);
        vec3 c = light(n, v, uKeyDir, uKeyCol, albedo, rough, metal) + light(n, v, uFillDir, uFillCol, albedo, rough, metal);
        // Surroundings: the sky above and the ground below. Diffuse light from them, and their reflection, blurred
        // towards their average as the surface gets rougher (metals show almost nothing else).
        vec3 f0 = mix(vec3(0.04), albedo, metal);
        float nv = max(dot(n, v), 1e-3);
        vec3 r = reflect(-v, n);
        vec3 env = mix(mix(uGround, uSky, smoothstep(-0.25, 0.65, r.y)), (uGround + uSky) * 0.5, rough * rough);
        vec3 fr = f0 + (max(vec3(1.0 - rough), f0) - f0) * pow(1.0 - nv, 5.0);
        c += mix(uGround, uSky, n.y * 0.5 + 0.5) * albedo * (1.0 - metal) * ao * uAmb;
        c += env * fr * ao * (1.0 - rough * 0.5) * (0.4 + uAmb);
        c *= 1.35;
        c = c / (c + 1.0);
        outColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
      }`;
    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const U = (n) => gl.getUniformLocation(prog, n);
    const textures = {};
    ['tAlbedo', 'tNormal', 'tRough', 'tAo', 'tMetal', 'tHeight'].forEach((name, unit) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(name === 'tNormal' ? [128, 128, 255, 255] : name === 'tHeight' ? [255, 255, 255, 255] : [200, 200, 200, 255]));
      gl.uniform1i(U(name), unit);
      textures[name] = { tex: t, unit, url: '' };
    });
    const MAP = { albedo: 'tAlbedo', normal: 'tNormal', roughness: 'tRough', ao: 'tAo', metallic: 'tMetal', height: 'tHeight' };

    // Shapes: positions, normals, tangents (along u, to the right as the texture is seen) and uvs (v down the picture).
    function sphere() {
      const p = [], idx = [], SEG = 96, RINGS = 48;
      for (let r = 0; r <= RINGS; r++) {
        const v = r / RINGS, th = v * Math.PI;
        for (let s = 0; s <= SEG; s++) {
          const u = s / SEG, ph = u * Math.PI * 2;
          // Going round so that u runs to the right seen from outside: the picture isn't mirrored and the normal
          // map's up is the shape's up.
          const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = -Math.sin(th) * Math.sin(ph);
          p.push(x, y, z, x, y, z, -Math.sin(ph), 0, -Math.cos(ph), u * 2, v); // u twice around: square texels at the equator
        }
      }
      for (let r = 0; r < RINGS; r++) for (let s = 0; s < SEG; s++) { const a = r * (SEG + 1) + s, b = a + SEG + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      return { p, idx };
    }
    const FACES = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
    function cube() {
      const p = [], idx = [];
      for (const [n, t, b] of FACES) {
        const base = p.length / 11;
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const pos = [0, 1, 2].map((k) => (n[k] + t[k] * su + b[k] * sv) * 0.8);
          p.push(...pos, ...n, ...t, (su + 1) / 2, 1 - (sv + 1) / 2);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      return { p, idx };
    }
    /** A cube with rounded edges: each face a flat square, no pinched poles (how materials are usually judged). */
    function roundedCube() {
      const p = [], idx = [], G = 24, A = 0.55, R = 0.27;
      for (const [n, t, b] of FACES) {
        const base = p.length / 11;
        for (let j = 0; j <= G; j++) {
          for (let i = 0; i <= G; i++) {
            const su = (i / G) * 2 - 1, sv = (j / G) * 2 - 1;
            const c = [0, 1, 2].map((k) => (n[k] + t[k] * su + b[k] * sv) * (A + R));
            const inner = c.map((x) => Math.max(-A, Math.min(A, x)));
            let d = c.map((x, k) => x - inner[k]);
            const len = Math.hypot(...d);
            d = len > 1e-6 ? d.map((x) => x / len) : n.slice();
            const pos = inner.map((x, k) => x + d[k] * R);
            const td = t[0] * d[0] + t[1] * d[1] + t[2] * d[2];
            let tan = t.map((x, k) => x - d[k] * td);
            const tl = Math.hypot(...tan) || 1;
            tan = tan.map((x) => x / tl);
            p.push(...pos, ...d, ...tan, (su + 1) / 2, 1 - (sv + 1) / 2);
          }
        }
        for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const a = base + j * (G + 1) + i, up = a + G + 1; idx.push(a, a + 1, up + 1, a, up + 1, up); }
      }
      return { p, idx };
    }
    function plane() {
      const p = [-1.3, 0, 1.3, 0, 1, 0, 1, 0, 0, 0, 1, 1.3, 0, 1.3, 0, 1, 0, 1, 0, 0, 1, 1, 1.3, 0, -1.3, 0, 1, 0, 1, 0, 0, 1, 0, -1.3, 0, -1.3, 0, 1, 0, 1, 0, 0, 0, 0];
      return { p, idx: [0, 1, 2, 0, 2, 3] };
    }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const vbo = gl.createBuffer(), ibo = gl.createBuffer();
    let count = 0;
    function setShape(name) {
      const { p, idx } = name === 'cube' ? cube() : name === 'rounded' ? roundedCube() : name === 'plane' ? plane() : sphere();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(p), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      [['aPos', 3, 0], ['aNorm', 3, 3], ['aTan', 3, 6], ['aUv', 2, 9]].forEach(([n, size, off]) => {
        const loc = gl.getAttribLocation(prog, n);
        if (loc < 0) return;
        gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 44, off * 4);
      });
      count = idx.length;
      if (name === 'plane') { pitch = 0.75; } else if (pitch > 0.6) pitch = 0.25;
      draw();
    }
    const DIST = 2.9;
    let yaw = 0.6, pitch = 0.25, tile = tiling, dist = DIST, mode = 0, depth = 0;
    let lights = LIGHTS.studio, lightAz = lights.az, lightEl = lights.el, orbit = false;
    const persp = (fov, aspect, n, f) => { const t = 1 / Math.tan(fov / 2); return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; };
    const rotY = (a) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
    const rotX = (a) => [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1];
    const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
    const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
    /** The key light's direction: round (azimuth, 0 = from the camera) and up (elevation). */
    const keyDir = () => [Math.sin(lightAz) * Math.cos(lightEl), Math.sin(lightEl), Math.cos(lightAz) * Math.cos(lightEl)];
    let pending = false;
    function draw() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const w = canvas.width, h = canvas.height;
        if (!w || !h) return;
        gl.viewport(0, 0, w, h);
        gl.clearColor(0.09, 0.09, 0.11, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
        gl.uniformMatrix4fv(U('uModel'), false, mul(rotX(pitch), rotY(yaw)));
        gl.uniformMatrix4fv(U('uView'), false, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -dist, 1]);
        gl.uniformMatrix4fv(U('uProj'), false, persp(0.75, w / h, 0.05, 20));
        gl.uniform3f(U('uEye'), 0, 0, dist);
        gl.uniform1f(U('uTile'), tile);
        gl.uniform3fv(U('uKeyDir'), keyDir()); gl.uniform3fv(U('uKeyCol'), lights.key);
        gl.uniform3fv(U('uFillDir'), norm(lights.fill)); gl.uniform3fv(U('uFillCol'), lights.fillCol);
        gl.uniform3fv(U('uSky'), lights.sky); gl.uniform3fv(U('uGround'), lights.ground); gl.uniform1f(U('uAmb'), lights.amb);
        gl.uniform1i(U('uMode'), mode); gl.uniform1f(U('uDepth'), depth);
        gl.bindVertexArray(vao);
        gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
      });
    }
    function setMaps(maps) {
      for (const [m, name] of Object.entries(MAP)) {
        const t = textures[name];
        if (!maps[m] || t.url === maps[m]) continue;
        t.url = maps[m];
        const img = new Image();
        img.onload = () => {
          if (t.url !== maps[m]) return;
          gl.activeTexture(gl.TEXTURE0 + t.unit); gl.bindTexture(gl.TEXTURE_2D, t.tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
          if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
          canvas.dataset.loaded = String((Number(canvas.dataset.loaded) || 0) + 1);
          draw();
        };
        img.src = maps[m];
      }
    }
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (w && h && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
      draw();
    }
    const clampPitch = (p) => Math.max(-1.4, Math.min(1.4, p));
    function zoom(factor) { dist = Math.max(1.25, Math.min(7, dist * factor)); draw(); }
    function moveLight(dAz, dEl) { lightAz += dAz; lightEl = Math.max(-0.2, Math.min(1.5, lightEl + dEl)); draw(); }
    let drag = null;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, light: e.shiftKey || e.button === 2 }; canvas.setPointerCapture(e.pointerId); canvas.classList.toggle('lighting', drag.light); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) * 0.01, dy = (e.clientY - drag.y) * 0.01;
      if (drag.light) moveLight(dx, -dy);
      else { yaw += dx; pitch = clampPitch(pitch + dy); draw(); }
      drag.x = e.clientX; drag.y = e.clientY;
    });
    const end = () => { drag = null; canvas.classList.remove('lighting'); };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.exp(Math.max(-1, Math.min(1, e.deltaY / 300)))); }, { passive: false });
    canvas.addEventListener('keydown', (e) => {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1 / 1.15); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoom(1.15); return; }
      const step = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, -0.15], ArrowDown: [0, 0.15] }[e.key];
      if (!step) return;
      e.preventDefault();
      if (e.shiftKey) moveLight(step[0], -step[1]);
      else { yaw += step[0]; pitch = clampPitch(pitch + step[1]); draw(); }
    });
    canvas.tabIndex = 0;
    // The light going round, so every slope catches it in turn (stops when the preview isn't shown).
    let last = 0;
    function spin(t) {
      if (!orbit) return;
      if (canvas.isConnected && canvas.offsetParent) { if (last) lightAz += Math.min(0.05, (t - last) / 1000) * 0.9; draw(); }
      last = t;
      requestAnimationFrame(spin);
    }
    setShape('sphere');
    return {
      setMaps, setShape, resize, zoom,
      setTiling: (n) => { tile = n; draw(); },
      setLights: (id) => { lights = LIGHTS[id] || LIGHTS.studio; lightAz = lights.az; lightEl = lights.el; draw(); },
      setMode: (id) => { mode = Math.max(0, SHOW.findIndex(([v]) => v === id)); draw(); },
      setDepth: (d) => { depth = d; draw(); },
      setOrbit: (on) => { orbit = !!on; last = 0; if (orbit) requestAnimationFrame(spin); },
      reset: () => { yaw = 0.6; pitch = shape === 'plane' ? 0.75 : 0.25; dist = DIST; lightAz = lights.az; lightEl = lights.el; draw(); },
      state: () => ({ dist, yaw, pitch, mode: SHOW[mode][0], depth, orbit, lightAz, lightEl }),
      _gl: gl,
    };
  }

  return {
    init, open, close, toggle, isOpen, fromPictures, newMaterial, randomMaterial,
    hasMaterial: () => !!recipe,
    _state: () => ({ recipe: recipe ? clone(recipe) : null, render: render ? { ...render } : null, history: history.length, future: future.length, pinned: !!pinned, listening, tab, view, shape, tiling, webgl: !!gl3d, layout: { ...layoutPrefs }, lights: lightsId, show, viewer: gl3d ? gl3d.state() : null }),
  };
})();
