// Asset Bench: game-ready trees, realistic or stylized. The page edits a recipe; the app grows the tree, meshes it
// (welded limbs, real collars and root flare, not scaled cylinders) and builds every level of detail; the preview shows
// the very GLB an export writes. Exports go to a folder or a game project, with the recipe and a manifest beside them.
window.NoorAssets = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let hooks = { showError: (e) => console.error(e) };
  let built = false;
  let recipe = null;
  let presets = { builtIn: [], mine: [], barks: [] };
  let selectedPreset = '';
  let look = (() => { try { return ['all', 'realistic', 'stylized'].includes(localStorage.getItem('noormd.assets.look')) ? localStorage.getItem('noormd.assets.look') : 'all'; } catch { return 'all'; } })();
  let tab = 'tree';
  let viewer = null;
  let build = null;          // the last build: { key, lods, nodes, notes, ms }
  let lod = 0;
  let viewMode = (() => { try { return localStorage.getItem('noormd.assets.view') || 'shaded'; } catch { return 'shaded'; } })();
  let wind = false, wireframe = false;
  let buildGen = 0, buildTimer = 0, snapTimer = 0;
  let history = [], future = [], lastSnapshot = '';
  let exportWhere = null;
  // Godot first (one file: the NoorMD plugin switches its levels), then Unity (one file: a LOD Group from the names), Unreal.
  const exportDefaults = { textureSize: 1024, engine: 'godot', lodFiles: 'one', variants: 1, spread: 0.15, shaders: true, godotInProject: true };
  let exportPrefs = (() => { try { return { ...exportDefaults, ...JSON.parse(localStorage.getItem('noormd.assets.export') || '{}') }; } catch { return { ...exportDefaults }; } })();
  const ENGINES = {
    godot: { name: 'Godot 4', lodFiles: 'one', helper: 'Godot import plugin: levels switched by distance, wind', title: 'addons/noor_trees: written into your Godot project’s addons folder when you export into a Godot project (otherwise beside the trees, to copy there). Turn it on once in Project Settings → Plugins; every NoorMD tree you import then gets its levels of detail switched by distance and the wind shader with its own textures. Other scenes are left alone.' },
    unity: { name: 'Unity', lodFiles: 'one', helper: 'Wind function for Shader Graph (NoorTreeWind.hlsl)', title: 'Unity makes a LOD Group from the _LOD0, _LOD1… names in one file. NoorTreeWind.hlsl goes in a Custom Function node (it reads UV1 and UV2). Written once: one already in the folder is kept' },
    unreal: { name: 'Unreal Engine', lodFiles: 'separate', helper: 'Wind function for a Custom node (NoorTreeWind.hlsl)', title: 'A file per level, to set as the static mesh’s LODs. NoorTreeWind.hlsl goes in a Custom node feeding World Position Offset (TexCoord 1 and 2). Written once: one already in the folder is kept' },
    other: { name: 'Other (glTF)', lodFiles: 'separate', helper: 'Wind shaders (NoorTreeWind.gdshader and .hlsl)', title: 'Godot 4 and HLSL versions of the wind, reading the wind data in the files. Written once: ones already in the folder are kept' },
  };
  if (!ENGINES[exportPrefs.engine]) exportPrefs.engine = 'godot';
  let lastExport = null;

  const isOpen = () => document.body.classList.contains('assets-open');

  const ARCHETYPES = [['broadleaf', 'Broadleaf (oak, maple…)'], ['conifer', 'Conifer (pine, spruce…)'], ['birch', 'Birch-like (slender, drooping)'], ['dead', 'Dead or twisted (bare)']];
  const STYLES = [['realistic', 'Realistic'], ['stylized', 'Stylized (painted fantasy)']];
  const SHAPES = [['spherical', 'Round'], ['hemispherical', 'Dome'], ['conical', 'Cone'], ['cylindrical', 'Column'], ['flame', 'Flame'], ['inverse', 'Upside-down cone (vase)'], ['tapered', 'Tapered column'], ['umbrella', 'Umbrella (flat top)']];
  const ROOTS = [['flare', 'Flared base (buttresses)'], ['surface', 'Surface roots (long, forking, sinking in)'], ['prop', 'Stilt roots (mangrove)'], ['compact', 'Compact (a collar only)']];
  const ARRANGE = [['scatter', 'Scattered cards'], ['single', 'Single cards'], ['cross', 'Crossed pairs'], ['star', 'Stars of three'], ['fan', 'Fans (spruce tiers, acacia)'], ['dome', 'Domes (full broadleaf)'], ['hanging', 'Hanging curtains (willow)'], ['fronds', 'Fronds along the branches (palm, fern)']];
  const BRANCH_MODES = [['merged', 'Merged: one welded mesh'], ['separate', 'Separate: each limb its own mesh'], ['mixed', 'Mixed: thick limbs welded, thin ones separate']];
  const FOLIAGE = [['cards', 'Leaf cards on the branches'], ['tufts', 'Leaf tufts (cards shaped into clumps, no solid mesh)'], ['clumps', 'Solid clumps (puffy, painted)'], ['both', 'Solid clumps with a leafy edge'], ['crystals', 'Crystals (glowing shards)'], ['none', 'None (bare)']];
  const CLUSTERS = [['twig', 'A twig'], ['spray', 'A spray (3 twigs)'], ['cluster', 'A cluster (dense)']];
  const LEAVES = [['broad', 'Broad leaves'], ['round', 'Round leaves'], ['maple', 'Maple-like'], ['slender', 'Slender (willow)'], ['needle', 'Needles'], ['frond', 'Fronds (palm, fern)']];
  const QUALITY = [['low', 'Low (fast, chunky)'], ['medium', 'Medium'], ['high', 'High (fine detail, slower)']];
  const VIEWS = [['shaded', 'Shaded'], ['clay', 'Clay'], ['parts', 'Parts'], ['wind', 'Wind data']];

  function init(h) {
    hooks = { ...hooks, ...h };
    NoorBridge.on('asset.exportProgress', (p) => setStatus(p.stage || ''));
  }

  async function open() {
    if (!built) build_();
    if (window.NoorDock) NoorDock.opened('assets');
    document.body.classList.add('assets-open');
    $('#assetbench').hidden = false;
    if (!presets.builtIn.length) await loadPresets();
    if (!recipe && presets.builtIn.length) await loadPreset(presets.builtIn[0].id);
    $('#assetbench').focus({ preventScroll: true });
  }

  function close() {
    if (!built || !isOpen()) return;
    document.body.classList.remove('assets-open');
    $('#assetbench').hidden = true;
    if (viewer) viewer.setWind(0);
    if (window.NoorDock) NoorDock.closed('assets');
  }

  function toggle() { if (isOpen()) close(); else open(); }

  // ---------------------------------------------------------------- layout

  function build_() {
    built = true;
    const root = el('section', { id: 'assetbench', class: 'soundbench texbench assetbench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'Asset Bench' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '🌳' }), el('strong', { text: 'Asset Bench' }), el('small', { id: 'ab-kind' })),
        el('span', { class: 'panel-head-buttons' },
          el('button', { class: 'icon-btn', id: 'ab-open', title: 'Open a recipe (.noortree.json)', 'aria-label': 'Open a recipe', onclick: openRecipe }, '📂'),
          NoorDock.fullButton('Asset Bench'),
          el('button', { class: 'icon-btn', title: 'Where this panel goes', 'aria-label': 'Move the Asset Bench', onclick: (e) => NoorDock.showMenu('assets', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn', title: 'Close (Ctrl+Alt+M)', 'aria-label': 'Close the Asset Bench', onclick: close }, '✕'))),
      el('div', { class: 'sb-main' },
        el('nav', { class: 'sb-presets', id: 'ab-presets', 'aria-label': 'Trees' }),
        el('div', { class: 'sb-editor' },
          el('div', { class: 'sb-top', id: 'ab-top' },
            el('input', { type: 'text', id: 'ab-name', class: 'tb-name', 'aria-label': 'Name of the tree', spellcheck: 'false', maxlength: '80' }),
            el('label', { class: 'sb-seed', title: 'The random seed: the same seed gives the same tree' }, el('span', { text: 'Seed' }), el('input', { type: 'number', id: 'ab-seed', min: '0', max: '2147483647', step: '1' })),
            el('button', { class: 'utility-btn', id: 'ab-vary', title: 'Another tree of the same kind: same recipe, another seed (V)', onclick: newVariation }, '🎲 Variation')),
          el('div', { class: 'tb-split', id: 'ab-split' },
            el('div', { class: 'tb-view-col', id: 'ab-view-col' },
              el('div', { class: 'tb-views', role: 'group', 'aria-label': 'Preview' },
                (() => {
                  const s = el('select', { id: 'ab-view', 'aria-label': 'Show', title: 'Shaded: as in a game · Clay: the shape alone · Parts: each separate mesh in its own colour · Wind data: red sway, green bend, blue flutter' }, ...VIEWS.map(([v, t]) => el('option', { value: v, text: t })));
                  s.value = viewMode;
                  s.addEventListener('change', () => { viewMode = s.value; try { localStorage.setItem('noormd.assets.view', viewMode); } catch { /* private storage off */ } if (viewer) viewer.setMode(viewMode); });
                  return s;
                })(),
                el('select', { id: 'ab-lod', 'aria-label': 'Level of detail', title: 'Which level of detail to show (LOD0 is the closest, most detailed)' }),
                el('button', { class: 'utility-btn', id: 'ab-wire', 'aria-pressed': 'false', title: 'Show the triangles (W)', onclick: () => setWire(!wireframe) }, '▦ Wireframe'),
                el('button', { class: 'utility-btn', id: 'ab-wind', 'aria-pressed': 'false', title: 'Play the wind from the wind data in the file, as a game shader would (Space)', onclick: () => setWind(!wind) }, '🍃 Wind'),
                el('span', { class: 'sb-fx-space' }),
                el('button', { class: 'icon-btn', title: 'Zoom out (−, or the mouse wheel)', 'aria-label': 'Zoom out', onclick: () => viewer && viewer.zoom(1.2) }, '−'),
                el('button', { class: 'icon-btn', title: 'Zoom in (+, or the mouse wheel)', 'aria-label': 'Zoom in', onclick: () => viewer && viewer.zoom(1 / 1.2) }, '+'),
                el('button', { class: 'icon-btn', id: 'ab-reset', title: 'Back to the whole tree', 'aria-label': 'Reset the view', onclick: () => viewer && viewer.reset() }, '⟲'),
                el('button', { class: 'icon-btn', id: 'ab-side', title: 'The tree big, with the settings in a column on the right; or the settings under the tree', 'aria-label': 'Settings beside the tree', 'aria-pressed': 'false', onclick: () => layout.set({ side: !layout.prefs.side }) }, '◫'),
                el('button', { class: 'icon-btn', id: 'ab-list', title: 'Show or hide the list of trees', 'aria-label': 'List of trees', 'aria-pressed': 'true', onclick: () => layout.set({ list: !layout.prefs.list }) }, '☰')),
              el('div', { class: 'tb-stage' },
                el('canvas', { id: 'ab-canvas', class: 'tb-canvas', role: 'img', 'aria-label': 'The tree: drag to turn it, wheel to zoom, right-drag or Shift+drag to move', title: 'Drag: turn · wheel: zoom · right-drag or Shift+drag: move' })),
              el('p', { class: 'pref-hint sb-status', id: 'ab-status', 'aria-live': 'polite' }),
              el('p', { class: 'pref-hint ab-stats', id: 'ab-stats' }),
              el('p', { class: 'pref-hint ab-stats', id: 'ab-cost', title: 'Measured from four sides as a game draws it. Crown full: how much of the crown’s outline the leaves cover (sky through the crown lowers it). Overdraw: leaf pixels drawn per leaf pixel seen. See-through: the share of the cards’ area cut away by the alpha, which the GPU still pays for' })),
            el('div', { class: 'tb-splitter', id: 'ab-splitter', role: 'separator', tabindex: '0', 'aria-label': 'Drag to change how much room the tree and the settings get (double-click: back to normal)' }),
            el('div', { class: 'tb-edit-col', id: 'ab-edit-col' },
              el('div', { class: 'music-tabs sb-tabs', role: 'tablist' }, ...[['tree', 'Tree'], ['branches', 'Branches'], ['leaves', 'Leaves & bark'], ['mesh', 'Mesh'], ['export', 'Export']].map(([id, label]) =>
                el('button', { role: 'tab', 'data-tab': id, class: id === tab ? 'active' : '', onclick: () => { tab = id; renderEditor(); } }, label))),
              el('div', { class: 'sb-pane', id: 'ab-pane' }))))));
    ($('#app') || document.body).append(root);
    $('#ab-name').addEventListener('input', (e) => { recipe.name = e.target.value; changed(false, true); });
    $('#ab-seed').addEventListener('change', (e) => { recipe.seed = Math.max(0, Math.min(2147483647, Math.round(Number(e.target.value) || 0))); changed(false); });
    $('#ab-lod').addEventListener('change', (e) => { lod = Number(e.target.value) || 0; showLod(); });
    new ResizeObserver(() => root.classList.toggle('wide', root.clientWidth >= 820)).observe(root);
    root.addEventListener('keydown', (e) => {
      const typing = e.target.closest('input[type=text], input[type=number], select, textarea');
      if (e.key === 'Escape' && !typing && !document.body.classList.contains('zen')) { e.preventDefault(); e.stopPropagation(); close(); return; } // in the whole window, Esc goes back to NoorMD
      if (typing || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && e.ctrlKey) { e.preventDefault(); undo(e.shiftKey); }
      else if (k === 'y' && e.ctrlKey) { e.preventDefault(); undo(true); }
      else if (e.ctrlKey) return;
      else if (k === 'v') { e.preventDefault(); newVariation(); }
      else if (k === 'w') { e.preventDefault(); setWire(!wireframe); }
      else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); setWind(!wind); }
    });
    // Stacked (the settings under the tree) or side by side (the tree takes the room, the settings a column on the right).
    layout = NoorBenchLayout.attach({
      root, storageKey: 'noormd.assets.layout', split: $('#ab-split'), viewCol: $('#ab-view-col'), editCol: $('#ab-edit-col'), splitter: $('#ab-splitter'),
      sideButton: $('#ab-side'), listButton: $('#ab-list'), top: $('#ab-top'), sideSized: 'edit',
    });
    try { viewer = NoorAssetView.create($('#ab-canvas')); viewer.setMode(viewMode); } catch (err) { console.warn('Asset Bench: no 3D preview', err); viewer = null; setStatus('The 3D preview needs WebGL 2, which is not available here. Exports still work.'); }
  }

  /** How the bench is arranged (NoorBenchLayout, remembered). */
  let layout = { prefs: {}, set() {}, apply() {} };

  function setStatus(text) { const s = $('#ab-status'); if (s) s.textContent = text; }

  function setWire(on) {
    wireframe = !!on;
    $('#ab-wire').setAttribute('aria-pressed', String(wireframe)); $('#ab-wire').classList.toggle('active', wireframe);
    if (viewer) viewer.setWireframe(wireframe);
  }

  function setWind(on) {
    wind = !!on;
    $('#ab-wind').setAttribute('aria-pressed', String(wind)); $('#ab-wind').classList.toggle('active', wind);
    if (viewer) viewer.setWind(wind ? 1 : 0);
  }

  // ---------------------------------------------------------------- presets

  async function loadPresets() {
    try { presets = await req('asset.presets'); renderPresets(); } catch (err) { hooks.showError(err); }
  }

  function renderPresets() {
    const nav = $('#ab-presets');
    const item = (p) => el('button', { class: 'gnav-item' + (p.id === selectedPreset ? ' active' : ''), 'data-preset': p.id, title: p.description || '', onclick: () => loadPreset(p.id) }, p.name);
    const shown = presets.builtIn.filter((p) => look === 'all' || (look === 'stylized') === (p.style === 'stylized'));
    const groupNames = [...new Set(shown.map((p) => p.group || 'Forest'))];
    const groups = [...groupNames.map((g) => [g, shown.filter((p) => (p.group || 'Forest') === g)]), ['Mine', presets.mine]];
    const looks = el('div', { class: 'ab-looks', role: 'group', 'aria-label': 'Show' }, ...[['all', 'All'], ['realistic', 'Realistic'], ['stylized', 'Stylized']].map(([v, t]) =>
      el('button', { class: 'utility-btn' + (look === v ? ' active' : ''), 'data-look': v, 'aria-pressed': String(look === v), onclick: () => { look = v; try { localStorage.setItem('noormd.assets.look', v); } catch { /* private storage off */ } renderPresets(); } }, t)));
    nav.replaceChildren(looks, ...groups.flatMap(([title, list]) => list.length ? [el('div', { class: 'gnav-head', text: title }), ...list.map(item)] : []),
      el('button', { class: 'utility-btn sb-save', id: 'ab-save', title: 'Keep this recipe in “Mine”', onclick: savePreset }, '💾 Save as mine'),
      ...(selectedPreset.startsWith('user:') ? [el('button', { class: 'utility-btn', id: 'ab-delete', onclick: deletePreset }, '🗑 Delete this one')] : []));
  }

  async function loadPreset(id) {
    try { selectedPreset = id; setRecipe(await req('asset.preset', { id }), true); renderPresets(); } catch (err) { hooks.showError(err); }
  }

  async function savePreset() {
    try {
      const r = await req('asset.save', { recipe });
      presets.mine = r.mine; selectedPreset = r.id; renderPresets();
      notice(r.replaced ? `“${recipe.name}” updated in Mine` : `“${recipe.name}” saved in Mine`, 1600);
    } catch (err) { hooks.showError(err); }
  }

  async function deletePreset() {
    if (!selectedPreset.startsWith('user:')) return;
    try { presets.mine = (await req('asset.delete', { id: selectedPreset })).mine; selectedPreset = ''; renderPresets(); } catch (err) { hooks.showError(err); }
  }

  async function openRecipe() {
    try {
      const r = await req('asset.open');
      if (!r || r.cancelled) return;
      selectedPreset = ''; renderPresets();
      setRecipe(r.recipe, true);
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- recipe, builds, history

  function setRecipe(r, fresh) {
    if (!fresh && recipe) pushHistory();
    recipe = r;
    if (fresh) { clearTimeout(snapTimer); history = []; future = []; }
    lastSnapshot = JSON.stringify(recipe);
    renderEditor();
    rebuild();
  }

  /** Something changed: rebuild once the change settles, and an undo step. A new name alone needs no rebuild. */
  function changed(rerender, nameOnly) {
    if (rerender) renderEditor(); else renderHeader();
    clearTimeout(snapTimer);
    snapTimer = setTimeout(pushHistory, 600);
    if (nameOnly) return;
    clearTimeout(buildTimer);
    buildTimer = setTimeout(rebuild, 350);
  }

  function pushHistory() {
    const now = JSON.stringify(recipe);
    if (lastSnapshot && lastSnapshot !== now) { history.push(lastSnapshot); if (history.length > 100) history.shift(); future = []; }
    lastSnapshot = now;
  }

  function undo(redo) {
    clearTimeout(snapTimer);
    pushHistory();
    const from = redo ? future : history, to = redo ? history : future;
    if (!from.length) { notice(redo ? 'Nothing to redo' : 'Nothing to undo', 900); return; }
    to.push(JSON.stringify(recipe));
    recipe = JSON.parse(from.pop());
    lastSnapshot = JSON.stringify(recipe);
    renderEditor();
    rebuild();
  }

  function newVariation() {
    if (!recipe) return;
    pushHistory();
    recipe.seed = Math.floor(Math.random() * 1000000);
    renderHeader();
    changed(false);
  }

  async function rebuild() {
    clearTimeout(buildTimer);
    if (!recipe) return;
    const gen = ++buildGen;
    setStatus('Growing the tree…');
    try {
      const out = await req('asset.build', { recipe });
      if (gen !== buildGen || !out || out.cancelled) return;
      build = out;
      if (lod >= out.lods.length) lod = 0;
      $('#ab-lod').replaceChildren(...out.lods.map((l, i) => el('option', { value: String(i), text: `LOD${i} · ${l.triangles.toLocaleString()} triangles` })));
      $('#ab-lod').value = String(lod);
      await showLod();
      if (gen !== buildGen) return;
      setStatus(`Built in ${out.ms < 1000 ? out.ms + ' ms' : (out.ms / 1000).toFixed(1) + ' s'} · ${out.branches} branches${out.notes && out.notes.length ? ' · ' + out.notes.join(' ') : ''}`);
      renderStats();
    } catch (err) { if (gen === buildGen) setStatus(err && err.message ? err.message : String(err)); }
  }

  async function showLod() {
    if (!build || !viewer) return;
    const l = build.lods[lod];
    try {
      const res = await fetch(l.url);
      if (!res.ok) throw new Error('The preview mesh is no longer there; change something to build it again.');
      await viewer.load(await res.arrayBuffer());
      viewer.setMode(viewMode); viewer.setWireframe(wireframe); viewer.setWind(wind ? 1 : 0);
    } catch (err) { setStatus(err && err.message ? err.message : String(err)); }
    renderStats();
  }

  function renderStats() {
    const s = $('#ab-stats');
    if (!s || !build) return;
    const l = build.lods[lod];
    const parts = build.nodes.length;
    s.textContent = `LOD${lod}: ${l.triangles.toLocaleString()} triangles · ${l.vertices.toLocaleString()} vertices · ${(l.bytes / 1024).toFixed(0)} KB · ${parts} mesh${parts === 1 ? '' : 'es'}` +
      (parts > 1 ? ` (${build.nodes.slice(0, 4).map((n) => n.name).join(', ')}${parts > 4 ? '…' : ''})` : '');
    // Where the triangles go and what they buy: wood against leaves, how full the crown looks, what the leaves cost to draw.
    const c = $('#ab-cost');
    if (!c) return;
    const pct = (v) => `${Math.round(v * 100)} %`;
    c.textContent = l.wood === undefined ? '' : [
      `Wood ${l.wood.toLocaleString()} · leaves ${l.leaves.toLocaleString()} triangles`,
      l.fullness != null ? `crown ${pct(l.fullness)} full` : null,
      l.overdraw != null ? `overdraw ×${l.overdraw.toFixed(1)}${l.emptyCards != null ? ` (${pct(l.emptyCards)} of the card area see-through)` : ''}` : null,
      `${l.drawCalls} draw call${l.drawCalls === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ');
  }

  // ---------------------------------------------------------------- editor

  function renderHeader() {
    if (!recipe) return;
    const name = $('#ab-name'), seed = $('#ab-seed');
    if (document.activeElement !== name) name.value = recipe.name;
    if (document.activeElement !== seed) seed.value = String(recipe.seed);
    $('#ab-kind').textContent = `${(STYLES.find((s) => s[0] === recipe.style) || ['', ''])[1]} · ${(ARCHETYPES.find((a) => a[0] === recipe.archetype) || ['', ''])[1]}`;
  }

  function renderEditor() {
    if (!recipe) return;
    renderHeader();
    document.querySelectorAll('#assetbench .sb-tabs [data-tab]').forEach((b) => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    const pane = $('#ab-pane');
    const keep = pane.scrollTop;
    // Keep the keyboard where it was (a re-render replaces the controls).
    const focused = document.activeElement && pane.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') : null;
    pane.replaceChildren(...(tab === 'tree' ? treePane() : tab === 'branches' ? branchesPane() : tab === 'leaves' ? leavesPane() : tab === 'mesh' ? meshPane() : exportPane()).filter(Boolean));
    pane.scrollTop = keep;
    if (focused) { const f = pane.querySelector(`[data-key="${focused}"]`); if (f) f.focus(); }
  }

  const UNIT = { pct: ['%', 100], int: ['', 1], num: ['', 1], m: ['m', 1], deg: ['°', 1], cm: ['cm', 100] };

  /** A slider bound to obj[key], with a number box beside it for an exact value. */
  function slider(obj, [key, label, min, max, step, kind, hint], rerender) {
    const [unit, factor] = UNIT[kind] || ['', 1];
    const clamp = (v) => Math.max(min, Math.min(max, v));
    const shown = (v) => String(Number((v * factor).toFixed(kind === 'int' ? 0 : 2)));
    const value = Number(obj[key]) || 0;
    const box = el('input', { type: 'number', class: 'sb-num', value: shown(value), step: 'any', 'aria-label': `${label}${unit ? ` (${unit})` : ''}`, 'data-num': key });
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(clamp(value)), 'aria-label': label, 'data-key': key });
    const set = (v) => { obj[key] = kind === 'int' ? Math.round(v) : Number(v.toFixed(5)); };
    input.addEventListener('input', () => { set(Number(input.value)); box.value = shown(obj[key]); changed(!!rerender); });
    box.addEventListener('change', () => {
      const typed = Number(box.value);
      if (!Number.isFinite(typed)) { box.value = shown(obj[key]); return; }
      set(clamp(typed / factor));
      box.value = shown(obj[key]); input.value = String(obj[key]);
      changed(!!rerender);
    });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.dispatchEvent(new Event('change')); } });
    return el('label', { class: 'sb-slider', title: hint || '' }, el('span', { text: label }), input, el('span', { class: 'sb-numwrap' }, box, unit ? el('small', { text: unit }) : null));
  }

  function choice(obj, key, label, options, hint, rerender) {
    const s = el('select', { 'aria-label': label, 'data-key': key, title: hint || '' }, ...options.map(([v, t]) => el('option', { value: v, text: t })));
    s.value = obj[key];
    s.addEventListener('change', () => { obj[key] = s.value; changed(!!rerender); });
    return el('label', { class: 'sb-inline ab-choice' }, el('span', { text: label }), s);
  }

  function check(obj, key, label, hint, rerender) {
    const c = el('input', { type: 'checkbox', checked: obj[key] || undefined, 'data-key': key });
    c.addEventListener('change', () => { obj[key] = c.checked; changed(!!rerender); });
    return el('label', { class: 'sb-inline', title: hint || '' }, c, el('span', { text: label }));
  }

  function colour(obj, key, label) {
    const c = el('input', { type: 'color', value: obj[key], 'data-key': key, 'aria-label': label });
    c.addEventListener('input', () => { obj[key] = c.value; changed(false); });
    return el('label', { class: 'sb-inline ab-colour' }, el('span', { text: label }), c);
  }

  /** A button that picks a picture of your own for the bark or the leaves, with its name and a way back to generated. */
  function ownPicture(key, kind, label, hint) {
    const name = recipe[key] ? recipe[key].split(/[\\/]/).pop() : '';
    return el('div', { class: 'sb-row' },
      el('button', { class: 'utility-btn', 'data-own': kind, title: hint, onclick: async () => {
        try {
          const f = await req('asset.image.pick', { kind });
          if (!f || f.cancelled) return;
          recipe[key] = f.path;
          changed(true);
        } catch (err) { hooks.showError(err); }
      } }, '🖼 ' + label),
      name ? el('span', { class: 'sb-file', title: recipe[key], text: name }) : null,
      name ? el('button', { class: 'icon-btn', 'data-own-clear': kind, title: 'Back to the generated one', 'aria-label': 'Remove the picture', onclick: () => { recipe[key] = ''; changed(true); } }, '✕') : null);
  }

  const section = (title, ...children) => el('fieldset', { class: 'sb-group' }, el('legend', { text: title }), ...children);

  function treePane() {
    return [
      section('Kind',
        el('div', { class: 'sb-row' }, choice(recipe, 'style', 'Look', STYLES, 'Realistic: natural proportions, leaf cards, bark textures. Stylized: chunky, twisted, puffy clumps with painted gradients'), choice(recipe, 'archetype', 'Tree', ARCHETYPES, 'How the tree grows: its crown and branching'))),
      section('Trunk',
        slider(recipe, ['height', 'Height', 0.3, 120, 0.1, 'm', 'The whole tree, ground to top: it is exactly this tall']),
        slider(recipe, ['trunkRadius', 'Trunk radius', 0.01, 6, 0.01, 'm']),
        slider(recipe, ['taper', 'Taper', 0, 1, 0.01, 'pct', 'How much thinner the trunk gets towards the top']),
        slider(recipe, ['crownStart', 'Crown starts at', 0.05, 1, 0.01, 'pct', 'Where the trunk splits into the crown (100% keeps one leader to the top, as conifers do)']),
        slider(recipe, ['lean', 'Lean', 0, 45, 1, 'deg']),
        slider(recipe, ['wobble', 'Wobble', 0, 30, 0.5, 'deg', 'Random bends along the trunk']),
        slider(recipe, ['twist', 'Twist', -3, 3, 0.05, 'num', 'Spiral turns over the height: the fantasy look loves it']),
        slider(recipe, ['sCurve', 'S-curve', 0, 0.3, 0.01, 'pct', 'A sideways S in the trunk, as a share of the height']),
        slider(recipe, ['windswept', 'Windswept', 0, 1, 0.01, 'pct', 'Every branch pulled the same way and the trunk leaning with it: a tree on a windy cliff or coast'])),
      section('Trunk shape',
        slider(recipe, ['flute', 'Fluting', 0, 1, 0.01, 'pct', 'Ridges and grooves running up the trunk (sequoia, cypress)']),
        recipe.flute > 0 ? slider(recipe, ['fluteLobes', 'Ridges', 3, 14, 1, 'int']) : null,
        recipe.flute > 0 ? slider(recipe, ['fluteHeight', 'Ridges reach', 0.05, 1, 0.01, 'pct', 'How far up the trunk the ridges run']) : null,
        slider(recipe, ['bulge', 'Bulge', 0, 1.5, 0.01, 'pct', 'A swelling of the trunk (baobab, bottle tree)']),
        recipe.bulge > 0 ? slider(recipe, ['bulgeAt', 'Bulge at', 0, 1, 0.01, 'pct']) : null),
      section('Base and roots',
        choice(recipe, 'rootStyle', 'Roots', ROOTS, 'How the tree meets the ground', true),
        recipe.rootStyle === 'flare' ? slider(recipe, ['flare', 'Root flare', 0, 1, 0.01, 'pct', 'Roots melted into the base: buttresses that grip the ground']) : null,
        recipe.rootStyle !== 'compact' ? slider(recipe, ['roots', 'How many', 0, 12, 1, 'int']) : null,
        recipe.rootStyle === 'surface' || recipe.rootStyle === 'prop' ? slider(recipe, ['rootLength', 'Length', 0.2, 4, 0.05, 'num', 'Times the usual length']) : null,
        recipe.rootStyle === 'surface' ? slider(recipe, ['rootForks', 'Forks', 0, 3, 1, 'int']) : null,
        recipe.rootStyle === 'surface' ? slider(recipe, ['rootBurial', 'Sinking in', 0, 1, 0.01, 'pct', 'How deep the tips sink below the ground']) : null,
        slider(recipe, ['knees', 'Knees', 0, 60, 1, 'int', 'Cypress knees: woody cones rising out of the ground or water around the tree']),
        slider(recipe, ['collar', 'Collars', 0, 1, 0.01, 'pct', 'How smoothly limbs grow out of their parent (the swelling where a branch leaves the trunk)'])),
      section('Crown', choice(recipe, 'shape', 'Shape', SHAPES, 'How long the limbs are from the bottom of the crown to its top')),
    ];
  }

  function branchesPane() {
    const levels = recipe.levels.map((l, i) => section(`Level ${i + 1}: ${i === 0 ? 'limbs on the trunk' : i === 1 ? 'branches on the limbs' : 'twigs'}`,
      slider(l, ['count', 'How many', 0, 80, 1, 'int', i === 0 ? 'On the trunk' : 'On each branch of the level above (fewer on short ones)']),
      slider(l, ['start', 'Start at', 0, 0.95, 0.01, 'pct', 'Where along the parent they begin']),
      slider(l, ['angle', 'Angle', 0, 140, 1, 'deg', 'Away from the parent']),
      slider(l, ['angleSpread', 'Angle spread', 0, 60, 1, 'deg']),
      slider(l, ['length', 'Length', 0.02, 1.5, 0.01, 'pct', 'As a share of the parent’s length']),
      slider(l, ['lengthSpread', 'Length spread', 0, 0.9, 0.01, 'pct']),
      slider(l, ['radius', 'Thickness', 0.05, 0.95, 0.01, 'pct', 'As a share of the parent’s thickness where it grows']),
      slider(l, ['bend', 'Bend', -120, 120, 1, 'deg', 'Up towards the light (positive) or drooping (negative)']),
      slider(l, ['wobble', 'Wobble', 0, 45, 0.5, 'deg']),
      slider(l, ['spiral', 'Turn between', 0, 360, 0.5, 'deg', '137.5° (the golden angle) spreads them evenly round the parent']),
      slider(l, ['whorl', 'In rings of', 1, 12, 1, 'int', 'Several at the same height, as on pines (1: spread out)']),
      el('button', { class: 'utility-btn', 'data-remove-level': String(i), onclick: () => { recipe.levels.splice(i, 1); changed(true); } }, '✕ Remove this level')));
    return [
      ...levels,
      recipe.levels.length < 3 ? el('button', { class: 'utility-btn', id: 'ab-add-level', onclick: () => { const last = recipe.levels[recipe.levels.length - 1]; recipe.levels.push(last ? { ...clone(last), count: Math.max(3, Math.round(last.count * 0.7)), length: 0.45, radius: 0.5 } : { count: 8, start: 0.3, angle: 50, angleSpread: 12, length: 0.5, lengthSpread: 0.15, radius: 0.55, bend: 15, wobble: 6, spiral: 137.5, whorl: 1 }); changed(true); } }, '＋ Add a level') : null,
    ];
  }

  function leavesPane() {
    const barkOptions = [['', 'Plain colour'], ...presets.barks.map((b) => [b.id, b.name])];
    return [
      section('Leaves',
        el('div', { class: 'sb-row' }, choice(recipe, 'arrangement', 'Set as', ARRANGE, 'How the leaf cards are set where leaves grow', true)),
        recipe.arrangement === 'hanging' ? slider(recipe, ['hangLength', 'Curtain length', 0.2, 30, 0.1, 'm', 'How far the curtains hang (they stop above the ground)']) : null,
        el('div', { class: 'sb-row' }, choice(recipe, 'foliage', 'Foliage', FOLIAGE, 'Cards: leaf sprites with alpha along the branches (realistic). Tufts: the same cards gathered into chunky clumps (stylized), with no solid mesh. Solid clumps: puffy painted blobs', true), choice(recipe, 'leafShape', 'Leaf', LEAVES)),
        recipe.leafShape === 'frond' ? null : choice(recipe, 'leafCluster', 'Each card shows', CLUSTERS, 'A twig: one stem with its leaves. A spray or a cluster: several stems on one card, many more leaves for the same triangles (the card grows to keep each leaf its size). The way game trees look full'),
        slider(recipe, ['leafDensity', 'Density', 0, 1, 0.01, 'pct', 'How full the crown is']),
        slider(recipe, ['leafSize', 'Size', 0.05, 5, 0.05, 'm', 'How far apart the cards are spread, and their size (or the size of a clump)']),
        slider(recipe, ['cardScale', 'Card size', 0.3, 4, 0.05, 'pct', 'Each card’s plane bigger or smaller without changing how many there are: bigger makes a fuller crown for the same triangles']),
        check(recipe, 'trimCards', 'Cards cut to their leaves', 'Each card is the outline of its leaves (six corners) instead of a rectangle: the same triangles, about half the see-through pixels for the GPU to draw'),
        slider(recipe, ['outerLeaves', 'Outer leaves', 0, 1, 0.01, 'pct', 'Leaves moved from the hidden inside of the crown to its outside, where they are seen']),
        slider(recipe, ['canopyFullness', 'Canopy fullness', 0, 0.98, 0.01, 'pct', 'How full the crown should look (0: off). The crown is looked at from its sides; where the sky shows through, more cards go on the nearest branches until it is this full or the leaf budget is spent']),
        recipe.triangleTarget > 0 ? null : slider(recipe, ['leafBudget', 'Leaf budget', 500, 60000, 500, 'int', 'Most triangles the leaves may use in LOD0. When the density asks for more, the cards get bigger and fewer instead, so the crown stays as full']),
        el('div', { class: 'sb-row' }, colour(recipe, 'leafColor', 'Colour'), colour(recipe, 'leafColor2', 'Light colour')),
        slider(recipe, ['crownNormals', 'Soft crown light', 0, 1, 0.01, 'pct', 'Leaf normals bent to point out of the crown: soft, even lighting instead of flat cards']),
        ownPicture('leafImage', 'leaves', 'Your own leaf picture…', 'A PNG with transparency, the stem at the bottom middle'),
        recipe.leafImage ? check(recipe, 'leafImageAtlas', 'It is a 2 × 2 atlas (each card shows one quarter)') : null),
      section('Fantasy',
        slider(recipe, ['capWidth', 'Mushroom cap', 0, 30, 0.1, 'm', 'A mushroom cap on top of the trunk, this wide (0: none)'], true),
        recipe.capWidth > 0 ? slider(recipe, ['branchCaps', 'Caps on the limbs', 0, 1, 0.01, 'pct', 'Smaller caps on the limb tips, this big compared with the main one']) : null,
        recipe.capWidth > 0 ? el('div', { class: 'sb-row' }, colour(recipe, 'capColor', 'Cap colour'), colour(recipe, 'spotColor', 'Spots')) : null,
        recipe.capWidth > 0 ? slider(recipe, ['spots', 'How many spots', 0, 1, 0.01, 'pct']) : null,
        slider(recipe, ['glow', 'Glow', 0, 1, 0.01, 'pct', 'Crystals, caps and leaves glow in the light colour (the emissive colour of their materials)'])),
      section('Swamp',
        slider(recipe, ['moss', 'Hanging moss', 0, 1, 0.01, 'pct', 'Grey-green moss hanging from the branches (also on bare and dead trees)'], true),
        recipe.moss > 0 ? colour(recipe, 'mossColor', 'Moss colour') : null,
        slider(recipe, ['vines', 'Vines', 0, 60, 1, 'int', 'Vines hanging from the branches'])),
      section('Bark',
        choice(recipe, 'barkMaterial', 'Material', barkOptions, 'A Texture Bench material for the bark (colour, normal and ORM maps)'),
        colour(recipe, 'barkColor', 'Colour'),
        slider(recipe, ['barkTile', 'Bark tile', 0.05, 20, 0.05, 'm', 'How much bark one texture covers']),
        ownPicture('barkImage', 'bark', 'Your own bark picture…', 'A tiling bark texture (colour only)')),
    ];
  }

  /** The whole tree's triangles in LOD0, by what it is for; or the wood and leaf budgets set by hand. */
  const TARGETS = [[0, 'Set the wood and leaf budgets yourself'], [2000, 'Far forest filler · 2,000'], [4000, 'Forest tree · 4,000'], [8000, 'Feature tree · 8,000'], [20000, 'Hero tree · 20,000']];
  function targetChoice() {
    const v = Number(recipe.triangleTarget) || 0;
    const options = TARGETS.some(([t]) => t === v) ? TARGETS : [...TARGETS, [v, `Your own · ${v.toLocaleString()}`]];
    const s = el('select', { 'aria-label': 'Triangle target', 'data-key': 'triangleTarget', title: 'Triangles for the whole tree in LOD0 (each farther level about half). With many thousands of trees in a scene, most are far away and drawn as the billboard; the close ones want a few thousand. A quarter goes to the wood (its finest twigs left out when that is little), the rest to the leaves, filled where the crown is see-through' },
      ...options.map(([t, label]) => el('option', { value: String(t), text: label })));
    s.value = String(v);
    s.addEventListener('change', () => { recipe.triangleTarget = Number(s.value); changed(true); });
    return el('label', { class: 'sb-inline ab-choice' }, el('span', { text: 'Triangle target' }), s);
  }
  function targetSplit() {
    const t = recipe.triangleTarget;
    const leafy = recipe.foliage !== 'none' && recipe.archetype !== 'dead';
    const wood = Math.max(200, Math.floor(t * (leafy ? 0.25 : 1)));
    return leafy ? `About ${wood.toLocaleString()} for the wood and ${Math.max(500, t - wood).toLocaleString()} for the leaves.` : `All ${wood.toLocaleString()} for the wood.`;
  }

  function meshPane() {
    return [
      section('Branches',
        choice(recipe, 'branches', 'Mesh', BRANCH_MODES, 'Merged: one organic welded mesh. Separate: each limb a mesh of its own, with its pivot where it leaves the trunk (to animate or break off). Mixed: thick limbs welded, thinner ones separate', true),
        recipe.branches === 'mixed' ? slider(recipe, ['mixedRadius', 'Weld limbs thicker than', 0.005, 2, 0.005, 'cm']) : null),
      section('Detail',
        choice(recipe, 'quality', 'Quality', QUALITY, 'How finely the surface is sampled before it is simplified to the budget'),
        targetChoice(),
        recipe.triangleTarget > 0
          ? el('small', { class: 'pref-hint', id: 'ab-target-split', text: targetSplit() })
          : slider(recipe, ['budget', 'Budget', 200, 60000, 100, 'int', 'Triangles of wood in LOD0 (leaves come on top)']),
        slider(recipe, ['lods', 'Levels of detail', 1, 6, 1, 'int', 'Each next level has about half the triangles']),
        check(recipe, 'flatShading', 'Flat shading (faceted low-poly look)'),
        check(recipe, 'billboard', 'Billboard as the last level (the tree drawn on crossed cards, for far away)', 'Eight triangles for a whole tree: it is drawn from its sides into a texture and shown on crossed cards', true),
        recipe.billboard ? slider(recipe, ['billboardViews', 'Billboard sides', 2, 4, 1, 'int', 'How many crossed cards (each drawn from its own side)']) : null),
      section('Shading',
        slider(recipe, ['shading', 'Painted shading', 0, 1, 0.01, 'pct', 'In the vertex colours: crowns darker inside and below, lighter on top; trunks darker near the ground. Engines multiply it with the textures. Off when the wind data uses the vertex colours'])),
      section('Wind',
        check(recipe, 'wind', 'Wind data in the mesh', 'Trunk sway, branch bend, leaf flutter and phase, for a wind shader', true),
        recipe.wind ? choice(recipe, 'windData', 'Stored in', [['uv', 'UV2 and UV3 (colours stay true)'], ['color', 'Vertex colours (RGBA)']], 'UV channels: TEXCOORD_1 = bend, flutter; TEXCOORD_2 = phase, sway. Vertex colours: R sway, G bend, B flutter, A phase (viewers may show them as a tint)') : null),
    ];
  }

  function exportPane() {
    if (!exportWhere) exportWhere = NoorExportWhere.panel('model', () => ({ name: recipe.name, family: recipe.archetype, size: exportPrefs.textureSize, lods: recipe.lods + (recipe.billboard ? 1 : 0), lodFiles: exportPrefs.lodFiles, variants: exportPrefs.variants }), hooks.showError);
    const size = el('select', { id: 'ab-tex-size', 'aria-label': 'Texture size' }, ...[[0, 'No textures (plain colours)'], [256, '256 px'], [512, '512 px'], [1024, '1024 px'], [2048, '2048 px']].map(([v, t]) => el('option', { value: String(v), text: t })));
    size.value = String(exportPrefs.textureSize);
    size.addEventListener('change', () => { exportPrefs.textureSize = Number(size.value); saveExportPrefs(); exportWhere.refresh(); });
    const files = el('select', { id: 'ab-lod-files', 'aria-label': 'Levels of detail' }, el('option', { value: 'separate', text: 'A file for each (Name_LOD0.glb…)' }), el('option', { value: 'one', text: 'All in one file (nodes Name_LOD0…)' }));
    files.value = exportPrefs.lodFiles;
    files.addEventListener('change', () => { exportPrefs.lodFiles = files.value; saveExportPrefs(); exportWhere.refresh(); });
    const engine = el('select', { id: 'ab-engine', 'aria-label': 'Engine' }, ...Object.entries(ENGINES).map(([v, e]) => el('option', { value: v, text: e.name })));
    engine.value = exportPrefs.engine;
    const helperBox = el('input', { type: 'checkbox', id: 'ab-shaders', checked: exportPrefs.shaders || undefined });
    helperBox.addEventListener('change', () => { exportPrefs.shaders = helperBox.checked; saveExportPrefs(); });
    const helperText = el('span', { id: 'ab-helper-text', text: ENGINES[exportPrefs.engine].helper });
    const helper = el('label', { class: 'sb-inline', title: ENGINES[exportPrefs.engine].title }, helperBox, helperText);
    // Godot: the plugin goes into the project the trees go into, unless its addons are left alone (then beside the trees).
    const inProjectBox = el('input', { type: 'checkbox', id: 'ab-godot-in-project', checked: exportPrefs.godotInProject !== false || undefined });
    inProjectBox.addEventListener('change', () => { exportPrefs.godotInProject = inProjectBox.checked; saveExportPrefs(); });
    const inProject = el('label', { class: 'sb-inline', id: 'ab-godot-in-project-row', hidden: exportPrefs.engine !== 'godot', title: 'Off: the plugin is written beside the trees (addons/noor_trees), and your project’s own addons folder is not touched' }, inProjectBox, el('span', { text: '…into the Godot project’s addons folder when the trees go into one' }));
    // Picking an engine sets how the levels are filed for it (still yours to change) and which helper comes along.
    engine.addEventListener('change', () => {
      const e = ENGINES[engine.value];
      exportPrefs.engine = engine.value;
      exportPrefs.lodFiles = e.lodFiles;
      files.value = e.lodFiles;
      helperText.textContent = e.helper;
      helper.title = e.title;
      inProject.hidden = engine.value !== 'godot';
      saveExportPrefs();
      exportWhere.refresh();
    });
    const variants = el('input', { type: 'number', id: 'ab-variants', min: '1', max: '50', step: '1', value: String(exportPrefs.variants), 'aria-label': 'Trees in the pack' });
    variants.addEventListener('change', () => { exportPrefs.variants = Math.max(1, Math.min(50, Math.round(Number(variants.value) || 1))); variants.value = String(exportPrefs.variants); saveExportPrefs(); exportWhere.refresh(); spreadRow.hidden = exportPrefs.variants < 2; });
    const spread = el('input', { type: 'range', id: 'ab-spread', min: '0', max: '0.5', step: '0.01', value: String(exportPrefs.spread), 'aria-label': 'Size spread' });
    const spreadText = el('small', { text: `± ${Math.round(exportPrefs.spread * 100)}%` });
    spread.addEventListener('input', () => { exportPrefs.spread = Number(spread.value); spreadText.textContent = `± ${Math.round(exportPrefs.spread * 100)}%`; saveExportPrefs(); });
    const spreadRow = el('label', { class: 'sb-inline', title: 'Each tree is up to this much taller or shorter (the trunk follows)', hidden: exportPrefs.variants < 2 }, el('span', { text: 'Size spread' }), spread, spreadText);
    exportWhere.refresh();
    return [
      section('Variety pack',
        el('div', { class: 'sb-row' },
          el('label', { class: 'sb-inline', title: 'How many trees of this kind: each from its own seed (the first is the one on screen)' }, el('span', { text: 'Trees' }), variants),
          spreadRow),
        el('small', { class: 'pref-hint', text: 'A forest needs many trees: a pack gives each its own shape from the same recipe, numbered _01, _02…, each with its recipe so any can be opened and changed again.' })),
      section('Files',
        el('div', { class: 'sb-row' }, el('label', { class: 'sb-inline' }, el('span', { text: 'For' }), engine), el('label', { class: 'sb-inline' }, el('span', { text: 'Textures' }), size), el('label', { class: 'sb-inline' }, el('span', { text: 'Levels of detail' }), files)),
        helper,
        inProject,
        el('small', { class: 'pref-hint', text: 'GLB (glTF 2.0): Y up, metres, the pivot at the base of the trunk, textures inside the file. The recipe (to open and change it later) and a manifest (wind data layout, levels, materials) go beside it.' })),
      section('Where', exportWhere.node),
      el('div', { class: 'sb-row' },
        el('button', { class: 'utility-btn primary', id: 'ab-export', onclick: exportNow }, '⬇ Export'),
        lastExport ? el('button', { class: 'utility-btn', id: 'ab-reveal', onclick: () => req('asset.reveal', { folder: lastExport.folder }).catch(hooks.showError) }, '📁 Show in folder') : null),
      lastExport ? el('p', { class: 'pref-hint', id: 'ab-exported', text: `Saved ${lastExport.variants > 1 ? `${lastExport.variants} trees (${lastExport.files.length} files)` : lastExport.files.join(', ')} with ${lastExport.variants > 1 ? 'their recipes' : lastExport.recipe}${lastExport.project ? ` in 🎮 ${lastExport.project}` : ''}${lastExport.relative && lastExport.relative !== '.' ? ' / ' + lastExport.relative : ''}.` }) : null,
      lastExport?.godot ? el('p', { class: 'pref-hint', id: 'ab-godot-note', text: lastExport.godot.inProject
        ? `The NoorMD trees plugin is in ${lastExport.godot.resPath}${lastExport.godot.written ? '' : ' (already there)'}. In Godot, turn it on once in Project → Project Settings → Plugins; trees imported after that switch their levels by distance and move in the wind.`
        : 'The NoorMD trees plugin is beside the trees, in addons/noor_trees: copy that folder into your Godot project’s addons folder and turn it on once in Project → Project Settings → Plugins. (Export into a Godot project and it goes there by itself.)' }) : null,
    ];
  }

  function saveExportPrefs() { try { localStorage.setItem('noormd.assets.export', JSON.stringify(exportPrefs)); } catch { /* private storage off */ } }

  async function exportNow() {
    const btn = $('#ab-export');
    btn.disabled = true;
    try {
      const r = await req('asset.export', { recipe, textureSize: exportPrefs.textureSize, lodFiles: exportPrefs.lodFiles, variants: exportPrefs.variants, spread: exportPrefs.spread, shaders: exportPrefs.shaders, engine: exportPrefs.engine, godotInProject: exportPrefs.godotInProject !== false, ...exportWhere.payload() });
      if (!r || r.cancelled) return;
      lastExport = r;
      setStatus(r.variants > 1 ? `Exported ${r.variants} × “${recipe.name}”: ${r.files.length} files` : `Exported “${recipe.name}”: ${r.files.join(', ')}`);
      notice(`“${recipe.name}” exported`, 1600);
      renderEditor();
    } catch (err) { hooks.showError(err); }
    finally { const b = $('#ab-export'); if (b) b.disabled = false; }
  }

  return {
    init, open, close, toggle, isOpen,
    _state: () => ({ recipe: recipe ? clone(recipe) : null, tab, lod, build: build ? { lods: build.lods.length, nodes: build.nodes.map((n) => n.name) } : null, viewer: viewer ? viewer.state() : null, history: history.length, future: future.length, wind, wireframe, viewMode, selectedPreset, layout: layout.prefs }),
  };
})();
