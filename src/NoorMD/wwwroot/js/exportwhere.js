// Where a bench's export goes: a folder chosen each time or a game project chosen once, arranged by a layout (Flat,
// a folder each, Godot, Unity, Unreal, by size or kind, or your own folder and file-name patterns). The app does the
// writing and only ever inside the folder or project you chose; this panel picks and previews.
window.NoorExportWhere = (() => {
  'use strict';
  const { el } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const TOKENS = {
    texture: '{name} {Name} {name_snake} {name-kebab} · {map} {Map} {MAP} (BC, N, ORM…) · {size} {family} {project}',
    sound: '{name} {Name} {name_snake} {name-kebab} · {n} (variation 01, 02…) · {family} {project}',
    music: '{name} {Name} {name_snake} {name-kebab} · {family} {project} (the loop adds _loop)',
    model: '{name} {Name} {name_snake} {name-kebab} · {family} {Family} {family_snake} (broadleaf, conifer…) · {project} (levels of detail add _LOD0, _LOD1…)',
  };

  function prefsOf(bench) {
    try { return { project: '', layout: 'flat', folderPattern: '', filePattern: '', ...JSON.parse(localStorage.getItem('noormd.export.where.' + bench) || '{}') }; }
    catch { return { project: '', layout: 'flat', folderPattern: '', filePattern: '' }; }
  }
  function savePrefs(bench, p) { try { localStorage.setItem('noormd.export.where.' + bench, JSON.stringify(p)); } catch { /* private storage off */ } }

  /**
   * The panel for one bench. info() gives what the preview needs: { name, family, size, target, variations }.
   * Returns { node, payload(), refresh() }.
   */
  function panel(bench, info, onError) {
    let prefs = prefsOf(bench);
    let data = { projects: [], layouts: [] };
    let timer = 0;
    const project = el('select', { id: `ex-${bench}-project`, 'aria-label': 'Into' });
    const layout = el('select', { id: `ex-${bench}-layout`, 'aria-label': 'Arranged' });
    const folderIn = el('input', { type: 'text', id: `ex-${bench}-folder`, spellcheck: 'false', maxlength: '200', 'aria-label': 'Folder pattern', placeholder: 'e.g. Art/{family}/{name}' });
    const fileIn = el('input', { type: 'text', id: `ex-${bench}-file`, spellcheck: 'false', maxlength: '200', 'aria-label': 'File name pattern', placeholder: bench === 'sound' ? '{name}_{n}' : bench === 'music' || bench === 'model' ? '{name}' : '{name}_{map}' });
    const custom = el('div', { class: 'ex-custom', hidden: true },
      el('label', { class: 'sb-inline' }, el('span', { text: 'Folders' }), folderIn),
      el('label', { class: 'sb-inline' }, el('span', { text: 'Files' }), fileIn),
      el('small', { class: 'pref-hint', text: 'Tokens: ' + TOKENS[bench] + '. Use / for folders inside folders.' }));
    const preview = el('div', { class: 'ex-preview', id: `ex-${bench}-preview`, 'aria-live': 'polite' });
    const remove = el('button', { class: 'icon-btn', id: `ex-${bench}-remove`, title: 'Remove this project from the list (its folder is not touched)', 'aria-label': 'Remove this project', hidden: true, onclick: removeProject }, '✕');
    const node = el('div', { class: 'ex-where' },
      el('div', { class: 'sb-row' },
        el('label', { class: 'sb-inline' }, el('span', { text: 'Into' }), project), remove,
        el('label', { class: 'sb-inline' }, el('span', { text: 'Arranged' }), layout)),
      custom, preview);

    const payload = () => ({ project: prefs.project || null, layout: prefs.layout, folderPattern: prefs.folderPattern, filePattern: prefs.filePattern });

    function fill() {
      project.replaceChildren(el('option', { value: '', text: 'A folder I choose each time' }),
        ...data.projects.map((p) => el('option', { value: p.id, text: `🎮 ${p.name}${p.missing ? ' (folder missing)' : ''}`, title: p.root })),
        el('option', { value: '+', text: '＋ Add a game project…' }));
      if (prefs.project && !data.projects.some((p) => p.id === prefs.project)) prefs.project = '';
      project.value = prefs.project || '';
      remove.hidden = !prefs.project;
      layout.replaceChildren(...data.layouts.map((l) => el('option', { value: l.id, text: l.name, title: l.description })), el('option', { value: 'custom', text: 'My own pattern…' }));
      layout.value = data.layouts.some((l) => l.id === prefs.layout) || prefs.layout === 'custom' ? prefs.layout : 'flat';
      // A template shows its patterns, so "My own pattern" can start from one.
      const l = data.layouts.find((x) => x.id === layout.value);
      if (layout.value !== 'custom' && l) { folderIn.value = l[bench].folder; fileIn.value = l[bench].file; }
      else { folderIn.value = prefs.folderPattern; fileIn.value = prefs.filePattern; }
      custom.hidden = layout.value !== 'custom';
    }

    function changed() { savePrefs(bench, prefs); refresh(); }

    function refresh() {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const r = await req('export.plan', { bench, ...payload(), ...info() });
          const base = r.project ? `🎮 ${r.project}` : '📁 the folder you choose';
          const folder = r.folder ? `${base} / ${r.folder}` : base;
          preview.replaceChildren(el('div', { class: 'ex-folder', text: folder }), ...r.files.map((f) => el('div', { class: 'ex-file', text: '  ' + f })));
        } catch (err) { preview.textContent = err && err.message ? err.message : String(err); }
      }, 120);
    }

    async function addProject() {
      try {
        const r = await req('export.project.add');
        if (r && r.id) { data = r.all; prefs.project = r.id; }
      } catch (err) { onError(err); }
      fill(); changed();
    }

    async function removeProject() {
      if (!prefs.project) return;
      try { data = await req('export.project.remove', { id: prefs.project }); prefs.project = ''; fill(); changed(); } catch (err) { onError(err); }
    }

    project.addEventListener('change', () => { if (project.value === '+') { addProject(); return; } prefs.project = project.value; remove.hidden = !prefs.project; changed(); });
    layout.addEventListener('change', () => {
      if (layout.value === 'custom' && !prefs.folderPattern && !prefs.filePattern) { prefs.folderPattern = folderIn.value; prefs.filePattern = fileIn.value; }
      prefs.layout = layout.value; fill(); changed();
    });
    folderIn.addEventListener('input', () => { prefs.folderPattern = folderIn.value; changed(); });
    fileIn.addEventListener('input', () => { prefs.filePattern = fileIn.value; changed(); });

    req('export.projects').then((r) => { data = r; fill(); refresh(); }).catch(onError);
    return { node, payload, refresh };
  }

  return { panel };
})();
