// NoorMD Texture Bench: tileable procedural materials for games (stone, ground, wood, metal, walls, fabric). The page
// edits a recipe; the app renders its maps (the same recipe and seed always give the same pixels) and the page shows
// them lit in 3D and as flat, tiled maps. Export writes PNG maps for a game engine with the recipe beside them.
window.NoorTexture = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);

  const LAYER_LABEL = { noise: 'Noise', ridged: 'Ridged noise', turbulence: 'Turbulence', cells: 'Cells (stones, cracks)', wood: 'Wood grain', bricks: 'Bricks / tiles', weave: 'Weave', scratches: 'Scratches' };
  const NEW_LAYER = {
    noise: { scaleX: 4, scaleY: 4, octaves: 5 }, ridged: { scaleX: 3, scaleY: 3, octaves: 6 }, turbulence: { scaleX: 6, scaleY: 6, octaves: 4 },
    cells: { scaleX: 6, scaleY: 6, mode: 'cells', jitter: 1, variation: 0.3 }, wood: { scaleX: 9, scaleY: 3, octaves: 5 },
    bricks: { scaleX: 4, scaleY: 8, mortar: 0.1, bevel: 0.08, offset: 0.5, variation: 0.3 }, weave: { scaleX: 32, scaleY: 32 },
    scratches: { scaleX: 1, scaleY: 1, count: 40, length: 0.2, width: 0.004 },
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
    weave: [['scaleX', 'Threads across', 2, 128, 2, 'int'], ['scaleY', 'Threads down', 2, 128, 2, 'int'], ...WARP],
    scratches: [['count', 'How many', 0, 500, 1, 'int'], ['length', 'Length', 0.005, 1, 0.005, 'pct'], ['width', 'Width', 0.0005, 0.05, 0.0005, 'pct']],
  };
  const SHAPE = [['opacity', 'Strength', 0, 1, 0.01, 'pct'], ['low', 'Levels: low', 0, 1, 0.01, 'pct'], ['high', 'Levels: high', 0, 1, 0.01, 'pct'], ['gamma', 'Levels: middle (gamma)', 0.1, 5, 0.01, 'num']];
  const BLENDS = [['normal', 'Replace'], ['add', 'Add'], ['subtract', 'Subtract'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['max', 'Higher of the two'], ['min', 'Lower of the two']];
  const SURFACE = [['colorVariation', 'Colour variation', 0, 1, 0.01, 'pct'], ['dirt', 'Dirt in the cavities', 0, 1, 0.01, 'pct'],
    ['roughnessLow', 'Roughness, low parts', 0, 1, 0.01, 'pct'], ['roughnessHigh', 'Roughness, high parts', 0, 1, 0.01, 'pct'], ['roughnessVariation', 'Roughness variation', 0, 1, 0.01, 'pct'],
    ['metallic', 'Metallic', 0, 1, 0.01, 'pct'], ['normalStrength', 'Relief (normal strength)', 0, 20, 0.1, 'num'], ['aoStrength', 'Ambient occlusion', 0, 1, 0.01, 'pct'], ['aoRadius', 'Occlusion width', 0.002, 0.1, 0.001, 'pct']];
  const VIEWS = [['3d', '3D'], ['albedo', 'Albedo'], ['normal', 'Normal'], ['roughness', 'Roughness'], ['ao', 'AO'], ['height', 'Height'], ['metallic', 'Metallic']];
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
  let gl3d = null; // the 3D preview (null when WebGL2 isn't there)

  const isOpen = () => document.body.classList.contains('texture-open');
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function init(h) {
    hooks = { ...hooks, ...h };
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
      setStatus(`${listening === 'A' ? 'A (pinned) · ' : ''}${out.size} × ${out.size} px preview${out.ms ? ` · ${out.ms} ms` : ''} · tiles seamlessly`);
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
      flat.style.backgroundSize = `${100 / tiling}% ${100 / tiling}%`;
    }
    if (gl3d) gl3d.setMaps(render.maps);
  }

  function setView(v) {
    view = v;
    try { localStorage.setItem('noormd.texture.view', v); } catch { /* private storage off */ }
    const threeD = v === '3d' && !!gl3d;
    $('#tb-canvas').hidden = !threeD;
    $('#tb-flat').hidden = threeD;
    $('#tb-shape').hidden = !threeD;
    document.querySelectorAll('#tb-views button').forEach((b) => { b.classList.toggle('active', b.dataset.view === v); b.setAttribute('aria-pressed', String(b.dataset.view === v)); });
    if (v === '3d' && !gl3d) $('#tb-flat').dataset.note = 'The 3D preview needs WebGL 2, which is not available here: showing the albedo.';
    else delete $('#tb-flat').dataset.note;
    if (v === '3d' && !gl3d && render) { const f = $('#tb-flat'); f.style.backgroundImage = `url("${render.maps.albedo}")`; f.style.backgroundSize = `${100 / tiling}% ${100 / tiling}%`; }
    showMaps();
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
            el('button', { class: 'utility-btn', id: 'tb-ab', title: 'Show A (pinned) or B (now) (B)', hidden: true, onclick: flipAB }, 'A/B: B')),
          el('div', { class: 'tb-views', id: 'tb-views', role: 'group', 'aria-label': 'What to show' },
            ...VIEWS.map(([v, label]) => el('button', { class: 'utility-btn', 'data-view': v, onclick: () => setView(v) }, label)),
            el('span', { class: 'sb-fx-space' }),
            (() => {
              const s = el('select', { id: 'tb-shape', 'aria-label': 'Preview shape' }, ...[['sphere', 'Sphere'], ['cube', 'Cube'], ['plane', 'Plane']].map(([v, t]) => el('option', { value: v, text: t })));
              s.addEventListener('change', () => { shape = s.value; if (gl3d) gl3d.setShape(shape); });
              return s;
            })(),
            (() => {
              const s = el('select', { id: 'tb-tiling', 'aria-label': 'Tiling' }, ...[1, 2, 3, 4].map((n) => el('option', { value: String(n), text: `${n} × ${n}` })));
              s.value = String(tiling);
              s.addEventListener('change', () => { tiling = Number(s.value); if (gl3d) gl3d.setTiling(tiling); showMaps(); setView(view); });
              return s;
            })()),
          el('div', { class: 'tb-stage' },
            el('canvas', { id: 'tb-canvas', class: 'tb-canvas', 'aria-label': 'The material on a lit shape: drag to turn it', role: 'img' }),
            el('div', { id: 'tb-flat', class: 'tb-flat', role: 'img', 'aria-label': 'The map, tiled', hidden: true }),
            el('div', { class: 'tb-thumbs', id: 'tb-thumbs' }, ...VIEWS.slice(1).map(([m, label]) => el('button', { class: 'tb-thumb', 'data-map': m, title: `${label} map`, 'aria-label': `Show the ${label} map`, onclick: () => setView(m) }, el('span', { text: label }))))),
          el('p', { class: 'pref-hint sb-status', id: 'tb-status', 'aria-live': 'polite' }),
          el('div', { class: 'music-tabs sb-tabs', role: 'tablist' }, ...[['layers', 'Layers'], ['surface', 'Surface'], ['export', 'Export']].map(([id, label]) =>
            el('button', { role: 'tab', 'data-tab': id, class: id === tab ? 'active' : '', onclick: () => { tab = id; renderEditor(); } }, label))),
          el('div', { class: 'sb-pane', id: 'tb-pane' }))));
    ($('#app') || document.body).append(root);
    $('#tb-name').addEventListener('input', (e) => { recipe.name = e.target.value; changed(false); });
    $('#tb-seed').addEventListener('change', (e) => { recipe.seed = Math.max(0, Math.min(2147483647, Math.round(Number(e.target.value) || 0))); changed(false); });
    new ResizeObserver(() => { root.classList.toggle('wide', root.clientWidth >= 820); if (gl3d) gl3d.resize(); }).observe(root);
    root.addEventListener('keydown', (e) => {
      const typing = e.target.closest('input[type=text], input[type=number], select, textarea');
      if (e.key === 'Escape' && !typing) { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (typing) return;
      if (e.key.toLowerCase() === 'z' && e.ctrlKey) { e.preventDefault(); undo(e.shiftKey); }
      else if (e.key.toLowerCase() === 'y' && e.ctrlKey) { e.preventDefault(); undo(true); }
      else if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.altKey) { e.preventDefault(); newVariation(); }
      else if (e.key.toLowerCase() === 'b' && !e.ctrlKey && !e.altKey && pinned) { e.preventDefault(); flipAB(); }
    });
    try { gl3d = Viewer($('#tb-canvas')); } catch (err) { console.warn('Texture Bench: no 3D preview', err); gl3d = null; }
    setView(view);
  }

  function renderPresets() {
    const nav = $('#tb-presets');
    const groups = new Map();
    for (const p of presets.builtIn) { if (!groups.has(p.family)) groups.set(p.family, []); groups.get(p.family).push(p); }
    const item = (p) => el('button', { class: 'gnav-item' + (recipe && recipe.name === p.name ? ' active' : ''), 'data-preset': p.id, title: p.description, onclick: () => loadPreset(p.id) },
      el('span', { text: p.name }), ...(p.id.startsWith('user:') ? [el('span', { class: 'icon-btn', role: 'button', title: 'Delete this preset', onclick: (e) => { e.stopPropagation(); deletePreset(p); } }, '✕')] : []));
    nav.replaceChildren(
      ...[...groups].flatMap(([family, list]) => [el('div', { class: 'gnav-head', text: family }), ...list.map(item)]),
      el('div', { class: 'gnav-head', text: 'My presets' }),
      ...(presets.mine.length ? presets.mine.map(item) : [el('p', { class: 'pref-hint', text: 'Save a material you like with “Save as my preset”.' })]));
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

  const UNIT = { pct: ['%', 100], int: ['', 1], num: ['', 1] };

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
      const choices = [el('label', { class: 'sb-inline' }, el('span', { text: 'Blend' }), blend), el('label', { class: 'sb-inline' }, invert, el('span', { text: 'Invert' }))];
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
        el('div', { class: 'sb-fields' }, ...(FIELDS[l.type] || []).map((f) => slider(l, f)), ...SHAPE.map((f) => slider(l, f))));
    });
    return [
      el('p', { class: 'pref-hint', text: 'Layers build the height of the material, from the first down: each is blended onto the ones before it. The Surface tab turns the height into colour, relief and shine.' }),
      ...cards,
      el('div', { class: 'sb-row' }, el('span', { text: 'Add:' }), ...Object.keys(NEW_LAYER).map((t) => el('button', { class: 'utility-btn', 'data-addlayer': t, disabled: recipe.layers.length >= 12 || undefined, onclick: () => {
        recipe.layers.push({ name: LAYER_LABEL[t].replace(/ \(.*/, ''), type: t, octaves: 5, persistence: 0.5, lacunarity: 2, warp: 0, warpScale: 3, low: 0, high: 1, gamma: 1, invert: false,
          blend: recipe.layers.length ? 'overlay' : 'normal', opacity: recipe.layers.length ? 0.5 : 1, seedShift: recipe.layers.length * 11, mute: false, ...clone(NEW_LAYER[t]) });
        changed(true);
      } }, '＋ ' + LAYER_LABEL[t].replace(/ \(.*/, '')))),
    ];
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

  // ---------------------------------------------------------------- export

  function exportPrefs() { try { return { size: 1024, target: 'generic', ...JSON.parse(localStorage.getItem('noormd.texture.export') || '{}') }; } catch { return { size: 1024, target: 'generic' }; } }
  function saveExportPrefs(p) { try { localStorage.setItem('noormd.texture.export', JSON.stringify(p)); } catch { /* private storage off */ } }

  function exportPane() {
    const prefs = exportPrefs();
    const sel = (id, label, options, value, key, num) => {
      const s = el('select', { id, 'aria-label': label }, ...options.map(([v, t]) => el('option', { value: String(v), text: t })));
      s.value = String(value);
      s.addEventListener('change', () => saveExportPrefs({ ...exportPrefs(), [key]: num ? Number(s.value) : s.value }));
      return el('label', { class: 'sb-inline' }, el('span', { text: label }), s);
    };
    return [
      el('div', { class: 'sb-row' },
        sel('tb-size', 'Size', [512, 1024, 2048, 4096].map((n) => [n, `${n} × ${n}`]), prefs.size, 'size', true),
        sel('tb-target', 'For', TARGETS, prefs.target, 'target', false)),
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

  async function exportMaps() {
    const p = exportPrefs();
    const status = $('#tb-export-status');
    try {
      const r = await req('texture.export', { recipe, size: p.size, target: p.target });
      if (!r || r.cancelled) return;
      if (status) {
        status.replaceChildren(el('span', { text: `Saved ${r.files.length} maps and the recipe in ${r.folder}. ` }),
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

  async function openRecipe() {
    try {
      const r = await req('texture.open');
      if (!r || r.cancelled) return;
      setRecipe(r.recipe, true);
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- 3D preview (WebGL 2)

  /**
   * A lit shape wearing the maps: albedo, normal (tangent space, OpenGL), roughness, metallic and AO, with a key and a
   * fill light and a soft sky; drag to turn it. Physically based in the usual way (GGX, Schlick, Smith).
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
      uniform sampler2D tAlbedo, tNormal, tRough, tAo, tMetal; uniform vec3 uEye;
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
      void main() {
        vec3 albedo = pow(texture(tAlbedo, vUv).rgb, vec3(2.2));
        float rough = clamp(texture(tRough, vUv).r, 0.04, 1.0), metal = texture(tMetal, vUv).r, ao = texture(tAo, vUv).r;
        vec3 N = normalize(vNorm), T = normalize(vTan - N * dot(N, vTan)), B = cross(N, T);
        vec3 tn = texture(tNormal, vUv).rgb * 2.0 - 1.0;
        vec3 n = normalize(T * tn.x + B * tn.y + N * tn.z);
        vec3 v = normalize(uEye - vPos);
        vec3 c = light(n, v, normalize(vec3(0.6, 0.8, 0.9)), vec3(3.0), albedo, rough, metal)
               + light(n, v, normalize(vec3(-0.8, 0.2, 0.4)), vec3(0.7, 0.75, 0.9), albedo, rough, metal);
        // Surroundings: a sky above and warm ground below. Diffuse light from them, and their reflection, blurred
        // towards their average as the surface gets rougher (metals show almost nothing else).
        vec3 ground = vec3(0.22, 0.2, 0.17), skyCol = vec3(0.72, 0.8, 0.95);
        vec3 f0 = mix(vec3(0.04), albedo, metal);
        float nv = max(dot(n, v), 1e-3);
        vec3 r = reflect(-v, n);
        vec3 env = mix(mix(ground, skyCol, smoothstep(-0.25, 0.65, r.y)), (ground + skyCol) * 0.5, rough * rough);
        vec3 fr = f0 + (max(vec3(1.0 - rough), f0) - f0) * pow(1.0 - nv, 5.0);
        c += mix(ground, skyCol, n.y * 0.5 + 0.5) * albedo * (1.0 - metal) * ao * 0.55;
        c += env * fr * ao * (1.0 - rough * 0.5);
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
    ['tAlbedo', 'tNormal', 'tRough', 'tAo', 'tMetal'].forEach((name, unit) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(name === 'tNormal' ? [128, 128, 255, 255] : [200, 200, 200, 255]));
      gl.uniform1i(U(name), unit);
      textures[name] = { tex: t, unit, url: '' };
    });
    const MAP = { albedo: 'tAlbedo', normal: 'tNormal', roughness: 'tRough', ao: 'tAo', metallic: 'tMetal' };

    // Shapes: positions, normals, tangents (along u) and uvs.
    function sphere() {
      const p = [], idx = [], SEG = 64, RINGS = 32;
      for (let r = 0; r <= RINGS; r++) {
        const v = r / RINGS, th = v * Math.PI;
        for (let s = 0; s <= SEG; s++) {
          const u = s / SEG, ph = u * Math.PI * 2;
          const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
          p.push(x, y, z, x, y, z, -Math.sin(ph), 0, Math.cos(ph), u * 2, v); // u twice around: square texels at the equator
        }
      }
      for (let r = 0; r < RINGS; r++) for (let s = 0; s < SEG; s++) { const a = r * (SEG + 1) + s, b = a + SEG + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      return { p, idx };
    }
    function cube() {
      const p = [], idx = [];
      const faces = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
      for (const [n, t, b] of faces) {
        const base = p.length / 11;
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const pos = [0, 1, 2].map((k) => (n[k] + t[k] * su + b[k] * sv) * 0.8);
          p.push(...pos, ...n, ...t, (su + 1) / 2, 1 - (sv + 1) / 2);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
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
      const { p, idx } = name === 'cube' ? cube() : name === 'plane' ? plane() : sphere();
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
    let yaw = 0.6, pitch = 0.25, tile = tiling;
    const persp = (fov, aspect, n, f) => { const t = 1 / Math.tan(fov / 2); return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; };
    const rotY = (a) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
    const rotX = (a) => [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1];
    const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
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
        gl.uniformMatrix4fv(U('uView'), false, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -2.9, 1]);
        gl.uniformMatrix4fv(U('uProj'), false, persp(0.75, w / h, 0.1, 20));
        gl.uniform3f(U('uEye'), 0, 0, 2.9);
        gl.uniform1f(U('uTile'), tile);
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
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      yaw += (e.clientX - drag.x) * 0.01; pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - drag.y) * 0.01));
      drag = { x: e.clientX, y: e.clientY };
      draw();
    });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, -0.15], ArrowDown: [0, 0.15] }[e.key];
      if (!step) return;
      e.preventDefault(); yaw += step[0]; pitch = Math.max(-1.4, Math.min(1.4, pitch + step[1])); draw();
    });
    canvas.tabIndex = 0;
    setShape('sphere');
    return { setMaps, setShape, resize, setTiling: (n) => { tile = n; draw(); }, _gl: gl };
  }

  return {
    init, open, close, toggle, isOpen,
    _state: () => ({ recipe: recipe ? clone(recipe) : null, render: render ? { ...render } : null, history: history.length, future: future.length, pinned: !!pinned, listening, tab, view, shape, tiling, webgl: !!gl3d }),
  };
})();
