// NoorForge: texturing a model with layers and smart masks (docs/NOORFORGE_PLAN.md). The page edits the recipe — the
// model, the layers bottom first, the bakes' settings — and shows the textured model; the app bakes the model's maps,
// composes the layers and serves the textured GLB and its maps. Export writes the texture sets, the GLB and the recipe.
window.NoorForge = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const MASKS = { all: 'Everywhere', edges: 'Worn edges', cavity: 'Cracks and corners (dirt)', top: 'On top (dust, moss, snow)', bottom: 'Underneath (grime)', height: 'Low down (a gradient up the model)', part: 'One part', material: 'One material' };
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
  let renderTimer = null, renderGen = 0;
  const history = []; let future = []; let lastSnapshot = '';

  const isOpen = () => document.body.classList.contains('forge-open');

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
    if (!recipe) setRecipe({ version: 1, name: 'Textured model', model: null, size: 1024, aoRays: 24, aoDistance: 0.25, edgeWidth: 0.02, layers: smartLayers('mossy-stone') }, true);
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
    if (!recipe || !recipe.model) { setStatus(model ? '' : 'Open a model (GLB or OBJ) to texture it: 📂 above, or a model from the Asset Bench.'); return; }
    const gen = ++renderGen;
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
        await applyView(gen);
      }
      renderMaps();
      setStatus(`${r.sets.length} texture set${r.sets.length === 1 ? '' : 's'} · preview ${r.size} px (export ${recipe.size} px) · ${(r.ms / 1000).toFixed(1)} s`);
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
            el('button', { class: 'action primary', id: 'fg-export', title: 'Write the textures (each texture set: colour, normal, ORM, roughness, metallic, AO), the textured GLB and the recipe', onclick: exportAll }, '⤓ Export')),
          el('div', { class: 'tb-split', id: 'fg-split' },
            el('div', { class: 'tb-view-col', id: 'fg-view-col' },
              el('div', { class: 'tb-views', role: 'group', 'aria-label': 'Preview' },
                (() => { const s = el('select', { id: 'fg-view', 'aria-label': 'Show', title: 'The model lit, or one channel on it as it is' }, ...VIEWS.map(([v, t]) => el('option', { value: v, text: t }))); s.addEventListener('change', () => { view = s.value; applyView(); }); return s; })(),
                el('span', { class: 'sb-fx-space' }),
                el('button', { class: 'icon-btn', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => viewer && viewer.zoom(1.2) }, '−'),
                el('button', { class: 'icon-btn', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => viewer && viewer.zoom(1 / 1.2) }, '+'),
                el('button', { class: 'icon-btn', title: 'Back to the whole model', 'aria-label': 'Reset the view', onclick: () => viewer && viewer.reset() }, '⟲'),
                el('button', { class: 'icon-btn', id: 'fg-side', title: 'The model big, the settings in a column on the right; or the settings under the model', 'aria-label': 'Settings beside the model', 'aria-pressed': 'false', onclick: () => layout.set({ side: !layout.prefs.side }) }, '◫'),
                el('button', { class: 'icon-btn', id: 'fg-list', title: 'Show or hide the list on the left', 'aria-label': 'The list', 'aria-pressed': 'true', onclick: () => layout.set({ list: !layout.prefs.list }) }, '☰')),
              el('div', { class: 'tb-stage' }, el('canvas', { id: 'fg-canvas', class: 'tb-canvas', role: 'img', 'aria-label': 'The textured model: drag to turn it, wheel to zoom', title: 'Drag: turn · wheel: zoom · right-drag: move' })),
              el('p', { class: 'pref-hint sb-status', id: 'fg-status', 'aria-live': 'polite' }),
              el('div', { class: 'fg-maps', id: 'fg-maps' })),
            el('div', { class: 'tb-splitter', id: 'fg-splitter', role: 'separator', tabindex: '0', 'aria-label': 'Drag to share the room between the model and the settings (double-click: back to normal)' }),
            el('div', { class: 'tb-edit-col', id: 'fg-edit-col' },
              el('div', { class: 'music-tabs sb-tabs', id: 'fg-tabs', role: 'tablist' }),
              el('div', { class: 'sb-pane', id: 'fg-pane' }))))));
    ($('#app') || document.body).append(root);
    new ResizeObserver(() => root.classList.toggle('wide', root.clientWidth >= 820)).observe(root);
    layout = NoorBenchLayout.attach({ root, storageKey: 'noormd.forge.layout', defaults: { side: true }, split: $('#fg-split'), viewCol: $('#fg-view-col'), editCol: $('#fg-edit-col'),
      splitter: $('#fg-splitter'), sideButton: $('#fg-side'), listButton: $('#fg-list'), top: $('#fg-top'), sideSized: 'edit' });
    $('#fg-name').addEventListener('input', (e) => { recipe.name = e.target.value; changed(); });
    $('#fg-size').addEventListener('change', (e) => { recipe.size = Number(e.target.value); changed(); });
    root.addEventListener('keydown', (e) => {
      const typing = e.target.closest('input[type=text], input[type=number], select, textarea');
      if (e.key === 'Escape' && !typing && !document.body.classList.contains('zen')) { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && e.ctrlKey) { e.preventDefault(); undo(e.shiftKey); }
      else if (k === 'y' && e.ctrlKey) { e.preventDefault(); undo(true); }
    });
    try { viewer = NoorAssetView.create($('#fg-canvas')); } catch (err) { console.warn('NoorForge: no 3D preview', err); viewer = null; setStatus('The 3D preview needs WebGL 2. Exports still work.'); }
  }

  function renderAll() {
    if (!built || !recipe) return;
    $('#fg-name').value = recipe.name;
    $('#fg-size').replaceChildren(...lists.sizes.map((s) => el('option', { value: String(s), text: `${s} px` })));
    $('#fg-size').value = String(recipe.size);
    $('#fg-model').textContent = model ? `${model.name} · ${model.triangles.toLocaleString()} triangles · ${model.sets.length} texture set${model.sets.length === 1 ? '' : 's'}` : 'no model yet';
    renderNav(); renderTabs(); renderEditor(); renderMaps();
  }

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
    return el('button', { class: 'sb-preset', 'data-smart': s.id, title: `${s.description ? s.description + ' ' : ''}(replaces the layers; Ctrl+Z brings them back)`, onclick: () => { recipe.layers = clone(s.layers); selected = recipe.layers.length - 1; changed('all'); } }, s.name);
  }

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

  function renderTabs() {
    $('#fg-tabs').replaceChildren(...[['layers', 'Layers'], ['bake', 'Model & bakes']].map(([id, label]) =>
      el('button', { role: 'tab', 'data-tab': id, class: id === tab ? 'active' : '', 'aria-selected': String(id === tab), onclick: () => { tab = id; renderTabs(); renderEditor(); } }, label)));
  }

  function renderEditor() {
    const pane = $('#fg-pane');
    if (!pane || !recipe) return;
    pane.replaceChildren(...(tab === 'bake' ? bakePane() : layersPane()));
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

  function renderLayers() {
    const list = $('#fg-layers');
    if (!list) return;
    // Top of the stack first, as in a painting program.
    list.replaceChildren(...recipe.layers.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => el('div', { class: 'fg-layer' + (i === selected ? ' sel' : '') + (l.visible ? '' : ' off'), 'data-layer': String(i), role: 'button', tabindex: '0',
      onclick: () => { selected = i; renderLayers(); renderLayerEditor(); schedule(); } }, // its mask, shown
      el('button', { class: 'icon-btn', 'aria-pressed': String(l.visible), title: l.visible ? 'Shown (click to hide)' : 'Hidden (click to show)', 'aria-label': `Show ${l.name}`, onclick: (e) => { e.stopPropagation(); l.visible = !l.visible; changed('layers'); } }, l.visible ? '👁' : '◌'),
      el('span', { class: 'fg-swatch', style: `background:${l.material ? 'linear-gradient(135deg,#777,#bbb)' : l.color}` }),
      el('span', { class: 'fg-layername', text: l.name }),
      el('small', { text: l.mask.kind === 'all' ? '' : MASKS[l.mask.kind].split(' (')[0] }))));
    keepFocus();
  }

  function layersPane() {
    const add = (material) => {
      const l = { name: material ? 'Material' : 'Colour', visible: true, opacity: 1, material: material ? (lists.materials[0] || {}).id || '' : '', scale: 1, color: material ? '#808080' : '#a0a0a0', roughness: 0.7, metallic: 0,
        height: 0.5, useColor: true, useRoughness: true, useMetallic: true, useNormal: true, useHeight: true, normalStrength: 1, mask: { kind: 'all', amount: 0.5, softness: 0.3, invert: false, noise: 0.3, noiseScale: 0.25, index: 0 } };
      recipe.layers.splice(selected + 1, 0, l); selected++; changed('all');
    };
    const move = (d) => { const j = selected + d; if (j < 0 || j >= recipe.layers.length) return; [recipe.layers[selected], recipe.layers[j]] = [recipe.layers[j], recipe.layers[selected]]; selected = j; changed('all'); };
    const out = [
      el('div', { class: 'sb-row' },
        el('button', { class: 'utility-btn', id: 'fg-addmat', disabled: recipe.layers.length >= 32 || undefined, onclick: () => add(true) }, '＋ Material layer'),
        el('button', { class: 'utility-btn', id: 'fg-addplain', disabled: recipe.layers.length >= 32 || undefined, onclick: () => add(false) }, '＋ Colour layer'),
        el('button', { class: 'icon-btn', title: 'Up the stack', 'aria-label': 'Move up', onclick: () => move(1) }, '↑'),
        el('button', { class: 'icon-btn', title: 'Down the stack', 'aria-label': 'Move down', onclick: () => move(-1) }, '↓'),
        el('button', { class: 'icon-btn', id: 'fg-dellayer', title: 'Remove this layer (Ctrl+Z brings it back)', 'aria-label': 'Remove the layer', disabled: !recipe.layers.length || undefined, onclick: () => { recipe.layers.splice(selected, 1); selected = Math.max(0, selected - 1); changed('all'); } }, '🗑')),
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
    const which = m.kind === 'part' || m.kind === 'material'
      ? (() => {
        const names = model ? (m.kind === 'part' ? model.parts : model.sets.map((s) => s.name)) : [];
        const s = el('select', { id: 'fg-maskindex', 'aria-label': m.kind === 'part' ? 'Which part' : 'Which material' }, ...names.map((n, i) => el('option', { value: String(i), text: n })));
        s.value = String(m.index); s.addEventListener('change', () => { m.index = Number(s.value); changed(); });
        return el('label', { class: 'sb-inline' }, el('span', { text: m.kind === 'part' ? 'Part' : 'Material' }), s);
      })() : null;
    const shaped = !['all', 'part', 'material'].includes(m.kind);
    box.replaceChildren(
      el('h4', { class: 'music-subhead', text: 'Layer' }),
      el('div', { class: 'sb-row' }, name, el('label', { class: 'sb-inline' }, el('span', { text: 'Material' }), mat), el('label', { class: 'sb-inline', title: l.material ? 'A tint over the material (grey leaves it as it is)' : 'The layer\'s colour' }, el('span', { text: l.material ? 'Tint' : 'Colour' }), color)),
      el('div', { class: 'sb-fields' }, slider(l, 'opacity', 'Opacity', 0, 1, 0.01),
        ...(l.material ? [slider(l, 'scale', 'Size of one tile (m)', 0.05, 20, 0.05), slider(l, 'normalStrength', 'Relief', 0, 3, 0.05)] : [slider(l, 'roughness', 'Roughness', 0, 1, 0.01), slider(l, 'metallic', 'Metal', 0, 1, 0.01), slider(l, 'height', 'Height (mid: flat)', 0, 1, 0.01)])),
      el('div', { class: 'sb-row' }, el('span', { class: 'pref-hint', text: 'Paints:' }), check('useColor', 'colour'), check('useRoughness', 'roughness'), check('useMetallic', 'metal'), ...(l.material ? [check('useNormal', 'relief')] : []), check('useHeight', 'height')),
      el('h4', { class: 'music-subhead', text: 'Where it shows (smart mask)' }),
      el('div', { class: 'sb-row' }, kind, which, el('label', { class: 'sb-inline' }, invert, el('span', { text: 'Everywhere else instead' }))),
      shaped ? el('div', { class: 'sb-fields' }, slider(m, 'amount', 'Amount', 0, 1, 0.01), slider(m, 'softness', 'Softness', 0, 1, 0.01), slider(m, 'noise', 'Break up with noise', 0, 1, 0.01), slider(m, 'noiseScale', 'Noise size (m)', 0.01, 5, 0.01)) : null);
  }

  function bakePane() {
    return [
      el('h4', { class: 'music-subhead', text: 'Model' }),
      model ? el('div', { class: 'fg-modelinfo', id: 'fg-modelinfo' },
        el('p', { text: `${model.name}: ${model.triangles.toLocaleString()} triangles, about ${model.size.map((v) => v.toFixed(2)).join(' × ')} m` }),
        el('ul', {}, ...model.sets.map((s) => el('li', { text: `${s.name}: ${s.triangles.toLocaleString()} triangles${s.unwrapped ? ' · UVs laid out by NoorForge' : ''}` }))),
        el('p', { class: 'pref-hint', text: `Parts: ${model.parts.join(', ')}` })) : el('p', { class: 'pref-hint', text: 'No model yet.' }),
      el('button', { class: 'utility-btn', onclick: pickModel }, '📂 Open another model…'),
      el('h4', { class: 'music-subhead', text: 'Bakes (what the smart masks read)' }),
      el('div', { class: 'sb-fields' },
        slider(recipe, 'aoRays', 'Ambient occlusion rays (more: smoother, slower)', 0, 128, 1),
        slider(recipe, 'aoDistance', 'How far occlusion reaches (share of the model)', 0.01, 1, 0.01),
        slider(recipe, 'edgeWidth', 'How wide edges and creases are (share of the model)', 0, 0.2, 0.002)),
    ];
  }

  // ---------------------------------------------------------------- files

  async function pickModel() {
    try {
      const r = await req('forge.model.pick');
      if (!r || r.cancelled) return;
      model = r;
      recipe.model = r.path;
      if (/^Textured model/.test(recipe.name)) recipe.name = r.name;
      render = null;
      changed('all'); renderAll();
    } catch (err) { hooks.showError(err); }
  }

  /** The Asset Bench's tree or rock, sent here to be textured (a stony smart material to start with for rocks). */
  async function openAsset(key, name, isRock) {
    await open();
    try {
      const r = await req('forge.fromAsset', { key, name });
      model = r;
      recipe.model = r.path;
      recipe.name = r.name;
      if (isRock && lists.smart.some((x) => x.id === 'mossy-stone')) { recipe.layers = smartLayers('mossy-stone'); selected = recipe.layers.length - 1; }
      render = null;
      changed('all'); renderAll();
      notice(`“${r.name}” is in NoorForge: choose a smart material or build up layers`, 2600);
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

  return {
    init, open, close, toggle, isOpen, openAsset,
    _state: () => ({ recipe: recipe ? clone(recipe) : null, model, selected, tab, view, viewMode: viewer ? viewer.state().mode : null, render: render ? clone(render) : null, history: history.length }),
  };
})();
