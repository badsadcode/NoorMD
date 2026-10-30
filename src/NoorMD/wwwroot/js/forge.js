// NoorForge: texturing a model with layers and smart masks (docs/NOORFORGE_PLAN.md). The page edits the recipe — the
// model, the layers bottom first, the bakes' settings — and shows the textured model; the app bakes the model's maps,
// composes the layers and serves the textured GLB and its maps. Export writes the texture sets, the GLB and the recipe.
window.NoorForge = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const MASKS = { all: 'Everywhere', none: 'Nowhere (only where painted)', edges: 'Worn edges', chips: 'Chipped edges', cavity: 'Cracks and corners (dirt)', top: 'On top (dust, moss, snow)', bottom: 'Underneath (grime)',
    height: 'Low down (a gradient up the model)', drips: 'Drips running down', layer: 'Another layer\'s mask', part: 'One part', material: 'One material' };
  const newId = () => 'L' + Math.random().toString(36).slice(2, 9);
  /** Every layer has an id (the masks that follow a layer name it by its id). */
  const ensureIds = () => { const seen = new Set(); for (const l of recipe.layers) { if (!l.id || seen.has(l.id)) l.id = newId(); seen.add(l.id); } };
  const MAPS = [['basecolor', 'Colour'], ['normal', 'Normal'], ['orm', 'AO · rough · metal'], ['height', 'Height'], ['ao', 'Baked AO'], ['curvature', 'Curvature'], ['mask', 'Mask (this layer)']];
  // What the 3D view shows: lit, or one channel on the model as it is (no light).
  const VIEWS = [['shaded', 'Textured'], ['clay', 'Clay (the shape)'], ['basecolor', 'Colour only'], ['normal', 'Normal'], ['roughness', 'Roughness'], ['metallic', 'Metal'], ['height', 'Height'],
    ['ao', 'Baked AO'], ['curvature', 'Curvature'], ['mask', 'Mask of the chosen layer']];

  let hooks = { showError: (e) => console.error(e) };
  let built = false;
  let lists = { smart: [], materials: [], sizes: [512, 1024, 2048] };
  let recipe = null;
  let model = null;        // what the app said about the open model
  let selected = 0;        // the layer being edited
  let tab = 'layers';
  let viewer = null;
  let layout = { prefs: {}, set() {}, apply() {} };
  let render = null;       // the last preview
  let shownSet = 0;
  let view = 'shaded';
  // Painting (stage 2): the tool, the brush, where each texel is on the model, the stroke being painted.
  let tool = null;         // null, 'brush' or 'fill'
  let erasing = false;
  const BRUSH_DEFAULTS = { size: 4, hardness: 0.5, flow: 1, spacing: 0.25, pressureSize: true, pressureFlow: false, mirror: false, tip: '', angle: 0, jitter: 0 };
  // The stencil: a picture of the recipe laid over the view (where, how big, turned how far clockwise), white lets paint through.
  let stencil = null;      // { id, fx, fy, size, angle, tile, invert, opacity, shown }
  let stencilKey = false;  // S held: the mouse moves the stencil, the wheel sizes (Shift: turns) it
  const grays = new Map(); // picture id → { w, h, g: Uint8Array }
  let brush = (() => { try { return { ...BRUSH_DEFAULTS, ...JSON.parse(localStorage.getItem('noormd.forge.brush') || '{}') }; } catch { return { ...BRUSH_DEFAULTS }; } })();
  let texels = null;       // { key, size, sets: [Float32Array (7 a texel)], grid, center }
  let texelsLoading = null;
  let stroke = null;       // { strokes: [the stroke (and its mirror)], last: [x, y, z] }
  let overlay = null;      // { cover: [Float32Array per set], bytes: [Uint8Array per set], erase }
  let paintVersion = 0;    // strokes committed (the preview clears the overlay once it shows them all)
  let renderTimer = null, renderGen = 0;
  const history = []; let future = []; let lastSnapshot = '';

  const isOpen = () => document.body.classList.contains('forge-open');

  // NoorForge settings (Edit › NoorForge settings…): what a new recipe starts with.
  const SETTINGS_KEY = 'noorforge.settings';
  const SETTINGS_DEFAULTS = { size: 1024, export: 'godot', smart: 'mossy-stone', aoRays: 24 };
  let settings = { ...SETTINGS_DEFAULTS };
  try { settings = { ...SETTINGS_DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}) }; } catch { /* the defaults */ }

  function init(h) { hooks = { ...hooks, ...h }; NoorBridge.on('forge.exportProgress', (p) => setStatus(`Exporting texture set ${p.done} of ${p.total}…`)); }

  async function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('forge');
    document.body.classList.add('forge-open');
    $('#forgebench').hidden = false;
    if (!lists.smart.length) {
      try { lists = await req('forge.presets'); } catch (err) { hooks.showError(err); }
      renderNav();
    }
    if (!recipe) {
      const size = lists.sizes.includes(settings.size) ? settings.size : 1024;
      const exportFor = !lists.exports || lists.exports.some((x) => x.id === settings.export) ? settings.export : 'godot';
      setRecipe({ version: 1, name: 'Textured model', model: null, size, export: exportFor, aoRays: settings.aoRays, aoDistance: 0.25, edgeWidth: 0.02, layers: smartLayers(settings.smart) }, true);
    }
    $('#forgebench').focus({ preventScroll: true });
  }

  function close() {
    if (!built || !isOpen()) return;
    document.body.classList.remove('forge-open');
    $('#forgebench').hidden = true;
    if (window.NoorDock) NoorDock.closed('forge');
  }

  function toggle() { if (isOpen()) close(); else open(); }

  const smartLayers = (id) => clone((lists.smart.find((s) => s.id === id) || lists.smart[0] || { layers: [] }).layers);

  function setRecipe(r, fresh) {
    if (!fresh && recipe) pushHistory();
    recipe = r;
    ensureIds();
    if (fresh) { history.length = 0; future = []; selected = recipe.layers.length - 1; } // the top layer, as in a painting program
    selected = Math.max(0, Math.min(recipe.layers.length - 1, selected));
    lastSnapshot = JSON.stringify(recipe);
    renderAll();
    if (recipe.model) schedule(); else preview(); // no model: says so at once
  }

  /** Something changed: keep the step for undo, and show it again shortly. */
  function changed(what) {
    if (what === 'layers' || what === 'all') renderLayers();
    if (what === 'all') renderEditor();
    clearTimeout(snapTimer); snapTimer = setTimeout(pushHistory, 600);
    schedule();
  }
  let snapTimer = null;

  function pushHistory() {
    const now = JSON.stringify(recipe);
    if (lastSnapshot && lastSnapshot !== now) { history.push(lastSnapshot); if (history.length > 100) history.shift(); future = []; }
    lastSnapshot = now;
  }

  function undo(redo) {
    clearTimeout(snapTimer); pushHistory();
    const from = redo ? future : history, to = redo ? history : future;
    if (!from.length) return;
    to.push(JSON.stringify(recipe));
    recipe = JSON.parse(from.pop());
    lastSnapshot = JSON.stringify(recipe);
    selected = Math.max(0, Math.min(recipe.layers.length - 1, selected));
    renderAll(); schedule();
  }

  // ---------------------------------------------------------------- the preview

  function schedule() { clearTimeout(renderTimer); renderTimer = setTimeout(preview, 300); }

  async function preview() {
    if (!recipe || !recipe.model) { setStatus(model ? '' : 'Open a model (GLB or OBJ) to texture it: 📂 above, or a model from NoorForm.'); return; }
    const gen = ++renderGen;
    const version = paintVersion;
    setStatus('Texturing…');
    try {
      const r = await req('forge.render', { recipe, maskLayer: recipe.layers.length ? selected : -1 });
      if (gen !== renderGen) return;
      render = r;
      shownSet = Math.min(shownSet, r.sets.length - 1);
      if (viewer) {
        const res = await fetch(r.url);
        if (!res.ok) throw new Error('The textured model could not be loaded for the preview.');
        if (gen !== renderGen) return;
        await viewer.load(await res.arrayBuffer());
        if (version === paintVersion && !stroke) { overlay = null; viewer.setPaint(null); }
        await applyView(gen);
      }
      renderMaps();
      setStatus(`${r.sets.length} texture set${r.sets.length === 1 ? '' : 's'} · preview ${r.size} px (export ${recipe.size} px)${r.high ? ` · high-poly found on ${Math.round((r.high.hits / Math.max(1, r.high.texels)) * 100)}%` : ''} · ${(r.ms / 1000).toFixed(1)} s`);
      if (r.high && $('#fg-highhits')) $('#fg-highhits').textContent = `${Math.round((r.high.hits / Math.max(1, r.high.texels)) * 100)}% of the surface found it`;
      else if (r.high && tab === 'bake' && $('#fg-high')) renderEditor();
    } catch (err) { if (gen === renderGen) setStatus(err && err.message ? err.message : String(err)); }
  }

  /** Shows the chosen view: the lit model, its clay, or one channel's pictures on it. */
  async function applyView(gen = renderGen) {
    if (!viewer) return;
    if (view === 'shaded' || view === 'clay' || !render) { viewer.setChannel(null); viewer.setMode(view === 'clay' ? 'clay' : 'shaded'); return; }
    const bitmaps = await Promise.all(render.sets.map(async (set) => {
      const url = set.maps[view];
      if (!url) return null;
      try {
        const res = await fetch(url);
        return res.ok ? await createImageBitmap(await res.blob(), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) : null;
      } catch { return null; }
    }));
    if (gen !== renderGen) return;
    viewer.setChannel(bitmaps);
    viewer.setMode('channel');
  }

  /** What the 3D view shows (one of VIEWS). */
  function setView(v) { view = v; const s = $('#fg-view'); if (s) s.value = v; applyView(); }

  function setStatus(t) { const s = $('#fg-status'); if (s) s.textContent = t; }

  // ---------------------------------------------------------------- building

  function build() {
    built = true;
    const root = el('section', { id: 'forgebench', class: 'soundbench texbench assetbench forgebench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'NoorForge' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '🔥' }), el('strong', { text: 'NoorForge' }), el('small', { id: 'fg-model' })),
        el('span', { class: 'panel-head-buttons' },
          el('button', { class: 'icon-btn', id: 'fg-pick', title: 'Open a model to texture (GLB or OBJ)', 'aria-label': 'Open a model', onclick: pickModel }, '📂'),
          el('button', { class: 'icon-btn', id: 'fg-openrecipe', title: 'Open a NoorForge recipe (.noorforge.json)', 'aria-label': 'Open a recipe', onclick: openRecipe }, '📄'),
          NoorDock.fullButton('NoorForge'),
          el('button', { class: 'icon-btn', title: 'Where this panel goes', 'aria-label': 'Move NoorForge', onclick: (e) => NoorDock.showMenu('forge', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn', title: 'Close (Ctrl+Alt+F)', 'aria-label': 'Close NoorForge', onclick: close }, '✕'))),
      el('div', { class: 'sb-main' },
        el('nav', { class: 'sb-presets', id: 'fg-nav', 'aria-label': 'Smart materials' }),
        el('div', { class: 'sb-editor' },
          el('div', { class: 'sb-top', id: 'fg-top' },
            el('input', { type: 'text', id: 'fg-name', class: 'tb-name', 'aria-label': 'Name', spellcheck: 'false', maxlength: '80' }),
            el('label', { class: 'sb-inline', title: 'How big the exported textures are (the preview is at most 512)' }, el('span', { text: 'Textures' }), el('select', { id: 'fg-size', 'aria-label': 'Texture size' })),
            el('label', { class: 'sb-inline', title: 'Which engine the export is for: the maps\' names and how they are packed' }, el('span', { text: 'For' }), el('select', { id: 'fg-export-for', 'aria-label': 'Export for' })),
            el('label', { class: 'sb-inline', id: 'fg-atlas-wrap', title: 'Every texture set in one set of maps (one material), each in a cell of it' }, el('input', { type: 'checkbox', id: 'fg-atlas' }), el('span', { text: 'one atlas' })),
            el('label', { class: 'sb-inline', title: 'Smaller copies of the maps for the model\'s lower levels (named …_LOD1, …_LOD2)' }, el('span', { text: 'Smaller copies' }),
              el('select', { id: 'fg-lodcopies', 'aria-label': 'Smaller copies for lower levels' }, el('option', { value: '0', text: 'none' }), el('option', { value: '1', text: '½ (LOD1)' }), el('option', { value: '2', text: '½ and ¼ (LOD1, LOD2)' }))),
            el('button', { class: 'action primary', id: 'fg-export', title: 'Write the textures (each texture set: colour, normal, ORM, roughness, metallic, AO), the textured GLB and the recipe', onclick: exportAll }, '⤓ Export')),
          el('div', { class: 'tb-split', id: 'fg-split' },
            el('div', { class: 'tb-view-col', id: 'fg-view-col' },
              el('div', { class: 'tb-views', role: 'group', 'aria-label': 'Preview' },
                (() => { const s = el('select', { id: 'fg-view', 'aria-label': 'Show', title: 'The model lit, or one channel on it as it is' }, ...VIEWS.map(([v, t]) => el('option', { value: v, text: t }))); s.addEventListener('change', () => setView(s.value)); return s; })(),
                el('button', { class: 'icon-btn', id: 'fg-paint', title: 'Paint on the model (B) — into the chosen layer\'s mask', 'aria-label': 'Paint', 'aria-pressed': 'false', onclick: () => setTool(tool ? null : 'brush') }, '🖌'),
                el('span', { class: 'sb-fx-space' }),
                el('button', { class: 'icon-btn', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => viewer && viewer.zoom(1.2) }, '−'),
                el('button', { class: 'icon-btn', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => viewer && viewer.zoom(1 / 1.2) }, '+'),
                el('button', { class: 'icon-btn', title: 'Back to the whole model', 'aria-label': 'Reset the view', onclick: () => viewer && viewer.reset() }, '⟲'),
                el('button', { class: 'icon-btn', id: 'fg-side', title: 'The model big, the settings in a column on the right; or the settings under the model', 'aria-label': 'Settings beside the model', 'aria-pressed': 'false', onclick: () => layout.set({ side: !layout.prefs.side }) }, '◫'),
                el('button', { class: 'icon-btn', id: 'fg-list', title: 'Show or hide the list on the left', 'aria-label': 'The list', 'aria-pressed': 'true', onclick: () => layout.set({ list: !layout.prefs.list }) }, '☰')),
              el('div', { class: 'fg-brushbar', id: 'fg-brushbar', hidden: true }),
              el('div', { class: 'tb-stage fg-stage' }, el('canvas', { id: 'fg-stencil', class: 'fg-stencil', hidden: true, 'aria-hidden': 'true' }), el('canvas', { id: 'fg-canvas', class: 'tb-canvas', role: 'img', 'aria-label': 'The textured model: drag to turn it, wheel to zoom', title: 'Drag: turn · wheel: zoom · right-drag: move' })),
              el('p', { class: 'pref-hint sb-status', id: 'fg-status', 'aria-live': 'polite' }),
              el('div', { class: 'fg-maps', id: 'fg-maps' })),
            el('div', { class: 'tb-splitter', id: 'fg-splitter', role: 'separator', tabindex: '0', 'aria-label': 'Drag to share the room between the model and the settings (double-click: back to normal)' }),
            el('div', { class: 'tb-edit-col', id: 'fg-edit-col' },
              el('div', { class: 'music-tabs sb-tabs', id: 'fg-tabs', role: 'tablist' }),
              el('div', { class: 'sb-pane', id: 'fg-pane' }))))));
    ($('#app') || document.body).append(root);
    new ResizeObserver(() => { root.classList.toggle('wide', root.clientWidth >= 820); showStencil(); }).observe(root);
    layout = NoorBenchLayout.attach({ root, storageKey: 'noormd.forge.layout', defaults: { side: true }, split: $('#fg-split'), viewCol: $('#fg-view-col'), editCol: $('#fg-edit-col'),
      splitter: $('#fg-splitter'), sideButton: $('#fg-side'), listButton: $('#fg-list'), top: $('#fg-top'), sideSized: 'edit' });
    $('#fg-name').addEventListener('input', (e) => { recipe.name = e.target.value; changed(); titleChanged(); });
    $('#fg-size').addEventListener('change', (e) => { recipe.size = Number(e.target.value); changed(); });
    $('#fg-export-for').addEventListener('change', (e) => { recipe.export = e.target.value; changed(); renderAll(); });
    $('#fg-atlas').addEventListener('change', (e) => { recipe.atlas = e.target.checked; changed(); });
    $('#fg-lodcopies').addEventListener('change', (e) => { recipe.lodCopies = Number(e.target.value); changed(); });
    const stencilUp = () => { stencilKey = false; stencilDrag = null; root.classList.remove('fg-stencil-move'); };
    root.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === 's') stencilUp(); });
    window.addEventListener('blur', stencilUp);
    root.addEventListener('keydown', (e) => {
      const typing = e.target.closest('input[type=text], input[type=number], select, textarea');
      if (e.key === 'Escape' && !typing && tool) { e.preventDefault(); e.stopPropagation(); setTool(null); return; }
      if (e.key === 'Escape' && !typing && !document.body.classList.contains('zen')) { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        if (k === 's' && tool && stencil) { e.preventDefault(); stencilKey = true; $('#forgebench').classList.add('fg-stencil-move'); return; }
        if (k === 'b') { e.preventDefault(); setTool(tool === 'brush' && !erasing ? null : 'brush', false); return; }
        if (k === 'e' && tool) { e.preventDefault(); setTool('brush', !erasing); return; }
        if (k === 't' && tool) { e.preventDefault(); setTool('stamp'); return; }
        if ((k === '[' || k === ']') && tool) { e.preventDefault(); brushSize(k === ']' ? 1 : -1); return; }
      }
      if (k === 'z' && e.ctrlKey) { e.preventDefault(); undo(e.shiftKey); }
      else if (k === 'y' && e.ctrlKey) { e.preventDefault(); undo(true); }
    });
    if (window.NoorChrome && NoorChrome.registerBench) NoorChrome.registerBench('forge', { name: 'NoorForge', title: appTitle, menus: appMenus });
    try { viewer = NoorAssetView.create($('#fg-canvas')); } catch (err) { console.warn('NoorForge: no 3D preview', err); viewer = null; setStatus('The 3D preview needs WebGL 2. Exports still work.'); }
  }

  function renderAll() {
    if (!built || !recipe) return;
    $('#fg-name').value = recipe.name;
    $('#fg-size').replaceChildren(...lists.sizes.map((s) => el('option', { value: String(s), text: `${s} px` })));
    $('#fg-size').value = String(recipe.size);
    const exports = lists.exports || [{ id: 'godot', name: 'Godot 4', description: '' }];
    $('#fg-export-for').replaceChildren(...exports.map((x) => el('option', { value: x.id, text: x.name, title: x.description })));
    $('#fg-export-for').value = recipe.export || 'godot';
    $('#fg-atlas').checked = !!recipe.atlas;
    $('#fg-atlas-wrap').hidden = !model || model.sets.length < 2;
    $('#fg-lodcopies').value = String(recipe.lodCopies || 0);
    const preset = exports.find((x) => x.id === (recipe.export || 'godot'));
    $('#fg-export').title = `Write the textures (${preset ? preset.description : ''}), the textured GLB and the recipe`;
    $('#fg-model').textContent = model ? `${model.name} · ${model.triangles.toLocaleString()} triangles · ${model.sets.length} texture set${model.sets.length === 1 ? '' : 's'}` : 'no model yet';
    renderNav(); renderTabs(); renderEditor(); renderMaps();
    titleChanged();
  }

  const titleChanged = () => { if (window.NoorChrome && NoorChrome.benchChanged) NoorChrome.benchChanged(); };

  function renderNav() {
    const nav = $('#fg-nav');
    if (!nav) return;
    nav.replaceChildren(
      el('div', { class: 'sb-family' }, el('h4', { text: 'Model' }),
        el('button', { class: 'utility-btn fg-pickbig', onclick: pickModel }, model ? `🗿 ${model.name}` : '📂 Open a model…'),
        model && model.sets.some((s) => s.unwrapped) ? el('small', { class: 'pref-hint', text: 'Its UVs overlapped or were missing: NoorForge laid them out again (the export carries the new ones).' }) : null),
      el('div', { class: 'sb-family' }, el('h4', { text: 'Smart materials' }), ...lists.smart.filter((s) => !s.mine).map(smartButton)),
      el('div', { class: 'sb-family', id: 'fg-mine' }, el('h4', { text: 'Your smart materials' }),
        ...lists.smart.filter((s) => s.mine).map((s) => el('div', { class: 'fg-mine-row' }, smartButton(s),
          el('button', { class: 'icon-btn', title: `Remove “${s.name}”`, 'aria-label': `Remove ${s.name}`, 'data-delsmart': s.id, onclick: () => deleteSmart(s) }, '✕'))),
        el('button', { class: 'utility-btn', id: 'fg-savesmart', title: 'Keep these layers by name, to use on any model', disabled: !recipe || !recipe.layers.length || undefined, onclick: saveSmart }, '＋ Save these layers…')));
  }

  function smartButton(s) {
    return el('button', { class: 'sb-preset', 'data-smart': s.id, title: `${s.description ? s.description + ' ' : ''}(replaces the layers; Ctrl+Z brings them back)`, onclick: () => applySmart(s) }, s.name);
  }

  /** A smart material's layers in place of these (Ctrl+Z brings them back). */
  function applySmart(s) { recipe.layers = clone(s.layers); ensureIds(); selected = recipe.layers.length - 1; changed('all'); }

  async function saveSmart() {
    const name = await NoorUI.prompt('Save as a smart material', 'Name (the same name replaces one of yours):', recipe.name && !/^Textured model/.test(recipe.name) ? recipe.name : 'My material', { okLabel: 'Save' });
    if (!name || !name.trim()) return;
    try {
      const r = await req('forge.smart.save', { name: name.trim(), recipe });
      lists.smart = r.smart; renderNav();
      notice(`Saved “${name.trim()}” with your smart materials`, 2000);
    } catch (err) { hooks.showError(err); }
  }

  async function deleteSmart(s) {
    if (!await NoorUI.confirm('Remove this smart material?', `“${s.name}” is removed from your smart materials (models textured with it keep their textures).`, 'Remove')) return;
    try { const r = await req('forge.smart.delete', { id: s.id }); lists.smart = r.smart; renderNav(); } catch (err) { hooks.showError(err); }
  }

  function showTab(id) { tab = id; renderTabs(); renderEditor(); }

  function renderTabs() {
    $('#fg-tabs').replaceChildren(...[['layers', 'Layers'], ['bake', 'Model & bakes']].map(([id, label]) =>
      el('button', { role: 'tab', 'data-tab': id, class: id === tab ? 'active' : '', 'aria-selected': String(id === tab), onclick: () => showTab(id) }, label)));
  }

  function renderEditor() {
    const pane = $('#fg-pane');
    if (!pane || !recipe) return;
    pane.replaceChildren(...(tab === 'bake' ? bakePane() : layersPane()).filter(Boolean));
    keepFocus();
  }

  /** A redrawn part keeps the keyboard in the bench (Ctrl+Z here undoes here, not in the document). */
  function keepFocus() { if (isOpen() && (document.activeElement === document.body || !document.activeElement)) $('#forgebench').focus({ preventScroll: true }); }

  function renderMaps() {
    const box = $('#fg-maps');
    if (!box) return;
    if (!render) { box.replaceChildren(); return; }
    const set = render.sets[shownSet];
    const pick = render.sets.length > 1 ? el('select', { id: 'fg-set', 'aria-label': 'Texture set' }, ...render.sets.map((s, i) => el('option', { value: String(i), text: s.name }))) : null;
    if (pick) { pick.value = String(shownSet); pick.addEventListener('change', () => { shownSet = Number(pick.value); renderMaps(); }); }
    box.replaceChildren(...(pick ? [pick] : []), ...MAPS.filter(([m]) => set.maps[m]).map(([m, label]) => el('figure', { class: 'fg-map', 'data-map': m },
      el('img', { src: set.maps[m], alt: label, loading: 'lazy' }), el('figcaption', { text: label }))));
  }

  // ---------------------------------------------------------------- layers

  function slider(obj, key, label, min, max, step, after) {
    const box = el('input', { type: 'number', class: 'sb-num', value: String(obj[key]), step: String(step), min: String(min), max: String(max), 'aria-label': label, 'data-num': key });
    const range = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(obj[key]), 'aria-label': label, 'data-key': key });
    const set = (v) => { obj[key] = Math.max(min, Math.min(max, Number(v))); range.value = box.value = String(obj[key]); changed(after); };
    range.addEventListener('input', () => set(range.value));
    box.addEventListener('change', () => set(box.value));
    return el('label', { class: 'sb-slider' }, el('span', { text: label }), range, el('span', { class: 'sb-numwrap' }, box));
  }

  /** The layer to edit (and to paint into): its mask is asked for with the preview. */
  function selectLayer(i) { selected = i; renderLayers(); renderLayerEditor(); renderBrushBar(); schedule(); }

  function renderLayers() {
    const list = $('#fg-layers');
    if (!list) return;
    // Top of the stack first, as in a painting program.
    list.replaceChildren(...recipe.layers.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => el('div', { class: 'fg-layer' + (i === selected ? ' sel' : '') + (l.visible ? '' : ' off'), 'data-layer': String(i), role: 'button', tabindex: '0',
      onclick: () => selectLayer(i) }, // its mask, shown
      el('button', { class: 'icon-btn', 'aria-pressed': String(l.visible), title: l.visible ? 'Shown (click to hide)' : 'Hidden (click to show)', 'aria-label': `Show ${l.name}`, onclick: (e) => { e.stopPropagation(); l.visible = !l.visible; changed('layers'); } }, l.visible ? '👁' : '◌'),
      el('span', { class: 'fg-swatch', style: `background:${l.material ? 'linear-gradient(135deg,#777,#bbb)' : l.color}` }),
      el('span', { class: 'fg-layername', text: l.name }),
      el('small', { text: l.mask.kind === 'all' ? '' : MASKS[l.mask.kind].split(' (')[0] }))));
    keepFocus();
  }

  /** A new layer above the chosen one: a material, a plain colour, or paint (a colour shown only where painted). */
  function addLayer(material, painted) {
    if (recipe.layers.length >= 32) return;
    const l = { id: newId(), name: material ? 'Material' : painted ? 'Paint' : 'Colour', visible: true, opacity: 1, material: material ? (lists.materials[0] || {}).id || '' : '', scale: 1, color: material ? '#808080' : '#a0a0a0', roughness: 0.7, metallic: 0,
      height: 0.5, useColor: true, useRoughness: true, useMetallic: true, useNormal: true, useHeight: true, normalStrength: 1, mask: { kind: painted ? 'none' : 'all', amount: 0.5, softness: 0.3, invert: false, noise: 0.3, noiseScale: 0.25, index: 0 }, strokes: [] };
    recipe.layers.splice(selected + 1, 0, l); selected = recipe.layers.indexOf(l); changed('all');
  }
  /** The chosen layer up (1) or down (−1) the stack. */
  function moveLayer(d) { const j = selected + d; if (j < 0 || j >= recipe.layers.length) return; [recipe.layers[selected], recipe.layers[j]] = [recipe.layers[j], recipe.layers[selected]]; selected = j; changed('all'); }
  function removeLayer() { if (!recipe.layers.length) return; recipe.layers.splice(selected, 1); selected = Math.max(0, selected - 1); changed('all'); }

  function layersPane() {
    const add = addLayer, move = moveLayer;
    const out = [
      el('div', { class: 'sb-row' },
        el('button', { class: 'utility-btn', id: 'fg-addmat', disabled: recipe.layers.length >= 32 || undefined, onclick: () => add(true) }, '＋ Material layer'),
        el('button', { class: 'utility-btn', id: 'fg-addplain', disabled: recipe.layers.length >= 32 || undefined, onclick: () => add(false) }, '＋ Colour layer'),
        el('button', { class: 'utility-btn', id: 'fg-addpaint', title: 'A colour layer shown only where you paint it, with the brush ready', disabled: recipe.layers.length >= 32 || undefined, onclick: () => { add(false, true); setTool('brush', false); } }, '＋ Paint layer'),
        el('button', { class: 'icon-btn', title: 'Up the stack', 'aria-label': 'Move up', onclick: () => move(1) }, '↑'),
        el('button', { class: 'icon-btn', title: 'Down the stack', 'aria-label': 'Move down', onclick: () => move(-1) }, '↓'),
        el('button', { class: 'icon-btn', id: 'fg-dellayer', title: 'Remove this layer (Ctrl+Z brings it back)', 'aria-label': 'Remove the layer', disabled: !recipe.layers.length || undefined, onclick: removeLayer }, '🗑')),
      el('div', { class: 'fg-layers', id: 'fg-layers', 'aria-label': 'Layers, top first' }),
      el('div', { id: 'fg-layeredit' })];
    requestAnimationFrame(() => { renderLayers(); renderLayerEditor(); });
    return out;
  }

  function renderLayerEditor() {
    const box = $('#fg-layeredit');
    if (!box) return;
    const l = recipe.layers[selected];
    if (!l) { box.replaceChildren(el('p', { class: 'pref-hint', text: 'No layers: add one, or choose a smart material on the left.' })); return; }
    const name = el('input', { type: 'text', value: l.name, maxlength: '40', 'aria-label': 'Layer name', id: 'fg-layername' });
    name.addEventListener('input', () => { l.name = name.value; renderLayers(); changed(); });
    const families = new Map();
    for (const m of lists.materials) { if (!families.has(m.family)) families.set(m.family, []); families.get(m.family).push(m); }
    const mat = el('select', { id: 'fg-material', 'aria-label': 'Material' }, el('option', { value: '', text: '— none: a plain colour —' }),
      ...[...families].map(([f, ms]) => el('optgroup', { label: f }, ...ms.map((m) => el('option', { value: m.id, text: m.name })))));
    mat.value = l.material;
    mat.addEventListener('change', () => { l.material = mat.value; if (/^(Material|Colour)$/.test(l.name) && mat.value) l.name = mat.selectedOptions[0].text; changed('all'); });
    const color = el('input', { type: 'color', id: 'fg-color', value: l.color, 'aria-label': l.material ? 'Tint' : 'Colour' });
    color.addEventListener('input', () => { l.color = color.value; renderLayers(); changed(); });
    const check = (key, label) => { const c = el('input', { type: 'checkbox', checked: l[key] || undefined, 'data-use': key }); c.addEventListener('change', () => { l[key] = c.checked; changed(); }); return el('label', { class: 'sb-inline' }, c, el('span', { text: label })); };
    const m = l.mask;
    const kind = el('select', { id: 'fg-maskkind', 'aria-label': 'Where the layer shows' }, ...Object.entries(MASKS).map(([k, t]) => el('option', { value: k, text: t })));
    kind.value = m.kind;
    kind.addEventListener('change', () => { m.kind = kind.value; changed('all'); });
    const invert = el('input', { type: 'checkbox', id: 'fg-maskinvert', checked: m.invert || undefined });
    invert.addEventListener('change', () => { m.invert = invert.checked; changed(); });
    // A layer below to follow ("layer"), or for drips to run down from.
    const below = recipe.layers.slice(0, selected);
    const follow = m.kind === 'layer' || m.kind === 'drips'
      ? (() => {
        const s = el('select', { id: 'fg-masklayer', 'aria-label': m.kind === 'layer' ? 'Which layer' : 'Drips from' },
          ...(m.kind === 'drips' ? [el('option', { value: '', text: 'worn top edges' })] : below.length ? [] : [el('option', { value: '', text: '— no layer below —' })]),
          ...below.map((b) => el('option', { value: b.id, text: b.name })));
        if (m.kind === 'layer' && !below.some((b) => b.id === m.layer) && below.length) m.layer = below[below.length - 1].id;
        s.value = m.layer || '';
        s.addEventListener('change', () => { m.layer = s.value; changed(); });
        return el('label', { class: 'sb-inline' }, el('span', { text: m.kind === 'layer' ? 'Layer' : 'From' }), s);
      })() : null;
    const ring = m.kind === 'layer' ? (() => { const c = el('input', { type: 'checkbox', id: 'fg-maskring', checked: m.ring || undefined }); c.addEventListener('change', () => { m.ring = c.checked; changed(); }); return el('label', { class: 'sb-inline', title: 'Only the spread around that mask (a rim), not the mask itself' }, c, el('span', { text: 'only a rim around it' })); })() : null;
    if (m.spread === undefined) m.spread = 0;
    if (m.length === undefined) m.length = 0.3;
    if (m.layer === undefined) m.layer = '';
    const which = m.kind === 'part' || m.kind === 'material'
      ? (() => {
        const names = model ? (m.kind === 'part' ? model.parts : model.sets.map((s) => s.name)) : [];
        const s = el('select', { id: 'fg-maskindex', 'aria-label': m.kind === 'part' ? 'Which part' : 'Which material' }, ...names.map((n, i) => el('option', { value: String(i), text: n })));
        s.value = String(m.index); s.addEventListener('change', () => { m.index = Number(s.value); changed(); });
        return el('label', { class: 'sb-inline' }, el('span', { text: m.kind === 'part' ? 'Part' : 'Material' }), s);
      })() : null;
    const shaped = !['all', 'none', 'part', 'material'].includes(m.kind);
    box.replaceChildren(...[
      el('h4', { class: 'music-subhead', text: 'Layer' }),
      el('div', { class: 'sb-row' }, name, el('label', { class: 'sb-inline' }, el('span', { text: 'Material' }), mat), el('label', { class: 'sb-inline', title: l.material ? 'A tint over the material (grey leaves it as it is)' : 'The layer\'s colour' }, el('span', { text: l.material ? 'Tint' : 'Colour' }), color)),
      el('div', { class: 'sb-fields' }, slider(l, 'opacity', 'Opacity', 0, 1, 0.01),
        ...(l.material ? [slider(l, 'scale', 'Size of one tile (m)', 0.05, 20, 0.05), slider(l, 'normalStrength', 'Relief', 0, 3, 0.05)] : [slider(l, 'roughness', 'Roughness', 0, 1, 0.01), slider(l, 'metallic', 'Metal', 0, 1, 0.01), slider(l, 'height', 'Height (mid: flat)', 0, 1, 0.01)])),
      el('div', { class: 'sb-row' }, el('span', { class: 'pref-hint', text: 'Paints:' }), check('useColor', 'colour'), check('useRoughness', 'roughness'), check('useMetallic', 'metal'), ...(l.material ? [check('useNormal', 'relief')] : []), check('useHeight', 'height')),
      el('h4', { class: 'music-subhead', text: 'Where it shows (smart mask)' }),
      (l.strokes || []).length ? el('div', { class: 'sb-row', id: 'fg-strokes' },
        el('span', { class: 'pref-hint', text: `Painted: ${l.strokes.length} stroke${l.strokes.length === 1 ? '' : 's'} (${l.strokes.filter((st) => st.erase).length} erasing)` }),
        el('button', { class: 'utility-btn', id: 'fg-clearpaint', title: 'Remove this layer\'s painting (Ctrl+Z brings it back)', onclick: () => { l.strokes = []; paintVersion++; changed('all'); } }, '✕ Clear the painting')) : null,
      el('div', { class: 'sb-row' }, kind, which, follow, el('label', { class: 'sb-inline' }, invert, el('span', { text: m.kind === 'layer' ? 'Where that layer isn\'t' : 'Everywhere else instead' })), ring),
      shaped ? el('div', { class: 'sb-fields' }, slider(m, 'amount', 'Amount', 0, 1, 0.01), slider(m, 'softness', 'Softness', 0, 1, 0.01),
        ...(m.kind === 'layer' ? [slider(m, 'spread', 'Spread (m)', 0, 0.5, 0.005)] : []),
        ...(m.kind === 'drips' ? [slider(m, 'length', 'Length (m)', 0.01, 3, 0.01)] : []),
        slider(m, 'noise', m.kind === 'chips' ? 'Chunkiness' : m.kind === 'drips' ? 'Streaks' : 'Break up with noise', 0, 1, 0.01),
        slider(m, 'noiseScale', m.kind === 'chips' ? 'Chip size (m)' : m.kind === 'drips' ? 'Streak width (m)' : 'Noise size (m)', 0.005, 5, 0.005)) : null].filter(Boolean));
    keepFocus();
  }

  function bakePane() {
    return [
      el('h4', { class: 'music-subhead', text: 'Model' }),
      model ? el('div', { class: 'fg-modelinfo', id: 'fg-modelinfo' },
        el('p', { text: `${model.name}: ${model.triangles.toLocaleString()} triangles, about ${model.size.map((v) => v.toFixed(2)).join(' × ')} m` }),
        el('ul', {}, ...model.sets.map((s) => el('li', { text: `${s.name}: ${s.triangles.toLocaleString()} triangles${s.unwrapped ? ' · UVs laid out by NoorForge' : ''}` }))),
        el('p', { class: 'pref-hint', text: `Parts: ${model.parts.join(', ')}` })) : el('p', { class: 'pref-hint', text: 'No model yet.' }),
      el('button', { class: 'utility-btn', onclick: pickModel }, '📂 Open another model…'),
      fromAsset && fromAsset.levels > 1 && recipe.model && recipe.model.includes(fromAsset.name) ? el('label', { class: 'sb-inline', title: 'Which of NoorForm\'s levels to texture: a lower one gets the closest baked onto it' }, el('span', { text: 'NoorForm level' }),
        (() => {
          const s = el('select', { id: 'fg-asset-level', 'aria-label': 'NoorForm level' }, ...Array.from({ length: fromAsset.levels }, (_, i) => el('option', { value: String(i), text: i === 0 ? 'the closest (LOD0)' : `LOD${i}, with LOD0 baked onto it` })));
          s.value = String(fromAsset.level);
          s.addEventListener('change', () => openAsset(fromAsset.key, fromAsset.name, null, Number(s.value)));
          return s;
        })()) : null,
      el('h4', { class: 'music-subhead', text: 'High-poly model (its detail baked onto this one)' }),
      el('div', { class: 'sb-row', id: 'fg-high' },
        el('button', { class: 'utility-btn', id: 'fg-highpick', title: 'A dense model of the same thing: its normals, curvature and occlusion are baked onto this one', onclick: pickHigh }, recipe.highModel ? `🗿 ${highName || recipe.highModel.split(/[\\/]/).pop()}` : '📂 Choose a high-poly model…'),
        recipe.highModel ? el('button', { class: 'icon-btn', id: 'fg-highclear', title: 'Bake from this model alone again', 'aria-label': 'No high-poly model', onclick: () => { recipe.highModel = null; highName = ''; changed('all'); } }, '✕') : null,
        recipe.highModel && render && render.high ? el('span', { class: 'pref-hint', id: 'fg-highhits', text: `${Math.round((render.high.hits / Math.max(1, render.high.texels)) * 100)}% of the surface found it` }) : null),
      recipe.highModel ? el('div', { class: 'sb-fields' }, slider(recipe, 'highDistance', 'How far to look for it (share of the model)', 0.001, 0.2, 0.001)) : null,
      el('h4', { class: 'music-subhead', text: 'Bakes (what the smart masks read)' }),
      el('div', { class: 'sb-fields' },
        slider(recipe, 'aoRays', 'Ambient occlusion rays (more: smoother, slower)', 0, 128, 1),
        slider(recipe, 'aoDistance', 'How far occlusion reaches (share of the model)', 0.01, 1, 0.01),
        slider(recipe, 'edgeWidth', 'How wide edges and creases are (share of the model)', 0, 0.2, 0.002)),
    ];
  }

  // ---------------------------------------------------------------- painting (stage 2)

  const modelSize = () => (model ? Math.max(...model.size, 0.01) : 1);
  const radius = () => (brush.size / 100) * modelSize();
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const pictures = () => (recipe.pictures = recipe.pictures || []);

  /** A tip or stencil's greyscale (a NoorForge tip, or a picture of the recipe), decoded once. */
  function gray(id) {
    if (!id) return null;
    if (grays.has(id)) return grays.get(id);
    const p = (lists.tips || []).find((t) => t.id === id) || pictures().find((t) => t.id === id);
    if (!p) return null;
    const bin = atob(p.data), g = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) g[i] = bin.charCodeAt(i);
    const out = { w: p.width, h: p.height, g };
    grays.set(id, out);
    return out;
  }

  /** As ForgePicture.Sample: bilinear, 0 outside (or repeating). */
  function sample(pic, u, v, tile) {
    if (tile) { u -= Math.floor(u); v -= Math.floor(v); } else if (u < 0 || v < 0 || u > 1 || v > 1) return 0;
    const fx = u * pic.w - 0.5, fy = v * pic.h - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const X = (x) => (tile ? ((x % pic.w) + pic.w) % pic.w : Math.max(0, Math.min(pic.w - 1, x))), Y = (y) => (tile ? ((y % pic.h) + pic.h) % pic.h : Math.max(0, Math.min(pic.h - 1, y)));
    const at = (x, y) => pic.g[Y(y) * pic.w + X(x)] / 255;
    return (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay;
  }

  /** As ForgePaint.Hash: a dab's random number 0–1. */
  function hash(i, seed) {
    let x = (Math.imul(i, 0x9E3779B1) + Math.imul(seed, 0x85EBCA77)) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0; x = Math.imul(x, 0x2C1B3C6D) >>> 0; x = (x ^ (x >>> 12)) >>> 0;
    return x / 4294967296;
  }

  /** As ForgePaint.ScreenAxes. */
  function screenAxes(v) {
    let r = [-v[2], 0, v[0]]; // view × up
    const l = Math.hypot(r[0], r[2]);
    r = l < 1e-4 ? [1, 0, 0] : [r[0] / l, 0, r[2] / l];
    return { right: r, up: [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]] };
  }

  /**
   * Where the stencil lies now, as three rows taking a point on the model to its u·w, v·w and w (ForgeStencil.Rows):
   * the camera's view-projection, then the stencil's place, size and turn on the canvas.
   */
  function stencilRows() {
    const cam = viewer.camera(), m = cam.viewProj, pic = gray(stencil.id);
    const rx = [m[0], m[4], m[8], m[12]], ry = [m[1], m[5], m[9], m[13]], rw = [m[3], m[7], m[11], m[15]];
    const cx = (2 * stencil.fx - 1) * cam.aspect, cy = 1 - 2 * stencil.fy, sz = 2 * stencil.size, a = pic.w / pic.h;
    const th = -stencil.angle * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
    const P = rx.map((v, k) => cam.aspect * v - cx * rw[k]), Q = ry.map((v, k) => v - cy * rw[k]);
    const ru = rw.map((w, k) => 0.5 * w + (c * P[k] + sn * Q[k]) / (sz * a));
    const rv = rw.map((w, k) => 0.5 * w - (-sn * P[k] + c * Q[k]) / sz);
    return [...ru, ...rv, ...rw].map((v) => +v.toPrecision(7));
  }

  /** The rows for the mirrored side: x taken to 2·centre − x first. */
  const mirrorRows = (rows, c) => [0, 4, 8].flatMap((o) => [-rows[o], rows[o + 1], rows[o + 2], +(rows[o + 3] + 2 * c * rows[o]).toPrecision(7)]);

  function stencilAt(st, x, y, z) {
    const r = st.stencil.rows, w = r[8] * x + r[9] * y + r[10] * z + r[11];
    if (w <= 1e-6) return 0;
    const u = (r[0] * x + r[1] * y + r[2] * z + r[3]) / w, v = (r[4] * x + r[5] * y + r[6] * z + r[7]) / w;
    const val = sample(st.stencilPic, u, v, st.stencil.tile);
    return st.stencil.invert ? (st.stencil.tile || (u >= 0 && v >= 0 && u <= 1 && v <= 1) ? 1 - val : 0) : val;
  }

  /** The stencil drawn over the view, where it lies. */
  function showStencil() {
    const box = $('#fg-stencil');
    if (!box) return;
    const pic = stencil && stencil.shown ? gray(stencil.id) : null;
    box.hidden = !tool || !pic;
    if (box.hidden) return;
    const stage = $('#fg-canvas').getBoundingClientRect(), holder = box.parentElement.getBoundingClientRect();
    const h = stencil.size * stage.height, w = h * (pic.w / pic.h);
    if (box.dataset.id !== stencil.id + (stencil.invert ? '-i' : '')) {
      box.dataset.id = stencil.id + (stencil.invert ? '-i' : '');
      box.width = pic.w; box.height = pic.h;
      const img = box.getContext('2d').createImageData(pic.w, pic.h);
      for (let i = 0; i < pic.g.length; i++) { const v = stencil.invert ? 255 - pic.g[i] : pic.g[i]; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
      box.getContext('2d').putImageData(img, 0, 0);
    }
    Object.assign(box.style, { width: `${w}px`, height: `${h}px`, left: `${stage.left - holder.left + stencil.fx * stage.width - w / 2}px`, top: `${stage.top - holder.top + stencil.fy * stage.height - h / 2}px`, transform: `rotate(${stencil.angle}deg)`, opacity: String(stencil.opacity) });
  }

  /** A picture as a tip or stencil: read by the app, kept in the recipe. */
  async function pickPicture(purpose) {
    try {
      const r = await req('forge.picture.pick', { purpose });
      if (!r || r.cancelled) return null;
      if (pictures().length >= 24) { notice('A recipe keeps at most 24 pictures: remove one first', 2400); return null; }
      clearTimeout(snapTimer); pushHistory();
      pictures().push(r.picture);
      pushHistory();
      return r.picture;
    } catch (err) { hooks.showError(err); return null; }
  }

  const usedPicture = (id) => recipe.layers.some((l) => (l.strokes || []).some((st) => st.tip === id || (st.stencil && st.stencil.picture === id)));

  function removePicture(id) {
    if (usedPicture(id)) { notice('Strokes use that picture: clear them first', 2200); return; }
    clearTimeout(snapTimer); pushHistory();
    recipe.pictures = pictures().filter((p) => p.id !== id);
    pushHistory();
    grays.delete(id);
    if (brush.tip === id) brush.tip = '';
    if (stencil && stencil.id === id) stencil = null;
    renderBrushBar(); showStencil();
  }

  /** The brush a step bigger (1) or smaller (−1). */
  const brushSize = (d) => setBrush('size', Math.max(0.2, Math.min(25, +(brush.size * (d > 0 ? 1.2 : 1 / 1.2)).toFixed(2))));

  function setBrush(key, value) {
    brush[key] = value;
    try { localStorage.setItem('noormd.forge.brush', JSON.stringify(brush)); } catch { /* not kept */ }
    renderBrushBar();
  }

  /** The brush on and off ('brush' or 'fill'; erasing for the brush), the mouse given to it or back to turning. */
  function setTool(t, erase = erasing) {
    if (t && !recipe.model) { notice('Open a model first', 1800); return; }
    if (t && !recipe.layers.length) { notice('Add a layer to paint into first', 1800); return; }
    tool = t; erasing = !!t && t === 'brush' && erase;
    $('#fg-paint').setAttribute('aria-pressed', String(!!tool));
    $('#forgebench').classList.toggle('fg-painting', !!tool);
    if (viewer) { viewer.setPainter(tool ? PAINTER : null); if (!tool) viewer.setBrush(null); }
    if (tool) ensureTexels();
    renderBrushBar();
    showStencil();
  }

  function renderBrushBar() {
    const bar = $('#fg-brushbar');
    if (!bar) return;
    bar.hidden = !tool;
    if (!tool) { bar.replaceChildren(); return; }
    const layer = recipe.layers[selected];
    const toolBtn = (id, label, title, on, click) => el('button', { class: 'icon-btn', id, title, 'aria-label': title, 'aria-pressed': String(on), onclick: click }, label);
    const num = (key, label, min, max, step, title) => {
      const r = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(brush[key]), 'aria-label': label, 'data-brush': key });
      r.addEventListener('input', () => { brush[key] = Number(r.value); try { localStorage.setItem('noormd.forge.brush', JSON.stringify(brush)); } catch { /* not kept */ } r.nextSibling.textContent = fmt(key); });
      return el('label', { class: 'fg-bnum', title }, el('span', { text: label }), r, el('small', { text: fmt(key) }));
    };
    const fmt = (key) => (key === 'size' ? `${brush.size}%` : key === 'angle' ? `${brush.angle}°` : `${Math.round(brush[key] * 100)}%`);
    const check = (key, label, title) => { const c = el('input', { type: 'checkbox', checked: brush[key] || undefined, 'data-brush': key }); c.addEventListener('change', () => setBrush(key, c.checked)); return el('label', { class: 'sb-inline', title }, c, el('span', { text: label })); };
    const tools = [
      toolBtn('fg-tool-brush', '🖌', 'Brush (B): paint the layer in', tool === 'brush' && !erasing, () => setTool('brush', false)),
      toolBtn('fg-tool-erase', '🧽', 'Eraser (E): take the layer away (its smart mask too)', tool === 'brush' && erasing, () => setTool('brush', true)),
      toolBtn('fg-tool-fill', '🪣', 'Fill a part: click it', tool === 'fill', () => setTool('fill')),
      toolBtn('fg-tool-stamp', '🏷', 'Stamp a decal (T): a picture or text, placed where you click', tool === 'stamp', () => setTool('stamp'))];
    if (tool === 'stamp') {
      bar.replaceChildren(el('div', { class: 'sb-row' }, ...tools, ...stampControls()), el('div', { class: 'sb-row' },
        el('span', { class: 'pref-hint fg-into', text: layer ? `Click the model to place it in “${layer.name}” · Alt+drag turns the model` : 'Choose a layer' }),
        texelsLoading ? el('span', { class: 'pref-hint', text: 'Getting ready…' }) : null));
      drawStamp(); showStencil(); keepFocus();
      return;
    }
    bar.replaceChildren(
      el('div', { class: 'sb-row' },
        ...tools,
        num('size', 'Size', 0.2, 25, 0.1, 'The brush\'s size, a share of the model ([ and ])'),
        num('hardness', 'Hardness', 0, 1, 0.01, 'How much of the brush paints fully before it fades'),
        num('flow', 'Flow', 0.02, 1, 0.01, 'How much each dab adds (going over builds it up)'),
        num('spacing', 'Spacing', 0.05, 1, 0.01, 'How far apart the dabs are, a share of the brush')),
      el('div', { class: 'sb-row' },
        el('span', { class: 'pref-hint', text: 'Pen pressure:' }), check('pressureSize', 'size', 'A pen\'s pressure makes the brush smaller'), check('pressureFlow', 'flow', 'A pen\'s pressure makes the paint lighter'),
        check('mirror', 'Mirror across X', 'Paint the other side too (mirrored across the model\'s middle, left to right)'),
        el('span', { class: 'pref-hint fg-into', text: layer ? `Into “${layer.name}” · Alt+drag turns the model · Shift+click: a straight line` : 'Choose a layer' }),
        texelsLoading ? el('span', { class: 'pref-hint', text: 'Getting ready…' }) : null),
      tipRow(num), stencilRow(check));
    drawTip();
    showStencil();
    keepFocus();
  }

  // ---- the stamp: a decal (a picture of the recipe, or text made into one) placed where you click
  const STAMP_DEFAULTS = { picture: '', size: 12, angle: 0, facing: 'surface', font: 'sans', bold: true };
  let stamp = (() => { try { return { ...STAMP_DEFAULTS, ...JSON.parse(localStorage.getItem('noormd.forge.stamp') || '{}') }; } catch { return { ...STAMP_DEFAULTS }; } })();
  const setStamp = (key, value) => { stamp[key] = value; try { localStorage.setItem('noormd.forge.stamp', JSON.stringify(stamp)); } catch { /* not kept */ } renderBrushBar(); };
  const FONTS = { sans: 'Segoe UI, Arial, sans-serif', serif: 'Georgia, Times New Roman, serif', mono: 'Consolas, Courier New, monospace', hand: 'Segoe Print, Comic Sans MS, cursive', stencil: 'Impact, Arial Black, sans-serif' };

  function stampControls() {
    const decals = pictures().filter((p) => p.id[0] === 'd');
    if (stamp.picture && !decals.some((p) => p.id === stamp.picture)) stamp.picture = '';
    if (!stamp.picture && decals.length) stamp.picture = decals[decals.length - 1].id;
    const sel = el('select', { id: 'fg-stamp-pick', 'aria-label': 'Decal' }, ...(decals.length ? [] : [el('option', { value: '', text: '— none yet —' })]),
      ...decals.map((p) => el('option', { value: p.id, text: p.name })), el('option', { value: '+', text: 'A picture…' }), el('option', { value: 'T', text: 'Text…' }));
    sel.value = stamp.picture;
    sel.addEventListener('change', async () => {
      if (sel.value === '+') { const p = await pickPicture('decal'); setStamp('picture', p ? p.id : stamp.picture); return; }
      if (sel.value === 'T') { const p = await textDecal(); setStamp('picture', p ? p.id : stamp.picture); return; }
      setStamp('picture', sel.value);
    });
    const range = (key, label, min, max, step, unit, title) => {
      const r = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(stamp[key]), 'aria-label': label, 'data-stamp': key });
      r.addEventListener('input', () => { stamp[key] = Number(r.value); r.nextSibling.textContent = `${stamp[key]}${unit}`; try { localStorage.setItem('noormd.forge.stamp', JSON.stringify(stamp)); } catch { /* not kept */ } });
      return el('label', { class: 'fg-bnum', title }, el('span', { text: label }), r, el('small', { text: `${stamp[key]}${unit}` }));
    };
    const facing = el('select', { id: 'fg-stamp-facing', 'aria-label': 'Facing' }, el('option', { value: 'surface', text: 'flat on the surface' }), el('option', { value: 'view', text: 'as you look at it' }));
    facing.value = stamp.facing;
    facing.addEventListener('change', () => setStamp('facing', facing.value));
    const font = el('select', { id: 'fg-stamp-font', 'aria-label': 'Font for text' }, ...Object.keys(FONTS).map((f) => el('option', { value: f, text: { sans: 'Sans', serif: 'Serif', mono: 'Mono', hand: 'Handwriting', stencil: 'Bold block' }[f] })));
    font.value = stamp.font;
    font.addEventListener('change', () => setStamp('font', font.value));
    return [
      el('label', { class: 'sb-inline', title: 'What to stamp: a picture (its shape where transparent, else its brightness) or text' }, el('span', { text: 'Decal' }), sel),
      el('canvas', { id: 'fg-stampview', class: 'fg-tipview fg-stampview', width: '80', height: '40', 'aria-hidden': 'true' }),
      stamp.picture ? el('button', { class: 'icon-btn', title: 'Remove this decal from the recipe', 'aria-label': 'Remove the decal picture', onclick: () => removePicture(stamp.picture) }, '✕') : null,
      range('size', 'Size', 0.5, 100, 0.5, '%', 'Its height, a share of the model'),
      range('angle', 'Angle', 0, 359, 1, '°', 'Its turn, clockwise'),
      el('label', { class: 'sb-inline', title: 'Flat on the surface where you click, or projected as you look at it' }, el('span', { text: 'Lies' }), facing),
      el('label', { class: 'sb-inline', title: 'The font for “Text…”' }, el('span', { text: 'Font' }), font)];
  }

  function drawStamp() {
    const c = $('#fg-stampview');
    if (!c) return;
    const ctx = c.getContext('2d'), pic = gray(stamp.picture), img = ctx.createImageData(80, 40);
    if (pic) {
      const k = Math.min(80 / pic.w, 40 / pic.h), w = pic.w * k, h = pic.h * k;
      for (let y = 0; y < 40; y++) for (let x = 0; x < 80; x++) {
        const u = (x + 0.5 - (80 - w) / 2) / w, v = (y + 0.5 - (40 - h) / 2) / h, o = (y * 80 + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 235; img.data[o + 3] = Math.round(sample(pic, u, v) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Text as a decal: drawn here (white on nothing), kept in the recipe as a picture like any other. */
  async function textDecal() {
    const text = await NoorUI.prompt('Text decal', 'The text to place on the model:', '', { okLabel: 'Make it' });
    if (!text || !text.trim()) return null;
    if (pictures().length >= 24) { notice('A recipe keeps at most 24 pictures: remove one first', 2400); return null; }
    const pic = textPicture(text.trim(), FONTS[stamp.font] || FONTS.sans, stamp.bold);
    clearTimeout(snapTimer); pushHistory();
    pictures().push(pic);
    pushHistory();
    return pic;
  }

  /**
   * A picture from another bench (NoorSprite's frame) as a decal: greyscale, white paints ({ name, width, height,
   * data: base64 of a byte a pixel }); chosen for the stamp tool.
   */
  async function addPicture(pic) {
    await open();
    if (pictures().length >= 24) { notice('A recipe keeps at most 24 pictures: remove one first', 2400); return null; }
    if (!pic || !(pic.width >= 1 && pic.width <= 1024 && pic.height >= 1 && pic.height <= 1024)) return null;
    const p = { id: 'd' + Math.random().toString(36).slice(2, 12), name: String(pic.name || 'Picture').slice(0, 60), width: pic.width, height: pic.height, data: pic.data };
    clearTimeout(snapTimer); pushHistory();
    pictures().push(p);
    pushHistory();
    stamp.picture = p.id;
    notice(`${p.name}: a decal for the stamp tool`, 2000);
    return p;
  }

  /** Text drawn into a greyscale picture (one line per line of text, centred), at most 1024 across. */
  function textPicture(text, family, bold) {
    const lines = text.split(/\r?\n/).slice(0, 6), size = 160, pad = 16;
    const c = document.createElement('canvas'), ctx = c.getContext('2d');
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${family}`;
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
    const scale = Math.min(1, (1024 - pad * 2) / width, (1024 - pad * 2) / (lines.length * size * 1.15));
    c.width = Math.max(1, Math.ceil(width * scale + pad * 2)); c.height = Math.max(1, Math.ceil(lines.length * size * 1.15 * scale + pad * 2));
    ctx.font = `${bold ? 'bold ' : ''}${size * scale}px ${family}`;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, c.width / 2, pad + (i + 0.5) * size * 1.15 * scale));
    const data = ctx.getImageData(0, 0, c.width, c.height).data, g = new Uint8Array(c.width * c.height);
    for (let i = 0; i < g.length; i++) g[i] = data[i * 4 + 3];
    let bin = '';
    for (let i = 0; i < g.length; i += 8192) bin += String.fromCharCode(...g.subarray(i, i + 8192));
    return { id: 'd' + Math.random().toString(36).slice(2, 12), name: `“${text.slice(0, 30)}”`, width: c.width, height: c.height, data: btoa(bin) };
  }

  /** The surface's way out around a point (the texels near it, averaged), steadier than one triangle's. */
  function surfaceNormal(point, r) {
    let n = [0, 0, 0];
    near(point, r, (s, t) => {
      const f = texels.sets[s], b = t * 7;
      if (Math.hypot(f[b] - point[0], f[b + 1] - point[1], f[b + 2] - point[2]) <= r) { n[0] += f[b + 3]; n[1] += f[b + 4]; n[2] += f[b + 5]; }
    });
    const l = Math.hypot(...n);
    return l > 1e-6 ? n.map((v) => v / l) : null;
  }

  /** 🏷: the decal placed at the click (one dab with its picture as the tip), facing out of the surface or as seen. */
  function placeStamp(hit) {
    const pic = gray(stamp.picture);
    if (!pic) { notice('Choose a picture or text for the decal first', 1800); return; }
    const r = (stamp.size / 100) * modelSize() / 2;
    const n = stamp.facing === 'view' ? null : surfaceNormal(hit.point, r * 0.5) || hit.normal;
    const view = n ? n.map((v) => -v) : hit.dir;
    commitStrokes([{ erase: false, radius: +r.toFixed(5), hardness: 1, flow: 1, view: view.map((v) => +v.toFixed(5)), dabs: [...hit.point.map((v) => +v.toFixed(5)), 1, 1], part: -1,
      tip: stamp.picture, angle: stamp.angle, jitter: 0, seed: 0, stencil: null }]);
  }

  function tipRow(num) {
    if (brush.tip && !gray(brush.tip)) brush.tip = '';
    const sel = el('select', { id: 'fg-tip', 'aria-label': 'Brush tip' }, el('option', { value: '', text: 'Round (hardness)' }),
      el('optgroup', { label: 'NoorForge' }, ...(lists.tips || []).map((t) => el('option', { value: t.id, text: t.name }))),
      ...(pictures().some((p) => p.id[0] === 't') ? [el('optgroup', { label: 'Pictures' }, ...pictures().filter((p) => p.id[0] === 't').map((p) => el('option', { value: p.id, text: p.name })))] : []),
      el('option', { value: '+', text: 'A picture…' }));
    sel.value = brush.tip;
    sel.addEventListener('change', async () => {
      if (sel.value === '+') { const p = await pickPicture('tip'); setBrush('tip', p ? p.id : brush.tip); return; }
      setBrush('tip', sel.value);
    });
    const isPicture = brush.tip && brush.tip[0] === 't' && pictures().some((p) => p.id === brush.tip);
    return el('div', { class: 'sb-row' },
      el('label', { class: 'sb-inline', title: 'The brush\'s shape: round (its hardness), a NoorForge tip, or any picture (a NoorSketch painting too)' }, el('span', { text: 'Tip' }), sel),
      el('canvas', { id: 'fg-tipview', class: 'fg-tipview', width: '40', height: '40', 'aria-hidden': 'true' }),
      isPicture ? el('button', { class: 'icon-btn', title: 'Remove this picture from the recipe', 'aria-label': 'Remove the tip picture', onclick: () => removePicture(brush.tip) }, '✕') : null,
      brush.tip ? num('angle', 'Angle', 0, 359, 1, 'The tip\'s turn (clockwise, as you look)') : null,
      brush.tip ? num('jitter', 'Turn at random', 0, 1, 0.01, 'Each dab turned at random, up to a whole turn') : null);
  }

  function drawTip() {
    const c = $('#fg-tipview');
    if (!c) return;
    const ctx = c.getContext('2d'), img = ctx.createImageData(40, 40), pic = gray(brush.tip);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
      const u = (x + 0.5) / 20 - 1, v = 1 - (y + 0.5) / 20, d = Math.hypot(u, v);
      const val = pic ? sample(pic, (u + 1) / 2, (1 - v) / 2) : d >= 1 ? 0 : d <= brush.hardness ? 1 : smooth(0, 1, (1 - d) / Math.max(1e-4, 1 - brush.hardness));
      const k = (y * 40 + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 235; img.data[k + 3] = Math.round(val * 255);
    }
    ctx.putImageData(img, 0, 0);
  }

  /** A stencil picture of the recipe laid over the view (in the middle, upright), or none. */
  function placeStencil(id) { stencil = id ? { id, fx: 0.5, fy: 0.5, size: 0.7, angle: 0, tile: false, invert: false, opacity: 0.45, shown: true, ...(stencil && stencil.id === id ? stencil : {}) } : null; renderBrushBar(); }

  function stencilRow(check) {
    const stencils = pictures().filter((p) => p.id[0] === 's');
    if (stencil && !stencils.some((p) => p.id === stencil.id)) stencil = null;
    const sel = el('select', { id: 'fg-stencil-pick', 'aria-label': 'Stencil' }, el('option', { value: '', text: 'No stencil' }),
      ...stencils.map((p) => el('option', { value: p.id, text: p.name })), el('option', { value: '+', text: 'A picture…' }));
    sel.value = stencil ? stencil.id : '';
    const place = placeStencil;
    sel.addEventListener('change', async () => {
      if (sel.value === '+') { const p = await pickPicture('stencil'); place(p ? p.id : stencil && stencil.id); return; }
      place(sel.value);
    });
    const st = (key, label, title) => {
      const c = el('input', { type: 'checkbox', checked: stencil[key] || undefined, 'data-stencil': key });
      c.addEventListener('change', () => { stencil[key] = c.checked; showStencil(); });
      return el('label', { class: 'sb-inline', title }, c, el('span', { text: label }));
    };
    const op = stencil ? el('input', { type: 'range', min: '0.1', max: '0.9', step: '0.05', value: String(stencil.opacity), 'aria-label': 'How see-through the stencil is shown', 'data-stencil': 'opacity' }) : null;
    if (op) op.addEventListener('input', () => { stencil.opacity = Number(op.value); showStencil(); });
    return el('div', { class: 'sb-row' },
      el('label', { class: 'sb-inline', title: 'A picture laid over the view: paint gets through where it is white. Hold S: drag to move it, wheel to size it, Shift+wheel to turn it' }, el('span', { text: 'Stencil' }), sel),
      stencil ? st('shown', 'show', 'Show it over the view (and paint through it)') : null,
      stencil ? st('tile', 'repeat', 'Repeat it beyond its edges') : null,
      stencil ? st('invert', 'black lets paint through', 'Turn it around: black lets paint through') : null,
      op ? el('label', { class: 'fg-bnum', title: 'How strongly it is drawn over the view' }, el('span', { text: 'Shown' }), op) : null,
      stencil ? el('button', { class: 'utility-btn', id: 'fg-stencil-fit', title: 'Back to the middle, upright', onclick: () => { Object.assign(stencil, { fx: 0.5, fy: 0.5, size: 0.7, angle: 0 }); showStencil(); } }, 'Centre') : null,
      stencil ? el('button', { class: 'icon-btn', title: 'Remove this picture from the recipe', 'aria-label': 'Remove the stencil picture', onclick: () => removePicture(stencil.id) }, '✕') : null,
      stencil ? el('span', { class: 'pref-hint', text: 'Hold S: drag moves it · wheel sizes it · Shift+wheel turns it' }) : null);
  }

  const texKey = () => `${recipe.model}|${Math.min(512, recipe.size)}|${recipe.aoRays}|${recipe.aoDistance}|${recipe.edgeWidth}`;

  /** Where each texel of the preview is on the model, for showing a stroke at once (fetched when painting starts). */
  async function ensureTexels() {
    if (!recipe || !recipe.model) return null;
    const key = texKey();
    if (texels && texels.key === key) return texels;
    if (texelsLoading && texelsLoading.key === key) return texelsLoading.promise;
    const promise = (async () => {
      try {
        const r = await req('forge.texels', { recipe: { ...recipe, layers: [] } });
        const sets = await Promise.all(r.sets.map(async (u) => new Float32Array(await (await fetch(u)).arrayBuffer())));
        texels = { key, size: r.size, sets, ...buildGrid(sets) };
        overlay = null;
        return texels;
      } catch (err) { hooks.showError(err); return null; } finally { texelsLoading = null; renderBrushBar(); }
    })();
    texelsLoading = { key, promise };
    renderBrushBar();
    return promise;
  }

  /** Texels in cells by position (as the app's ForgeTexelGrid): [set, texel] pairs per cell. */
  function buildGrid(sets) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const f of sets) for (let i = 0; i < f.length; i += 7) { if (Number.isNaN(f[i])) continue; for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], f[i + a]); hi[a] = Math.max(hi[a], f[i + a]); } }
    const cell = Math.max(1e-4, Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 64);
    const cells = new Map();
    sets.forEach((f, s) => {
      for (let i = 0, t = 0; i < f.length; i += 7, t++) {
        if (Number.isNaN(f[i])) continue;
        const k = cellKey(f[i], f[i + 1], f[i + 2], lo, cell);
        let list = cells.get(k);
        if (!list) cells.set(k, list = []);
        list.push(s, t);
      }
    });
    return { lo, cell, cells, center: (lo[0] + hi[0]) / 2 };
  }
  const cellKey = (x, y, z, lo, cell) => Math.floor((x - lo[0]) / cell) + Math.floor((y - lo[1]) / cell) * 4096 + Math.floor((z - lo[2]) / cell) * 16777216;

  function near(at, r, each) {
    const { lo, cell, cells } = texels;
    const c0 = [0, 1, 2].map((a) => Math.floor((at[a] - r - lo[a]) / cell)), c1 = [0, 1, 2].map((a) => Math.floor((at[a] + r - lo[a]) / cell));
    for (let x = c0[0]; x <= c1[0]; x++) for (let y = c0[1]; y <= c1[1]; y++) for (let z = c0[2]; z <= c1[2]; z++) {
      const list = cells.get(x + y * 4096 + z * 16777216);
      if (list) for (let i = 0; i < list.length; i += 2) each(list[i], list[i + 1]);
    }
  }

  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  /** One dab into the overlay: the same coverage the app paints (ForgePaint.Coverage). */
  function overlayDab(st, x, y, z, size, flow, index) {
    if (!texels || !overlay) return;
    const r = st.radius * Math.max(0.02, size), f0 = st.flow * flow, v = st.view, hard = st.hardness;
    if (f0 <= 0) return;
    const tip = gray(st.tip), axes = tip ? screenAxes(v) : null;
    const aspect = tip ? tip.w / tip.h : 1, reach = tip ? 1.415 * Math.max(1, aspect) : 1;
    const angle = (st.angle + st.jitter * 360 * (hash(index, st.seed) - 0.5)) * Math.PI / 180, ca = Math.cos(angle), sa = Math.sin(angle);
    near([x, y, z], r * reach, (s, t) => {
      const f = texels.sets[s], b = t * 7;
      const ox = f[b] - x, oy = f[b + 1] - y, oz = f[b + 2] - z;
      const d = Math.hypot(ox, oy, oz) / r;
      if (d >= reach) return;
      const facing = smooth(-0.05, 0.25, -(f[b + 3] * v[0] + f[b + 4] * v[1] + f[b + 5] * v[2]));
      if (facing <= 0) return;
      let fall;
      if (!tip) { if (d >= 1) return; fall = d <= hard ? 1 : smooth(0, 1, (1 - d) / Math.max(1e-4, 1 - hard)); }
      else {
        if (Math.abs(ox * v[0] + oy * v[1] + oz * v[2]) > r) return;
        const a = (ox * axes.right[0] + oy * axes.right[1] + oz * axes.right[2]) / r, bb = (ox * axes.up[0] + oy * axes.up[1] + oz * axes.up[2]) / r;
        const tu = ca * a - sa * bb, tv = sa * a + ca * bb; // turned clockwise by the angle
        if (Math.abs(tu) > aspect || Math.abs(tv) > 1) return;
        fall = sample(tip, (tu / aspect + 1) / 2, (1 - tv) / 2);
      }
      if (st.stencil) fall *= stencilAt(st, f[b], f[b + 1], f[b + 2]);
      if (fall <= 0) return;
      const c = overlay.cover[s];
      c[t] = 1 - (1 - c[t]) * (1 - f0 * fall * facing);
      overlay.bytes[s][t] = Math.round(c[t] * 255);
    });
    overlay.dirty = true;
  }

  function showOverlay() {
    if (!overlay || !overlay.dirty || !viewer) return;
    overlay.dirty = false;
    const layer = recipe.layers[selected];
    const color = overlay.erase ? [0.05, 0.05, 0.06] : view === 'mask' ? [1, 1, 1] : layer && !layer.material ? hexRgb(layer.color) : [1, 0.62, 0.22];
    viewer.setPaint(overlay.bytes.map((b) => ({ size: texels.size, data: b })), color, overlay.erase ? 0.6 : 0.85);
  }

  function startOverlay(erase) {
    if (!texels) return;
    if (!overlay || overlay.erase !== erase) {
      const n = texels.size * texels.size;
      overlay = { erase, cover: texels.sets.map(() => new Float32Array(n)), bytes: texels.sets.map(() => new Uint8Array(n)), dirty: true };
    }
  }

  /** A pen's pressure (a mouse presses fully). */
  const pressure = (e) => (e && e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0) : 1);

  function addDab(p, pr) {
    const size = brush.pressureSize ? pr : 1, flow = brush.pressureFlow ? pr : 1;
    for (const st of stroke.strokes) {
      const x = st.mirrored ? 2 * texels.center - p[0] : p[0];
      st.dabs.push(+x.toFixed(5), +p[1].toFixed(5), +p[2].toFixed(5), +size.toFixed(3), +flow.toFixed(3));
      overlayDab(st, x, p[1], p[2], size, flow, st.dabs.length / 5 - 1);
    }
    stroke.last = p;
  }

  /** Dabs from the last one to a point, every spacing (a jump across a gap starts afresh). */
  function dabTo(p, pr) {
    if (!stroke.last) { addDab(p, pr); return; }
    const step = Math.max(1e-5, brush.spacing * radius() * (brush.pressureSize ? pr : 1));
    const l = stroke.last, dx = p[0] - l[0], dy = p[1] - l[1], dz = p[2] - l[2];
    const d = Math.hypot(dx, dy, dz);
    if (d > radius() * 6) { addDab(p, pr); return; }
    const n = Math.floor(d / step);
    for (let i = 1; i <= n; i++) addDab([l[0] + dx * (i * step / d), l[1] + dy * (i * step / d), l[2] + dz * (i * step / d)], pr);
    if (n > 0) stroke.last = [l[0] + dx * (n * step / d), l[1] + dy * (n * step / d), l[2] + dz * (n * step / d)];
  }

  function beginStroke(hit) {
    const seed = Math.floor(Math.random() * 1e9);
    const rows = stencil && stencil.shown && gray(stencil.id) ? stencilRows() : null;
    const st = (mirrored) => ({
      erase: erasing, radius: +radius().toFixed(5), hardness: brush.hardness, flow: brush.flow, view: (mirrored ? [-hit.dir[0], hit.dir[1], hit.dir[2]] : hit.dir).map((v) => +v.toFixed(5)), dabs: [], part: -1,
      tip: brush.tip && gray(brush.tip) ? brush.tip : '', angle: brush.angle, jitter: brush.jitter, seed,
      stencil: rows ? { picture: stencil.id, rows: mirrored ? mirrorRows(rows, texels.center) : rows, tile: stencil.tile, invert: stencil.invert } : null,
      mirrored, stencilPic: rows ? gray(stencil.id) : null,
    });
    stroke = { strokes: brush.mirror ? [st(false), st(true)] : [st(false)], last: null };
    startOverlay(erasing);
  }

  function endStroke() {
    if (!stroke) return;
    const done = stroke.strokes.filter((st) => st.dabs.length);
    stroke = null;
    if (done.length) commitStrokes(done.map(({ mirrored, stencilPic, ...st }) => st));
  }

  /** New strokes into the chosen layer: one undo step each, then textured again. */
  function commitStrokes(list) {
    const layer = recipe.layers[selected];
    if (!layer) return;
    clearTimeout(snapTimer); pushHistory();
    layer.strokes = (layer.strokes || []).concat(list);
    pushHistory();
    paintVersion++;
    renderLayers(); renderLayerEditor();
    schedule();
  }

  let lastLineEnd = null;    // where the last stroke ended (Shift+click draws a straight line from it)
  let rafPending = false;
  const frame = () => { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; showOverlay(); }); };

  let stencilDrag = null;
  const PAINTER = {
    wheel(e) {
      if (!stencilKey || !stencil) return false;
      if (e.shiftKey) stencil.angle = (stencil.angle + (e.deltaY > 0 ? 5 : -5) + 360) % 360;
      else stencil.size = Math.max(0.05, Math.min(6, stencil.size * (e.deltaY > 0 ? 1 / 1.08 : 1.08)));
      showStencil();
      return true;
    },
    hover(e) {
      if (!e || !tool) { viewer.setBrush(null); return; }
      const hit = viewer.pick(e.clientX, e.clientY);
      if (tool === 'stamp') { viewer.setBrush(hit ? hit.point : null, (stamp.size / 100) * modelSize() / 2, 1); return; }
      viewer.setBrush(hit && tool === 'brush' ? hit.point : null, radius(), brush.hardness);
    },
    down(e) {
      if (stencilKey && stencil) { stencilDrag = { x: e.clientX, y: e.clientY }; return true; }
      if (!tool || !recipe.layers[selected]) return false;
      if (!texels || texels.key !== texKey()) { ensureTexels(); notice('Getting the model ready for painting…', 1400); return false; }
      const hit = viewer.pick(e.clientX, e.clientY);
      if (!hit) return false; // off the model: turns it, as usual
      if (tool === 'fill') { fillPart(hit); return true; }
      if (tool === 'stamp') { placeStamp(hit); return true; }
      beginStroke(hit);
      if (e.shiftKey && lastLineEnd) {
        // A straight line from the last stroke's end, across the screen, each step finding the surface.
        stroke.last = null;
        addDab(lastLineEnd.point, 1);
        const steps = Math.max(2, Math.ceil(Math.hypot(e.clientX - lastLineEnd.x, e.clientY - lastLineEnd.y) / 3));
        for (let i = 1; i <= steps; i++) {
          const h = viewer.pick(lastLineEnd.x + (e.clientX - lastLineEnd.x) * (i / steps), lastLineEnd.y + (e.clientY - lastLineEnd.y) * (i / steps));
          if (h) dabTo(h.point, 1); else stroke.last = null;
        }
      } else addDab(hit.point, pressure(e));
      lastLineEnd = { point: hit.point, x: e.clientX, y: e.clientY };
      frame();
      return true;
    },
    move(e) {
      if (stencilDrag) {
        const r = $('#fg-canvas').getBoundingClientRect();
        stencil.fx += (e.clientX - stencilDrag.x) / r.width; stencil.fy += (e.clientY - stencilDrag.y) / r.height;
        stencilDrag = { x: e.clientX, y: e.clientY };
        showStencil();
        return;
      }
      if (!stroke) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of evs.length ? evs : [e]) {
        const hit = viewer.pick(ev.clientX, ev.clientY);
        if (!hit) { stroke.last = null; continue; }
        dabTo(hit.point, pressure(ev));
        lastLineEnd = { point: hit.point, x: ev.clientX, y: ev.clientY };
        viewer.setBrush(hit.point, radius(), brush.hardness);
      }
      frame();
    },
    up() { if (stencilDrag) { stencilDrag = null; return; } endStroke(); },
  };

  /** 🪣: the whole part under the click (its texels' part), into the layer. */
  function fillPart(hit) {
    let best = Infinity, part = -1;
    // The nearest texel: in the cells around the point, further out until one is found.
    for (const reach of [1, 3, 10]) {
      near(hit.point, texels.cell * reach, (s, t) => {
        const f = texels.sets[s], b = t * 7;
        const d = Math.hypot(f[b] - hit.point[0], f[b + 1] - hit.point[1], f[b + 2] - hit.point[2]);
        if (d < best) { best = d; part = f[b + 6]; }
      });
      if (part >= 0) break;
    }
    if (part < 0) return;
    commitStrokes([{ erase: false, radius: 0.05, hardness: 1, flow: 1, view: [0, 0, -1], dabs: [], part }]);
    notice(`Filled ${model && model.parts[part] ? `“${model.parts[part]}”` : 'the part'}`, 1400);
  }

  /** For tests and scripting: paint through points on the surface (each { point, dir }), as a stroke would. */
  async function paintHits(hits, { erase = false } = {}) {
    await ensureTexels();
    erasing = erase;
    beginStroke(hits[0]);
    for (const h of hits) dabTo(h.point, 1);
    showOverlay();
    endStroke();
  }

  let highName = '';

  async function pickHigh() {
    try {
      const r = await req('forge.highmodel.pick');
      if (!r || r.cancelled) return;
      recipe.highModel = r.path; highName = `${r.name} (${r.triangles.toLocaleString()} triangles)`;
      if (recipe.highDistance === undefined) recipe.highDistance = 0.03;
      changed('all');
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- files

  async function pickModel() {
    try {
      const r = await req('forge.model.pick');
      if (!r || r.cancelled) return;
      // A model opened is a step of its own: an undo right after the next change mustn't take the model away too.
      clearTimeout(snapTimer); pushHistory();
      model = r;
      recipe.model = r.path;
      fromAsset = null;
      if (/^Textured model/.test(recipe.name)) recipe.name = r.name;
      render = null;
      pushHistory();
      changed('all'); renderAll();
    } catch (err) { hooks.showError(err); }
  }

  /** NoorForm's tree or rock, sent here to be textured (a stony smart material to start with for rocks). */
  let fromAsset = null;    // { key, name, level, levels }: NoorForm model in here, to choose another level of it

  /** NoorForm's tree or rock (a level of it; a lower one with the closest baked onto it), sent here to be textured. */
  async function openAsset(key, name, isRock, level = 0) {
    await open();
    try {
      const r = await req('forge.fromAsset', { key, name, level });
      model = r.info;
      recipe.model = r.info.path;
      recipe.name = name;
      recipe.highModel = r.high ? r.high.path : null;
      highName = r.high ? `${r.high.name} (${r.high.triangles.toLocaleString()} triangles)` : '';
      fromAsset = { key, name, level: r.level, levels: r.levels };
      if (isRock !== null && level === 0 && isRock && lists.smart.some((x) => x.id === 'mossy-stone')) { recipe.layers = smartLayers('mossy-stone'); ensureIds(); selected = recipe.layers.length - 1; }
      render = null; texels = null;
      changed('all'); renderAll();
      if (isRock !== null) notice(`“${name}” is in NoorForge: choose a smart material or build up layers`, 2600);
    } catch (err) { hooks.showError(err); }
  }

  async function openRecipe() {
    try {
      const r = await req('forge.recipe.open');
      if (!r || r.cancelled) return;
      model = r.model;
      if (!r.model && r.recipe.model) notice('The model the recipe names was not found: open it again with 📂', 3200);
      if (!r.model) r.recipe.model = null;
      setRecipe(r.recipe, true);
    } catch (err) { hooks.showError(err); }
  }

  async function exportAll() {
    if (!recipe.model) { notice('Open a model first', 1800); return; }
    try {
      setStatus('Exporting…');
      const r = await req('forge.export', { recipe });
      if (!r || r.cancelled) { setStatus(''); return; }
      setStatus(`Exported ${r.files.length} files to ${r.folder}`);
      notice(`Exported: ${r.files.slice(0, 4).join(', ')}${r.files.length > 4 ? '…' : ''}`, 3000);
    } catch (err) { setStatus(''); hooks.showError(err); }
  }

  // ---------------------------------------------------------------- NoorForge as an app: its menus, settings, shortcuts

  // In focus mode with NoorForge in the middle, the window's menu bar is NoorForge's own (see NoorChrome.registerBench).
  function settingsDialog() {
    NoorUI.modal({ label: 'NoorForge settings', width: 440 }, (s2, closeIt) => {
      const size = el('select', { id: 'fg-set-size', 'aria-label': 'Texture size' }, ...lists.sizes.map((v) => el('option', { value: String(v), text: `${v} px` })));
      size.value = String(settings.size);
      const exports = lists.exports || [{ id: 'godot', name: 'Godot 4' }];
      const exp = el('select', { id: 'fg-set-export', 'aria-label': 'Export for' }, ...exports.map((x) => el('option', { value: x.id, text: x.name })));
      exp.value = settings.export;
      const smart = el('select', { id: 'fg-set-smart', 'aria-label': 'Smart material to start with' }, ...lists.smart.map((x) => el('option', { value: x.id, text: x.name })));
      smart.value = settings.smart;
      const rays = el('input', { type: 'number', min: '0', max: '128', value: String(settings.aoRays), id: 'fg-set-aorays', class: 'sb-num', 'aria-label': 'Ambient occlusion rays' });
      const ok = () => {
        settings = { size: Number(size.value) || 1024, export: exp.value || 'godot', smart: smart.value || 'mossy-stone', aoRays: Math.max(0, Math.min(128, Math.round(Number(rays.value)) || 0)) };
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* for now only */ }
        closeIt(); keepFocus();
        notice('NoorForge settings kept (a new recipe starts with them)', 1600);
      };
      s2.append(NoorUI.head('NoorForge settings', closeIt),
        el('div', { class: 'modal-body sp-dlg' },
          el('h4', { class: 'music-subhead', text: 'A new recipe' }),
          el('label', {}, 'Textures ', size), el('label', {}, 'For ', exp), el('label', {}, 'Starts with ', smart), el('label', {}, 'Ambient occlusion rays ', rays),
          el('p', { class: 'pref-hint', text: 'The brush and the stamp remember themselves as you change them.' })),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeIt() }, 'Cancel'), el('button', { class: 'action primary', id: 'fg-set-ok', onclick: ok }, 'OK'))));
    });
  }

  /** Every key NoorForge knows. */
  function shortcutsDialog() {
    const rows = [
      ['Open or close NoorForge', 'Ctrl+Alt+F'], ['Focus mode (NoorForge as an app) on / off', 'F11'], ['Undo · redo', 'Ctrl+Z · Ctrl+Y (Ctrl+Shift+Z)'],
      ['Turn the model · zoom · move it', 'drag · wheel · right-drag'],
      ['The brush on / off', 'B'], ['The eraser (while painting)', 'E'], ['Stamp a decal (while painting)', 'T'], ['Brush smaller / bigger (while painting)', '[ / ]'],
      ['A straight line from the last stroke', 'Shift+click'], ['Turn the model while painting', 'Alt+drag'],
      ['Move the stencil · size it · turn it', 'hold S: drag · wheel · Shift+wheel'], ['Put the brush down (out of focus mode: close NoorForge)', 'Esc'],
    ];
    NoorUI.modal({ label: 'NoorForge shortcuts', width: 520 }, (s2, closeIt) => {
      s2.append(NoorUI.head('NoorForge shortcuts', closeIt),
        el('div', { class: 'modal-body sp-dlg' }, el('table', { class: 'sp-keys', id: 'fg-keys' }, ...rows.map(([a, b]) => el('tr', {}, el('td', { text: a }), el('td', {}, el('kbd', { text: b })))))),
        el('div', { class: 'modal-foot' }, el('div', { class: 'modal-buttons' }, el('button', { class: 'action primary', onclick: () => closeIt() }, 'Done'))));
    });
  }

  /** Puts the keyboard in the name box, to rename the recipe. */
  function renameRecipe() { const n = $('#fg-name'); if (n) { n.focus(); n.select(); } }

  const appTitle = () => `NoorForge — ${recipe ? recipe.name || 'Untitled' : 'Untitled'} · ${model ? `${model.name}, ${model.sets.length} texture set${model.sets.length === 1 ? '' : 's'}` : 'no model yet'}`;

  /** NoorForge's menu bar: [name, its Alt letter, its items]. */
  function appMenus() {
    const go = (label, run, keys, more = {}) => ({ label, keys, run: () => { run(); setTimeout(keepFocus, 0); }, ...more });
    const noModel = () => !recipe || !recipe.model;
    const cantPaint = () => noModel() || !recipe.layers.length;
    const layer = () => recipe && recipe.layers[selected];
    const radio = (list, now, set) => list.map(([v, l]) => ({ label: l, checked: () => now() === v, run: () => { set(v); setTimeout(keepFocus, 0); } }));
    const setOpt = (k, v) => { recipe[k] = v; changed(); renderAll(); };
    const decals = () => pictures().filter((p) => p.id[0] === 'd');
    return [
      ['File', 'f', () => [
        go('Open a model…', pickModel), go('Open a recipe…', openRecipe), '-',
        go('Export the maps, the textured GLB and the recipe…', exportAll, '', { disabled: noModel }), '-',
        { label: 'Export for', sub: () => radio((lists.exports || [{ id: 'godot', name: 'Godot 4' }]).map((x) => [x.id, x.name]), () => recipe.export || 'godot', (v) => setOpt('export', v)) },
        { label: 'Texture size', sub: () => radio(lists.sizes.map((v) => [v, `${v} px`]), () => recipe.size, (v) => setOpt('size', v)) },
        { label: 'Smaller copies (LODs)', sub: () => radio([[0, 'None'], [1, '½ (LOD1)'], [2, '½ and ¼ (LOD1, LOD2)']], () => recipe.lodCopies || 0, (v) => setOpt('lodCopies', v)) },
        { label: 'Every texture set in one atlas', checked: () => !!recipe.atlas, disabled: () => !model || model.sets.length < 2, run: () => setOpt('atlas', !recipe.atlas) }, '-',
        { id: 'view.focus', label: 'Back to NoorMD (leave focus mode)' }, go('Close NoorForge', close, 'Ctrl+Alt+F'),
      ]],
      ['Edit', 'e', () => [
        go('Undo', () => undo(false), 'Ctrl+Z', { disabled: () => !history.length && JSON.stringify(recipe) === lastSnapshot }),
        go('Redo', () => undo(true), 'Ctrl+Y', { disabled: () => !future.length }), '-',
        go('Rename the recipe', renameRecipe), '-',
        go('NoorForge settings…', settingsDialog),
      ]],
      ['Layer', 'l', () => [
        go('Add a material layer', () => addLayer(true), '', { disabled: () => recipe.layers.length >= 32 }),
        go('Add a colour layer', () => addLayer(false), '', { disabled: () => recipe.layers.length >= 32 }),
        go('Add a paint layer (the brush ready)', () => { addLayer(false, true); setTool('brush', false); }, '', { disabled: () => recipe.layers.length >= 32 }), '-',
        { label: 'Choose a layer', sub: () => (recipe.layers.length ? recipe.layers.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => ({ label: l.name, checked: () => i === selected, run: () => selectLayer(i) })) : [{ label: 'No layers yet', disabled: true }]) },
        { label: 'Shown', checked: () => !!(layer() && layer().visible), disabled: () => !layer(), run: () => { layer().visible = !layer().visible; changed('layers'); } },
        go('Move up the stack', () => moveLayer(1), '', { disabled: () => selected >= recipe.layers.length - 1 }),
        go('Move down the stack', () => moveLayer(-1), '', { disabled: () => selected <= 0 }),
        go('Clear its painting', () => { layer().strokes = []; paintVersion++; changed('all'); }, '', { disabled: () => !layer() || !(layer().strokes || []).length }),
        go('Remove the layer', removeLayer, '', { disabled: () => !recipe.layers.length }), '-',
        { label: 'Smart materials', sub: () => (lists.smart.filter((x) => !x.mine).map((x) => go(x.name, () => applySmart(x), '', { title: x.description || '' }))) },
        { label: 'Your smart materials', sub: () => (lists.smart.some((x) => x.mine) ? lists.smart.filter((x) => x.mine).map((x) => go(x.name, () => applySmart(x))) : [{ label: 'None saved yet', disabled: true }]) },
        go('Save these layers as a smart material…', saveSmart, '', { disabled: () => !recipe.layers.length }),
        { label: 'Remove one of yours', disabled: () => !lists.smart.some((x) => x.mine), sub: () => lists.smart.filter((x) => x.mine).map((x) => go(`${x.name}…`, () => deleteSmart(x))) },
      ]],
      ['Paint', 'p', () => [
        { label: 'Brush', keys: 'B', checked: () => tool === 'brush' && !erasing, disabled: cantPaint, run: () => setTool(tool === 'brush' && !erasing ? null : 'brush', false) },
        { label: 'Eraser', keys: 'E', checked: () => tool === 'brush' && erasing, disabled: cantPaint, run: () => setTool('brush', true) },
        { label: 'Fill a part', checked: () => tool === 'fill', disabled: cantPaint, run: () => setTool('fill') },
        { label: 'Stamp a decal', keys: 'T', checked: () => tool === 'stamp', disabled: cantPaint, run: () => setTool('stamp') },
        go('Put the brush down', () => setTool(null), 'Esc', { disabled: () => !tool }), '-',
        go('Brush smaller', () => brushSize(-1), '['), go('Brush bigger', () => brushSize(1), ']'),
        { label: 'Mirror across X', checked: () => !!brush.mirror, run: () => setBrush('mirror', !brush.mirror) },
        { label: 'Pen pressure: size', checked: () => !!brush.pressureSize, run: () => setBrush('pressureSize', !brush.pressureSize) },
        { label: 'Pen pressure: flow', checked: () => !!brush.pressureFlow, run: () => setBrush('pressureFlow', !brush.pressureFlow) },
        { label: 'Brush tip', sub: () => [
          ...radio([['', 'Round (hardness)'], ...(lists.tips || []).map((t) => [t.id, t.name]), ...pictures().filter((p) => p.id[0] === 't').map((p) => [p.id, p.name])], () => brush.tip, (v) => setBrush('tip', v)), '-',
          go('A picture as a tip…', async () => { const p = await pickPicture('tip'); if (p) setBrush('tip', p.id); }, '', { disabled: () => !recipe }),
        ] }, '-',
        { label: 'Stencil', sub: () => [
          ...radio([['', 'No stencil'], ...pictures().filter((p) => p.id[0] === 's').map((p) => [p.id, p.name])], () => (stencil ? stencil.id : ''), placeStencil), '-',
          go('A picture as a stencil…', async () => { const p = await pickPicture('stencil'); if (p) placeStencil(p.id); }),
        ] },
        { label: 'Stencil: shown', checked: () => !!(stencil && stencil.shown), disabled: () => !stencil, run: () => { stencil.shown = !stencil.shown; renderBrushBar(); } },
        { label: 'Stencil: repeat', checked: () => !!(stencil && stencil.tile), disabled: () => !stencil, run: () => { stencil.tile = !stencil.tile; renderBrushBar(); } },
        { label: 'Stencil: black lets paint through', checked: () => !!(stencil && stencil.invert), disabled: () => !stencil, run: () => { stencil.invert = !stencil.invert; renderBrushBar(); } },
        go('Stencil back to the middle', () => { Object.assign(stencil, { fx: 0.5, fy: 0.5, size: 0.7, angle: 0 }); showStencil(); }, '', { disabled: () => !stencil }), '-',
        { label: 'Decal to stamp', sub: () => [
          ...(decals().length ? radio(decals().map((p) => [p.id, p.name]), () => stamp.picture, (v) => setStamp('picture', v)) : [{ label: 'None yet', disabled: true }]), '-',
          go('A picture as a decal…', async () => { const p = await pickPicture('decal'); if (p) setStamp('picture', p.id); }),
          go('Text as a decal…', async () => { const p = await textDecal(); if (p) setStamp('picture', p.id); }),
        ] },
        { label: 'Decal lies', sub: () => radio([['surface', 'Flat on the surface'], ['view', 'As you look at it']], () => stamp.facing, (v) => setStamp('facing', v)) },
      ]],
      ['Bake', 'b', () => [
        go('Choose a high-poly model…', pickHigh), go('Bake from this model alone', () => { recipe.highModel = null; highName = ''; changed('all'); }, '', { disabled: () => !recipe.highModel }), '-',
        { label: 'NoorForm level', disabled: () => !(fromAsset && fromAsset.levels > 1), sub: () => Array.from({ length: fromAsset.levels }, (_, i) => ({ label: i === 0 ? 'The closest (LOD0)' : `LOD${i}, with LOD0 baked onto it`, checked: () => fromAsset.level === i, run: () => openAsset(fromAsset.key, fromAsset.name, null, i) })) }, '-',
        go('The model and its bakes…', () => showTab('bake')),
      ]],
      ['View', 'v', () => [
        ...radio(VIEWS, () => view, setView), '-',
        go('Zoom in', () => viewer.zoom(1 / 1.2), '', { disabled: () => !viewer }), go('Zoom out', () => viewer.zoom(1.2), '', { disabled: () => !viewer }), go('Back to the whole model', () => viewer.reset(), '', { disabled: () => !viewer }), '-',
        { label: 'The layers', checked: () => tab === 'layers', run: () => showTab('layers') }, { label: 'The model and its bakes', checked: () => tab === 'bake', run: () => showTab('bake') }, '-',
        { label: 'Texture set shown', disabled: () => !render || render.sets.length < 2, sub: () => render.sets.map((x, i) => ({ label: x.name, checked: () => shownSet === i, run: () => { shownSet = i; renderMaps(); } })) },
        { label: 'Settings beside the model', checked: () => !!layout.prefs.side, run: () => layout.set({ side: !layout.prefs.side }) },
        { label: 'The list on the left', checked: () => !!layout.prefs.list, run: () => layout.set({ list: !layout.prefs.list }) }, '-',
        { id: 'view.focus', label: 'Focus mode (NoorForge as an app)' },
      ]],
      ['Help', 'h', () => [go('NoorForge shortcuts…', shortcutsDialog), { id: 'shortcuts.show', label: 'NoorMD shortcuts' }]],
    ];
  }

  return {
    init, open, close, toggle, isOpen, openAsset, addPicture, _paintAt: (hits, opts) => paintHits(hits, opts),
    /** For tests: the stencil's u, v (as the app works them out) at the surface under a point of the canvas. */
    _textPicture: (text) => textPicture(text, FONTS.sans, true),
    _stencilUv: (x, y) => {
      const hit = viewer && stencil && viewer.pick(x, y);
      if (!hit) return null;
      const r = stencilRows(), [px, py, pz] = hit.point, w = r[8] * px + r[9] * py + r[10] * pz + r[11];
      return [(r[0] * px + r[1] * py + r[2] * pz + r[3]) / w, (r[4] * px + r[5] * py + r[6] * pz + r[7]) / w];
    },
    _state: () => ({ recipe: recipe ? clone(recipe) : null, model, selected, tab, view, viewMode: viewer ? viewer.state().mode : null, tool, erasing, brush: { ...brush }, stencil: stencil ? { ...stencil } : null, stencilKey, stamp: { ...stamp }, texels: texels ? { size: texels.size, sets: texels.sets.length } : null, painting: !!stroke, overlay: !!overlay && overlay.cover.some((c) => c.some((v) => v > 0.05)), render: render ? clone(render) : null, history: history.length }),
  };
})();
