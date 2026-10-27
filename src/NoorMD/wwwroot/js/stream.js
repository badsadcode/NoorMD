// NoorMD Stream Desk: OBS overlays (Now Playing, credits roll), the supporters list and the stream log.
// Overlays are served by NoorMD on 127.0.0.1 only; the designs here preview exactly what OBS shows. Supporters and
// streams are notes in the open Vault. Nothing is published anywhere: titles and descriptions are copied for you.
window.NoorStream = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);

  let hooks = { showError: (e) => console.error(e) };
  let built = false;
  let tab = 'np';
  let status = null;
  let np = null, npPreview = null, cr = null, crPreview = null;
  let effects = [];         // custom effects [{ id, label, background, particles, nameAnim }]
  let templates = [];       // [{ name, title, description, keywords }]
  let supporters = [], supportersDirty = false, supportersPath = null, supportersFilter = 'active';
  let current = null;       // the stream being edited (StreamEntry for the page)
  let lastTrack = null, lastSent = 0;
  let saveNpTimer = 0, saveCrTimer = 0, statusTimer = 0;
  let mic = null, micState = null, micSettled = false; // Mic Guard: settings + devices from the host, live state from mic.state events
  const SAMPLE_TRACK = { id: 0, title: 'Night Drive', artist: 'Noor', playing: true, position: 74, duration: 200, art: null };
  const SAMPLE_PEOPLE = [{ name: 'Ania', channel: 'https://www.youtube.com/@ania', tier: 'Gold' }, { name: 'Bartek', tier: 'Gold' }, { name: 'Celina', channel: 'https://www.twitch.tv/celina', tier: 'Silver' }, { name: 'Dawid', tier: 'Silver' }, { name: 'Ela' }];
  const isOpen = () => document.body.classList.contains('stream-open');
  /** Today on the user's calendar (not UTC: a late-evening stream in Poland would otherwise be dated tomorrow). */
  const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // In its own window (stream.html) the Stream Desk is the whole page: the window's title bar closes it.
  const inWindow = () => document.body.classList.contains('stream-window');
  function setDirty(v) {
    supportersDirty = v;
    if (inWindow()) req('streamwin.dirty', { dirty: v }).catch(() => {});
  }

  function init(h) {
    hooks = { ...hooks, ...h };
    NoorBridge.on('mic.state', (m) => { micState = m; renderMicState(); });
    NoorBridge.on('stream.tab', (p) => open(p && p.tab));
    NoorBridge.on('stream.track', (p) => showTrack(p ? p.track : null));
  }

  /** The Now Playing preview follows the Music Bench (in the window, the host relays the playing song). */
  function showTrack(t) {
    lastTrack = t;
    if (npPreview && isOpen() && tab === 'np') npPreview.setTrack(t || SAMPLE_TRACK);
  }

  // ------------------------------------------------------------------ now playing from the Music Bench

  function nowPlaying(t) {
    showTrack(t);
    const now = Date.now();
    // The host only needs changes and a slow progress tick.
    const key = t ? `${t.id}|${t.playing}` : '';
    if (key === nowPlaying.key && now - lastSent < 5000) return;
    nowPlaying.key = key; lastSent = now;
    req('stream.np.update', { track: t ? { id: t.id, title: t.title, artist: t.artist, hasArt: t.hasArt, playing: t.playing, position: t.position, duration: t.duration } : null }).catch(() => {});
  }

  // ------------------------------------------------------------------ open / close

  async function open(which) {
    if (!built) build();
    document.body.classList.add('stream-open');
    $('#streamdesk').hidden = false;
    await refresh();
    setTab(which || tab);
    $('#streamdesk').focus({ preventScroll: true });
    clearInterval(statusTimer);
    statusTimer = setInterval(() => { if (isOpen()) refreshServer(); }, 4000);
  }

  async function close() {
    if (!built || !isOpen()) return;
    if (supportersDirty && !await NoorUI.confirm('Close with unsaved supporters?', 'The supporters list has changes that are not saved yet.', 'Close without saving')) return;
    setDirty(false);
    if (inWindow()) { req('streamwin.close').catch(() => {}); return; }
    document.body.classList.remove('stream-open');
    $('#streamdesk').hidden = true;
    clearInterval(statusTimer);
    if (crPreview) crPreview.stop();
  }

  function toggle(which) { if (isOpen() && (!which || which === tab)) close(); else open(which); }

  async function refresh() {
    try { status = await req('stream.status'); } catch (err) { hooks.showError(err); return; }
    np = NoorNowPlaying.clean(status.nowPlaying);
    effects = Array.isArray(status.effects) ? status.effects : [];
    cr = { ...NoorCredits.DEFAULTS, ...(status.credits || {}) };
    templates = Array.isArray(status.templates) ? status.templates : [];
    renderServer();
    req('mic.status').then((m) => { mic = m; micState = null; renderMicState(); }).catch(() => {});
  }

  async function refreshServer() {
    try { const s = await req('stream.status'); status = { ...status, server: s.server, session: s.session }; renderServer(); if (tab === 'log') renderSession(); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------------ layout

  function build() {
    built = true;
    const tabs = [['np', '🎵 Now Playing'], ['credits', '🎬 Credits roll'], ['supporters', '💜 Supporters'], ['log', '📼 Stream log'], ['mic', '🎙 Mic Guard']];
    document.body.append(el('section', { id: 'streamdesk', class: 'streamdesk', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'Stream Desk' },
      el('header', { class: 'sd-head' },
        el('strong', { class: 'sd-title' }, '📡 Stream Desk'),
        el('div', { class: 'sd-tabs', role: 'tablist' }, ...tabs.map(([id, label]) => el('button', { role: 'tab', 'data-sdtab': id, onclick: () => setTab(id) }, label))),
        el('button', { class: 'sd-mic-pill', id: 'sd-mic-pill', hidden: true, title: 'Mic Guard: click to mute / unmute', onclick: () => toggleMic() }),
        el('span', { class: 'sd-server', id: 'sd-server' }),
        el('button', { class: 'icon-btn sd-close', title: 'Close (Esc)', 'aria-label': 'Close Stream Desk', onclick: close }, '✕')),
      el('div', { class: 'sd-body', id: 'sd-body' })));
    $('#streamdesk').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !inWindow() && !e.target.closest('input, textarea, select')) { e.preventDefault(); e.stopPropagation(); close(); }
    });
  }

  let renderGen = 0; // async renders check this, so overlapping refreshes never draw a tab twice
  function setTab(id) {
    tab = id;
    const gen = ++renderGen;
    document.querySelectorAll('[data-sdtab]').forEach((b) => { b.classList.toggle('active', b.dataset.sdtab === id); b.setAttribute('aria-selected', String(b.dataset.sdtab === id)); });
    if (crPreview) { crPreview.destroy(); crPreview = null; }
    npPreview = null;
    const body = $('#sd-body');
    // Mic Guard redraws after every setting: it swaps its content in one go (no empty flash, see renderMic).
    if (id !== 'mic') body.replaceChildren();
    micSettled = false;
    if (id === 'np') renderNowPlaying(body);
    else if (id === 'credits') renderCredits(body, gen);
    else if (id === 'supporters') renderSupporters(body, gen);
    else if (id === 'mic') renderMic(body, gen);
    else renderLog(body, gen);
  }

  function renderServer() {
    const box = $('#sd-server');
    if (!box || !status) return;
    const s = status.server;
    box.replaceChildren(el('span', { class: 'sd-dot' + (s.running ? ' on' : '') }), s.running ? `OBS overlays on ${s.url} · ${s.clients} connected` : 'OBS overlays off');
  }

  // ------------------------------------------------------------------ small form helpers

  const row = (label, ...control) => el('label', { class: 'sd-row' }, el('span', { class: 'sd-label', text: label }), ...control);
  function input(obj, key, attrs, onChange) {
    const i = el('input', { ...attrs, 'data-key': key });
    if (attrs.type === 'checkbox') i.checked = !!obj[key]; else i.value = obj[key] ?? '';
    i.addEventListener(attrs.type === 'checkbox' || attrs.type === 'color' ? 'change' : 'input', () => {
      obj[key] = attrs.type === 'checkbox' ? i.checked : attrs.type === 'number' || attrs.type === 'range' ? Number(i.value) : i.value;
      onChange();
    });
    if (attrs.type === 'color') i.addEventListener('input', () => { obj[key] = i.value; onChange(); });
    return i;
  }
  function select(obj, key, options, onChange, attrs = {}) {
    const s = el('select', { ...attrs, 'data-key': key }, ...Object.entries(options).map(([v, t]) => el('option', { value: v, text: t })));
    s.value = String(obj[key]);
    s.addEventListener('change', () => { obj[key] = s.value; onChange(); });
    return s;
  }
  const copyBtn = (label, text) => el('button', { class: 'utility-btn', 'data-copy': label, onclick: async () => copy(await (typeof text === 'function' ? text() : text), label) }, '⧉ ' + label);
  async function copy(text, what) {
    try { await req('clipboard.copyText', { text }); notice(`${what} copied`, 1400); } catch (err) { hooks.showError(err); }
  }

  function serverPanel() {
    const s = status.server;
    const port = el('input', { type: 'number', min: '1024', max: '65535', value: String(s.port), class: 'num', id: 'sd-port', 'aria-label': 'Port' });
    const on = el('input', { type: 'checkbox', id: 'sd-server-on' });
    on.checked = s.running;
    on.addEventListener('change', async () => {
      try { const r = await req('stream.server', { enabled: on.checked, port: Number(port.value) }); notice(r.running ? `Overlays are live on ${r.url}` : 'Overlay server stopped', 2500); }
      catch (err) { on.checked = false; hooks.showError(err); }
      await refresh();
      setTab(tab);
    });
    const base = s.running ? s.url : `http://127.0.0.1:${s.port}/`;
    return el('section', { class: 'sd-card' },
      el('h3', { text: 'OBS overlay server' }),
      el('div', { class: 'sd-row' }, el('label', { class: 'inline' }, on, el('strong', { text: 'Serve overlays to OBS' })), el('span', { text: 'port' }), port),
      el('p', { class: 'pref-hint', text: 'Answers only on this computer (127.0.0.1), read-only. In OBS: Sources › + › Browser, paste the address, width 1920, height 1080. Changes here update OBS live.' }),
      el('div', { class: 'sd-urls' },
        el('code', { text: base + 'now-playing.html' }), copyBtn('Now Playing URL', base + 'now-playing.html'),
        el('code', { text: base + 'credits.html' }), copyBtn('Credits URL', base + 'credits.html')));
  }

  // ------------------------------------------------------------------ Now Playing

  function renderNowPlaying(body) {
    const changed = () => {
      Object.assign(np, NoorNowPlaying.clean(np)); // in place: the inputs hold this object
      if (npPreview) { npPreview.setConfig(np); npPreview.setTrack(lastTrack || SAMPLE_TRACK); }
      clearTimeout(saveNpTimer);
      saveNpTimer = setTimeout(() => req('stream.np.config', { config: np }).catch(hooks.showError), 300);
    };
    const designs = el('div', { class: 'sd-designs', role: 'radiogroup', 'aria-label': 'Design' }, ...Object.entries(NoorNowPlaying.DESIGNS).map(([k, label]) =>
      el('button', { class: 'chip' + (np.design === k ? ' active' : ''), role: 'radio', 'aria-checked': String(np.design === k), 'data-design': k, onclick: (e) => {
        np.design = k;
        e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => { c.classList.toggle('active', c.dataset.design === k); c.setAttribute('aria-checked', String(c.dataset.design === k)); });
        changed();
      } }, label)));
    const frame = el('div', { class: 'sd-frame', id: 'np-frame', 'aria-label': 'Preview' });
    const txt = status.txt;
    const txtOn = el('input', { type: 'checkbox', id: 'sd-txt' }); txtOn.checked = txt.enabled;
    const txtFmt = el('input', { type: 'text', value: txt.format, id: 'sd-txt-format', 'aria-label': 'Text format' });
    const saveTxt = (choose) => req('stream.txt', { enabled: txtOn.checked, format: txtFmt.value, choose }).then((r) => { if (r && r.path) { status.txt.path = r.path; $('#sd-txt-path').textContent = r.path; } }).catch(hooks.showError);
    txtOn.addEventListener('change', () => saveTxt(false));
    txtFmt.addEventListener('change', () => saveTxt(false));
    body.append(el('div', { class: 'sd-grid' },
      el('div', { class: 'sd-col' },
        serverPanel(),
        el('section', { class: 'sd-card' },
          el('h3', { text: 'Design' }), designs,
          row('Accent', input(np, 'accent', { type: 'color' }, changed)), row('Text', input(np, 'text', { type: 'color' }, changed)),
          row('Background', input(np, 'background', { type: 'color' }, changed), input(np, 'bgOpacity', { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Background opacity' }, changed)),
          row('Font', select(np, 'font', { inter: 'Inter', system: 'System', rounded: 'Rounded', serif: 'Serif', mono: 'Monospace', display: 'Display' }, changed)),
          row('Size', input(np, 'scale', { type: 'range', min: '0.5', max: '2.5', step: '0.05' }, changed)),
          row('Corners', input(np, 'radius', { type: 'range', min: '0', max: '40', step: '1' }, changed)),
          row('Position', select(np, 'position', { 'bottom-left': 'Bottom left', 'bottom-center': 'Bottom centre', 'bottom-right': 'Bottom right', 'top-left': 'Top left', 'top-center': 'Top centre', 'top-right': 'Top right' }, changed)),
          row('Label', input(np, 'label', { type: 'text', placeholder: 'Now playing' }, changed)),
          row('Animation', select(np, 'animation', { slide: 'Slide in', fade: 'Fade', pop: 'Pop', none: 'None' }, changed)),
          row('Hide after', input(np, 'autoHide', { type: 'number', min: '0', max: '600', class: 'num' }, changed), el('span', { class: 'pref-hint', text: 's (0 = always shown)' })),
          el('div', { class: 'sd-checks' },
            el('label', { class: 'inline' }, input(np, 'showArt', { type: 'checkbox' }, changed), 'Artwork'),
            el('label', { class: 'inline' }, input(np, 'showArtist', { type: 'checkbox' }, changed), 'Artist'),
            el('label', { class: 'inline' }, input(np, 'showProgress', { type: 'checkbox' }, changed), 'Progress bar'),
            el('label', { class: 'inline' }, input(np, 'hideWhenPaused', { type: 'checkbox' }, changed), 'Hide while paused')),
          el('button', { class: 'utility-btn', onclick: () => { np = NoorNowPlaying.clean({}); changed(); setTab('np'); } }, 'Reset to default')),
        el('section', { class: 'sd-card' },
          el('h3', { text: 'Text file (OBS Text source)' }),
          el('label', { class: 'inline' }, txtOn, 'Write the current song to a text file'),
          row('Format', txtFmt), el('div', { class: 'sd-row' }, el('code', { id: 'sd-txt-path', text: txt.path }), el('button', { class: 'utility-btn', onclick: () => saveTxt(true) }, 'Choose…')),
          el('p', { class: 'pref-hint', text: 'For OBS: Text (GDI+) › Read from file. {title} and {artist} are replaced.' }))),
      el('div', { class: 'sd-col sd-preview-col' }, el('h3', { text: 'Preview' }), frame,
        el('p', { class: 'pref-hint', text: lastTrack ? 'Showing the track that is playing.' : 'Showing a sample track; play something in the Music Bench to see it here.' }))));
    npPreview = NoorNowPlaying.mount(frame);
    npPreview.setConfig(np);
    npPreview.setTrack(lastTrack || SAMPLE_TRACK);
  }

  // ------------------------------------------------------------------ Credits roll and effect builder

  async function loadSupporters() {
    try { const r = await req('stream.supporters.get'); supporters = r.supporters; supportersPath = r.path; setDirty(false); return true; }
    catch { supporters = []; return false; }
  }

  async function renderCredits(body, gen) {
    await loadSupporters();
    if (gen !== renderGen) return;
    const save = () => { clearTimeout(saveCrTimer); saveCrTimer = setTimeout(() => req('stream.credits.config', { config: cr, effects }).catch(hooks.showError), 300); };
    const changed = () => { if (crPreview) crPreview.setConfig(cr, effects); save(); };
    const people = () => { const a = supporters.filter((s) => s.active); return a.length ? a : SAMPLE_PEOPLE; };
    const effectOptions = () => ({ ...Object.fromEntries(Object.entries(NoorCredits.EFFECTS).map(([k, e]) => [k, e.label])), ...Object.fromEntries(effects.map((e) => [e.id, '★ ' + e.label])) });
    let effectSel = select(cr, 'effect', effectOptions(), () => { changed(); drawBuilder(); }, { id: 'cr-effect' });
    const frame = el('div', { class: 'sd-frame', id: 'cr-frame' });
    const builder = el('section', { class: 'sd-card', id: 'cr-builder' });

    function currentEffect() { return effects.find((e) => e.id === cr.effect) || null; }
    function drawBuilder() {
      const custom = currentEffect();
      if (!custom) {
        builder.replaceChildren(el('h3', { text: 'Effect' }), el('p', { class: 'pref-hint', text: `“${(NoorCredits.EFFECTS[cr.effect] || {}).label || cr.effect}” is built in. Make your own from it — a background, particles and a name animation.` }),
          el('button', { class: 'action primary', id: 'cr-new-effect', onclick: () => newEffect() }, '＋ New effect from this one'),
          el('button', { class: 'utility-btn', onclick: importEffect }, 'Import effect…'));
        return;
      }
      const e = custom;
      e.background = e.background || {}; e.particles = e.particles || {};
      // Clean in place, nested objects included: the builder's inputs hold references to them.
      const ch = () => { const c = NoorCredits.cleanEffect(e); Object.assign(e.background, c.background); Object.assign(e.particles, c.particles); e.label = c.label; e.nameAnim = c.nameAnim; changed(); };
      const colorInputs = () => el('div', { class: 'sd-colors' }, ...[0, 1, 2, 3, 4].map((i) => {
        const c = el('input', { type: 'color', value: e.particles.colors && e.particles.colors[i] ? e.particles.colors[i] : '#ffffff', 'aria-label': `Particle colour ${i + 1}` });
        const use = el('input', { type: 'checkbox', 'aria-label': `Use colour ${i + 1}` }); use.checked = !!(e.particles.colors && e.particles.colors[i]);
        const sync = () => { const list = [...builder.querySelectorAll('.sd-colors > span')].map((s) => (s.querySelector('[type=checkbox]').checked ? s.querySelector('[type=color]').value : null)).filter(Boolean); e.particles.colors = list; ch(); };
        c.addEventListener('input', () => { use.checked = true; sync(); }); use.addEventListener('change', sync);
        return el('span', {}, use, c);
      }));
      builder.replaceChildren(
        el('h3', { text: 'Effect builder' }),
        row('Name', input(e, 'label', { type: 'text', id: 'cr-effect-name' }, () => { ch(); refreshEffectSelect(); })),
        row('Background', select(e.background, 'type', { transparent: 'Transparent', solid: 'Solid colour', gradient: 'Gradient' }, ch), input(e.background, 'color1', { type: 'color' }, ch), input(e.background, 'color2', { type: 'color' }, ch)),
        el('label', { class: 'inline' }, input(e.background, 'animate', { type: 'checkbox' }, ch), 'Slowly moving gradient'),
        row('Particles', select(e.particles, 'kind', NoorCredits.PARTICLES, () => { ch(); drawBuilder(); }, { id: 'cr-particles' }), e.particles.kind === 'emoji' ? input(e.particles, 'emoji', { type: 'text', maxlength: '4', class: 'num', 'aria-label': 'Emoji' }, ch) : null),
        row('Amount', input(e.particles, 'count', { type: 'range', min: '0', max: '300', step: '5' }, ch)),
        row('Speed', input(e.particles, 'speed', { type: 'range', min: '0.1', max: '3', step: '0.1' }, ch)),
        row('Size', input(e.particles, 'size', { type: 'range', min: '0.3', max: '3', step: '0.1' }, ch)),
        row('Direction', select(e.particles, 'direction', { down: 'Falling', up: 'Rising', drift: 'Floating' }, ch)),
        row('Colours', colorInputs()),
        row('Names', select(e, 'nameAnim', NoorCredits.NAME_ANIMS, ch)),
        el('div', { class: 'sd-row' },
          el('button', { class: 'utility-btn', onclick: () => copy(JSON.stringify({ noormdEffect: 1, ...NoorCredits.cleanEffect(e) }), 'Effect') }, '⧉ Copy effect (share)'),
          el('button', { class: 'utility-btn', onclick: () => newEffect(e) }, 'Duplicate'),
          el('button', { class: 'utility-btn danger', onclick: () => { effects = effects.filter((x) => x.id !== e.id); cr.effect = 'violet'; refreshEffectSelect(); changed(); drawBuilder(); } }, 'Delete effect')));
    }
    function refreshEffectSelect() {
      const s = select(cr, 'effect', effectOptions(), () => { changed(); drawBuilder(); }, { id: 'cr-effect' });
      effectSel.replaceWith(s); effectSel = s;
    }
    function newEffect(from) {
      const base = from ? NoorCredits.cleanEffect(from) : NoorCredits.cleanEffect(NoorCredits.EFFECTS[cr.effect] || NoorCredits.EFFECTS.violet);
      const id = 'fx' + Date.now().toString(36);
      effects.push({ ...JSON.parse(JSON.stringify(base)), id, label: (from ? base.label : 'My ' + base.label.toLowerCase()) + (from ? ' copy' : '') });
      cr.effect = id;
      refreshEffectSelect(); changed(); drawBuilder();
      $('#cr-effect-name')?.select();
    }
    async function importEffect() {
      const text = await NoorUI.prompt('Import effect', 'Paste an effect copied from NoorMD:', '', { okLabel: 'Import' });
      if (!text) return;
      try {
        const data = JSON.parse(text);
        if (!data || data.noormdEffect !== 1) throw new Error('not an effect');
        const id = 'fx' + Date.now().toString(36);
        effects.push({ ...NoorCredits.cleanEffect(data), id });
        cr.effect = id; refreshEffectSelect(); changed(); drawBuilder();
      } catch { notice('That text is not a NoorMD effect.', 3000); }
    }

    body.append(el('div', { class: 'sd-grid' },
      el('div', { class: 'sd-col' },
        el('section', { class: 'sd-card' },
          el('h3', { text: 'Credits roll' }),
          row('Title', input(cr, 'title', { type: 'text', id: 'cr-title' }, changed)),
          row('Message', input(cr, 'message', { type: 'text' }, changed)),
          row('At the end', input(cr, 'endText', { type: 'text' }, changed)),
          row('Effect', effectSel),
          row('Speed', input(cr, 'speed', { type: 'range', min: '20', max: '200', step: '5' }, changed)),
          row('Size', input(cr, 'scale', { type: 'range', min: '0.5', max: '2', step: '0.05' }, changed)),
          row('Font', select(cr, 'font', { inter: 'Inter', system: 'System', rounded: 'Rounded', serif: 'Serif', mono: 'Monospace', display: 'Display' }, changed)),
          row('Colours', input(cr, 'text', { type: 'color', 'aria-label': 'Text colour' }, changed), input(cr, 'accent', { type: 'color', 'aria-label': 'Accent colour' }, changed)),
          row('Start delay', input(cr, 'startDelay', { type: 'number', min: '0', max: '30', class: 'num' }, changed), el('span', { class: 'pref-hint', text: 's' })),
          el('div', { class: 'sd-checks' },
            el('label', { class: 'inline' }, input(cr, 'groupByTier', { type: 'checkbox' }, changed), 'Group by tier'),
            el('label', { class: 'inline' }, input(cr, 'showChannel', { type: 'checkbox' }, changed), 'Show channels'),
            el('label', { class: 'inline' }, input(cr, 'shadow', { type: 'checkbox' }, changed), 'Text shadow'),
            el('label', { class: 'inline' }, input(cr, 'loop', { type: 'checkbox' }, changed), 'Loop'),
            el('label', { class: 'inline' }, input(cr, 'autoStart', { type: 'checkbox' }, changed), 'Start when the OBS source appears'))),
        builder),
      el('div', { class: 'sd-col sd-preview-col' },
        el('h3', { text: 'Preview' }), frame,
        el('div', { class: 'sd-row' },
          el('button', { class: 'utility-btn', id: 'cr-preview-play', onclick: () => crPreview.start() }, '▶ Preview'),
          el('button', { class: 'utility-btn', onclick: () => crPreview.stop() }, '⟲ Reset'),
          el('button', { class: 'action primary', id: 'cr-roll', disabled: !status.server.running || undefined, title: status.server.running ? 'Starts the roll in OBS now' : 'Turn on the overlay server (Now Playing tab) first', onclick: async () => {
            try { const r = await req('stream.credits.start'); notice(r.clients ? 'Rolling credits in OBS 🎬' : 'Sent — but no overlay is connected. Is the credits Browser Source added in OBS?', 3500); } catch (err) { hooks.showError(err); }
          } }, '🎬 Roll credits in OBS'),
          el('button', { class: 'utility-btn', disabled: !status.server.running || undefined, onclick: () => req('stream.credits.stop').catch(hooks.showError) }, '■ Stop')),
        el('p', { class: 'pref-hint', id: 'cr-people', text: supporters.some((s) => s.active) ? `${supporters.filter((s) => s.active).length} active supporters from ${supportersPath}.` : status.vault ? 'No active supporters yet — add them in the Supporters tab. Showing sample names.' : 'Open a Vault to keep the supporters list. Showing sample names.' }))));
    crPreview = NoorCredits.mount(frame);
    crPreview.setConfig(cr, effects);
    crPreview.setData(people());
    drawBuilder();
  }

  // ------------------------------------------------------------------ Supporters

  async function renderSupporters(body, gen) {
    if (!status.vault) {
      body.append(el('div', { class: 'vb-empty' }, el('h2', { text: 'Supporters live in your Vault' }),
        el('p', { text: 'NoorMD keeps the list as an ordinary note (a table) in the open Vault, so it stays yours and readable anywhere.' }),
        el('button', { class: 'action primary', onclick: () => req('vault.open').then(() => refresh()).then(() => setTab('supporters')).catch(hooks.showError) }, 'Open a Vault…')));
      return;
    }
    if (!supportersDirty) await loadSupporters();
    if (gen !== renderGen) return;
    const table = el('div', { class: 'sd-table', id: 'sup-table', role: 'table', 'aria-label': 'Supporters' });
    const saveBtn = el('button', { class: 'action primary', id: 'sup-save', onclick: saveSupporters }, 'Save');
    const counts = el('span', { class: 'pref-hint', id: 'sup-counts' });
    const dirty = () => { if (!supportersDirty) setDirty(true); saveBtn.textContent = 'Save ●'; };
    const today = localDate;
    function draw() {
      const list = supporters.map((s, i) => [s, i]).filter(([s]) => supportersFilter === 'all' || (supportersFilter === 'active' ? s.active : !s.active));
      counts.textContent = `${supporters.filter((s) => s.active).length} active · ${supporters.filter((s) => !s.active).length} left · ${supportersPath}`;
      const cell = (s, key, attrs = {}) => {
        const i = el('input', { type: 'text', value: s[key] || '', 'aria-label': key, ...attrs });
        i.addEventListener('input', () => { s[key] = i.value; dirty(); });
        return i;
      };
      table.replaceChildren(
        el('div', { class: 'sd-tr head', role: 'row' }, ...['Name', 'Channel link', 'Tier', 'Since', 'Left on', ''].map((t) => el('span', { role: 'columnheader', text: t }))),
        ...list.map(([s, i]) => el('div', { class: 'sd-tr' + (s.active ? '' : ' left'), role: 'row', 'data-index': String(i) },
          cell(s, 'name', { placeholder: 'Name' }), cell(s, 'channel', { placeholder: 'https://youtube.com/@…' }), cell(s, 'tier'),
          cell(s, 'since', { type: 'date' }), cell(s, 'until', { type: 'date' }),
          el('span', { class: 'sd-actions' },
            s.active
              ? el('button', { class: 'utility-btn', title: 'They stopped supporting today (kept as history)', onclick: () => { s.until = today(); s.active = false; dirty(); draw(); } }, 'Left')
              : el('button', { class: 'utility-btn', title: 'They are back', onclick: () => { s.until = null; s.active = true; dirty(); draw(); } }, 'Back'),
            el('button', { class: 'icon-btn', title: 'Remove from the list', 'aria-label': 'Remove', onclick: () => { supporters.splice(i, 1); dirty(); draw(); } }, '✕')))),
        ...(list.length ? [] : [el('p', { class: 'music-none', text: supportersFilter === 'left' ? 'Nobody has left. 💜' : 'No supporters yet. Add them one by one or paste an export.' })]));
    }
    const filter = el('select', { 'aria-label': 'Show', id: 'sup-filter' }, el('option', { value: 'active', text: 'Active' }), el('option', { value: 'left', text: 'Left' }), el('option', { value: 'all', text: 'Everyone' }));
    filter.value = supportersFilter;
    filter.addEventListener('change', () => { supportersFilter = filter.value; draw(); });
    async function saveSupporters() {
      for (const s of supporters) { s.active = !s.until; }
      try { const r = await req('stream.supporters.save', { supporters }); setDirty(false); saveBtn.textContent = 'Save'; notice(`Saved ${r.count} supporters to ${r.path}`, 2500); await loadSupporters(); draw(); }
      catch (err) { hooks.showError(err); }
    }
    body.append(el('div', { class: 'sd-supporters' },
      el('div', { class: 'sd-row' },
        el('button', { class: 'utility-btn', id: 'sup-add', onclick: () => { supporters.unshift({ name: '', channel: '', tier: '', since: today(), until: null, active: true }); supportersFilter = 'active'; filter.value = 'active'; dirty(); draw(); table.querySelector('.sd-tr:not(.head) input')?.focus(); } }, '＋ Add supporter'),
        el('button', { class: 'utility-btn', id: 'sup-import', onclick: importSupporters }, '⇩ Paste from an export…'),
        filter, counts,
        el('span', { class: 'sd-spacer' }),
        el('button', { class: 'utility-btn', onclick: () => req('vault.openFile', { path: supportersPath }).then(() => { if (!inWindow()) close(); }).catch(hooks.showError) }, 'Open the note'),
        saveBtn),
      table));
    draw();

    async function importSupporters() {
      NoorUI.modal({ label: 'Paste supporters', width: 680 }, (s, closeModal) => {
        const ta = el('textarea', { rows: '10', id: 'sup-paste', placeholder: 'Paste a YouTube members / Patreon / Ko-fi export (CSV), or one person per line: Name https://youtube.com/@name', 'aria-label': 'Pasted list' });
        const missing = el('input', { type: 'checkbox', id: 'sup-missing' });
        const result = el('div', { class: 'sd-import-result', id: 'sup-result', 'aria-live': 'polite' });
        let merged = null;
        const apply = el('button', { class: 'action primary', id: 'sup-apply', disabled: true, onclick: () => { supporters = merged; dirty(); draw(); closeModal(); notice('Merged — check the list and press Save.', 3000); } }, 'Use this list');
        const preview = async () => {
          try {
            const r = await req('stream.supporters.import', { text: ta.value, markMissingAsLeft: missing.checked, current: supporters });
            merged = r.merged;
            result.replaceChildren(el('p', { text: `${r.found} people found.` }),
              ...[['New', r.added], ['Updated', r.updated], ['Back again', r.returned], ['Left (missing from the export)', r.left]].filter(([, l]) => l.length).map(([t, l]) => el('p', {}, el('strong', { text: `${t}: ` }), l.join(', '))));
            apply.disabled = false;
          } catch (err) { merged = null; apply.disabled = true; result.replaceChildren(el('p', { class: 'batch-problem', text: err.message })); }
        };
        let t;
        ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(preview, 300); });
        missing.addEventListener('change', preview);
        s.append(NoorUI.head('⇩ Paste supporters', closeModal), el('div', { class: 'modal-body' }, ta,
          el('label', { class: 'inline' }, missing, 'People who are not in this export have left (they stay in the list with today as “Left on”)'), result),
          el('div', { class: 'modal-foot' }, el('span', { text: 'Nothing is saved until you press Save in the list.' }), el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeModal() }, 'Cancel'), apply)));
        ta.focus();
      });
    }
  }

  // ------------------------------------------------------------------ Stream log

  async function renderLog(body, gen) {
    if (!status.vault) {
      body.append(el('div', { class: 'vb-empty' }, el('h2', { text: 'Your stream history lives in your Vault' }),
        el('p', { text: 'Each stream becomes a note with its title, date, description, keywords, thumbnail and tracklist.' }),
        el('button', { class: 'action primary', onclick: () => req('vault.open').then(() => refresh()).then(() => setTab('log')).catch(hooks.showError) }, 'Open a Vault…')));
      return;
    }
    let history;
    try { history = await req('stream.log.list'); } catch (err) { hooks.showError(err); return; }
    if (gen !== renderGen) return;
    if (!current) current = blank(history.nextNumber);
    const list = el('aside', { class: 'sd-history', id: 'log-history' },
      el('button', { class: 'action primary', id: 'log-new', onclick: () => { current = blank(history.nextNumber); setTab('log'); } }, '＋ New stream'),
      ...history.streams.map((h) => el('button', { class: 'vb-item' + (current.path === h.path ? ' active' : ''), onclick: async () => { try { current = await req('stream.log.get', { path: h.path }); setTab('log'); } catch (err) { hooks.showError(err); } } },
        el('span', { class: 'vb-item-title', text: h.title || '(untitled)' }), el('small', { text: `${h.date}${h.number ? ' · #' + h.number : ''}${h.tracks ? ` · ${h.tracks} tracks` : ''}` }))),
      ...(history.streams.length ? [] : [el('p', { class: 'music-none', text: `No streams yet in “${history.folder}”.` })]));
    const e = current;
    const field = (key, attrs = {}) => {
      const tag = attrs.rows ? 'textarea' : 'input';
      const i = el(tag, { ...attrs, 'data-field': key });
      i.value = Array.isArray(e[key]) ? e[key].join(', ') : e[key] ?? '';
      i.addEventListener('input', () => { e[key] = attrs.type === 'number' ? (i.value ? Number(i.value) : null) : i.value; });
      return i;
    };
    const thumb = el('div', { class: 'sd-thumb', id: 'log-thumb' }, e.thumbnailData ? el('img', { src: e.thumbnailData, alt: 'Thumbnail' }) : el('span', { text: e.thumbnail || 'No thumbnail' }));
    const tplSel = el('select', { 'aria-label': 'Template', id: 'log-template' }, el('option', { value: '', text: templates.length ? 'Apply a template…' : 'No templates yet' }), ...templates.map((t, i) => el('option', { value: String(i), text: t.name })));
    tplSel.addEventListener('change', async () => { const t = templates[Number(tplSel.value)]; tplSel.value = ''; if (t) await applyTemplate(t); });
    const form = el('div', { class: 'sd-log-form' },
      el('div', { class: 'sd-row' }, tplSel, el('button', { class: 'utility-btn', onclick: editTemplates }, 'Templates…'), el('span', { class: 'sd-spacer' }),
        el('span', { class: 'pref-hint', text: e.path ? e.path : 'Not saved yet' })),
      el('div', { class: 'sd-row' }, el('span', { class: 'sd-label', text: '#' }), field('number', { type: 'number', min: '1', class: 'num', 'aria-label': 'Stream number' }),
        el('span', { class: 'sd-label', text: 'Date' }), field('date', { type: 'date', 'aria-label': 'Date' })),
      row('Title', field('title', { type: 'text', id: 'log-title', maxlength: '300' }), copyBtn('Title', () => e.title || '')),
      el('div', { class: 'sd-row sd-top' }, el('span', { class: 'sd-label', text: 'Description' }), field('description', { rows: '7', id: 'log-desc' }),
        el('div', { class: 'sd-stack' }, copyBtn('Description', () => withChapters(e.description || '')), el('small', { class: 'pref-hint', text: '{tracklist} becomes YouTube chapters' }))),
      row('Keywords', field('keywords', { type: 'text', id: 'log-keywords', placeholder: 'suno, synthwave, chill' }), copyBtn('Keywords', () => (Array.isArray(e.keywords) ? e.keywords.join(', ') : e.keywords || ''))),
      el('div', { class: 'sd-row' }, el('span', { class: 'sd-label', text: 'Thumbnail' }), thumb, el('button', { class: 'utility-btn', onclick: chooseThumb }, 'Choose…')),
      row('Video URL', field('url', { type: 'url', placeholder: 'https://youtu.be/…' })),
      el('div', { class: 'sd-card' }, el('h3', { text: 'Tracklist' }), el('div', { id: 'log-session' }), el('ol', { class: 'sd-tracks', id: 'log-tracks' })),
      el('div', { class: 'sd-row sd-top' }, el('span', { class: 'sd-label', text: 'Notes' }), field('notes', { rows: '3' })),
      el('div', { class: 'sd-row' }, el('span', { class: 'sd-spacer' }),
        e.path ? el('button', { class: 'utility-btn', onclick: () => req('vault.openFile', { path: e.path }).then(() => { if (!inWindow()) close(); }).catch(hooks.showError) }, 'Open the note') : null,
        el('button', { class: 'action primary', id: 'log-save', onclick: saveEntry }, e.path ? 'Save' : 'Save to Vault')));
    body.append(el('div', { class: 'sd-log' }, list, form));
    renderSession();
    renderTracks();

    async function saveEntry() {
      try {
        const r = await req('stream.log.save', { entry: { ...e, keywords: Array.isArray(e.keywords) ? e.keywords.join(', ') : e.keywords }, path: e.path || undefined });
        e.path = r.path;
        notice(`Saved to ${r.path}`, 2500);
        setTab('log');
      } catch (err) { hooks.showError(err); }
    }
    async function chooseThumb() {
      try { const r = await req('stream.log.thumbnail'); if (!r || r.cancelled) return; e.thumbnail = r.thumbnail; e.thumbnailData = r.thumbnailData; thumb.replaceChildren(r.thumbnailData ? el('img', { src: r.thumbnailData, alt: 'Thumbnail' }) : el('span', { text: r.thumbnail })); }
      catch (err) { hooks.showError(err); }
    }
    async function applyTemplate(t) {
      const values = { number: String(e.number ?? ''), title: e.title || '', game: e.title || '', keywords: Array.isArray(e.keywords) ? e.keywords.join(', ') : e.keywords || '' };
      const fill = (template) => req('stream.fill', { template, values, date: e.date });
      try {
        if (t.title) e.title = await fill(t.title);
        if (t.description) e.description = await fill(t.description);
        if (t.keywords) e.keywords = await fill(t.keywords);
        setTab('log');
        notice(`Template “${t.name}” applied`, 1800);
      } catch (err) { hooks.showError(err); }
    }
  }

  function blank(number) { return { title: '', date: localDate(), number, description: '', keywords: '', thumbnail: null, thumbnailData: null, url: '', notes: '', tracklist: [], path: null }; }

  /** Inside the description, {tracklist} is replaced by YouTube-style chapters built from the tracklist. */
  async function withChapters(text) {
    if (!/\{tracklist\}/i.test(text)) return text;
    const chapters = await req('stream.chapters', { tracklist: current.tracklist || [] }).catch(() => '');
    return text.replace(/\{tracklist\}/gi, chapters);
  }

  function renderSession() {
    const box = $('#log-session');
    if (!box) return;
    const s = status.session;
    box.replaceChildren(s
      ? el('div', { class: 'sd-row' }, el('span', { class: 'sd-rec', text: '● Recording' }), el('span', { text: ` since ${new Date(s.start).toLocaleTimeString()} · ${s.marks.length} tracks` }),
        el('button', { class: 'action', id: 'log-stop', onclick: async () => {
          try { const r = await req('stream.session.stop'); current.tracklist = [...(current.tracklist || []), ...r.marks]; status.session = null; renderSession(); renderTracks(); notice(`Recorded ${r.marks.length} tracks`, 2000); } catch (err) { hooks.showError(err); }
        } }, '■ Stop and add to this stream'))
      : el('div', { class: 'sd-row' }, el('button', { class: 'utility-btn', id: 'log-record', onclick: async () => {
        try { const r = await req('stream.session.start'); status.session = { start: r.start, marks: [] }; renderSession(); notice('Recording the tracklist — every song that plays is noted with its time', 3000); } catch (err) { hooks.showError(err); }
      } }, '● Record the tracklist while streaming'), el('span', { class: 'pref-hint', text: 'Songs played in the Music Bench are noted with their time from the start.' })));
  }

  function renderTracks() {
    const ol = $('#log-tracks');
    if (!ol || !current) return;
    const t = current.tracklist || [];
    ol.replaceChildren(...t.map((m, i) => el('li', {}, el('code', { text: m.stamp || stamp(m.offset) }), ' ', el('span', { text: m.text }),
      el('button', { class: 'icon-btn', 'aria-label': 'Remove', title: 'Remove', onclick: () => { t.splice(i, 1); renderTracks(); } }, '✕'))));
  }

  const stamp = (s) => { s = Math.floor(s || 0); return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':'); };

  function editTemplates() {
    const list = templates.map((t) => ({ ...t }));
    NoorUI.modal({ label: 'Templates', width: 760 }, (s, closeModal) => {
      const body = el('div', { class: 'modal-body sd-templates' });
      const draw = () => body.replaceChildren(
        el('p', { class: 'pref-hint', text: 'Placeholders: {number} {date} {date:dd.MM.yyyy} {title} {keywords} — and {tracklist} in a description becomes YouTube chapters when you copy it.' }),
        ...list.map((t, i) => el('div', { class: 'sd-card' },
          el('div', { class: 'sd-row' }, el('input', { type: 'text', value: t.name, 'aria-label': 'Template name', oninput: (e) => { t.name = e.target.value; } }),
            el('button', { class: 'icon-btn', 'aria-label': 'Delete template', onclick: () => { list.splice(i, 1); draw(); } }, '✕')),
          row('Title', el('input', { type: 'text', value: t.title || '', 'data-tpl': 'title', oninput: (e) => { t.title = e.target.value; } })),
          row('Description', el('textarea', { rows: '4', 'data-tpl': 'description', oninput: (e) => { t.description = e.target.value; } }, t.description || '')),
          row('Keywords', el('input', { type: 'text', value: t.keywords || '', 'data-tpl': 'keywords', oninput: (e) => { t.keywords = e.target.value; } })))),
        el('button', { class: 'utility-btn', id: 'tpl-add', onclick: () => { list.push({ name: 'Music stream', title: 'Suno music stream #{number} — {date:d MMMM}', description: 'Chill music made with Suno, live.\n\nTracklist:\n{tracklist}\n\nThank you for watching 💜', keywords: 'suno, ai music, live, chill' }); draw(); } }, '＋ Add template'));
      s.append(NoorUI.head('Title and description templates', closeModal), body,
        el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeModal() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'tpl-save', onclick: async () => {
            templates = list.filter((t) => t.name && t.name.trim());
            try { await req('stream.templates.save', { templates }); closeModal(); setTab('log'); } catch (err) { hooks.showError(err); }
          } }, 'Save'))));
      draw();
    });
  }

  // ------------------------------------------------------------------ Mic Guard

  const MIC_WORD = { live: 'live', muted: 'muted', unknown: 'unknown', off: 'not used' };

  async function toggleMic() {
    try { mic = await req('mic.toggle'); micState = null; renderMicState(); } catch (err) { hooks.showError(err); }
  }

  const KEY_NAMES = {
    Slash: '/', Backslash: '\\', IntlBackslash: 'IntlBackslash', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Backquote: '`', Minus: '-', Equal: '=', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    NumpadAdd: 'Add', NumpadSubtract: 'Subtract', NumpadMultiply: 'Multiply', NumpadDivide: 'Divide', NumpadDecimal: 'Decimal', NumpadEnter: 'Enter',
    Enter: 'Enter', Backspace: 'Back', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    PrintScreen: 'PrintScreen', Pause: 'Pause', ScrollLock: 'Scroll', Space: 'Space', ContextMenu: 'Apps',
    MediaPlayPause: 'MediaPlayPause', MediaTrackNext: 'MediaNextTrack', MediaTrackPrevious: 'MediaPreviousTrack', MediaStop: 'MediaStop',
  };
  const MOUSE_NAMES = { 1: 'MiddleMouse', 3: 'Mouse4', 4: 'Mouse5' };
  const mods = (e) => [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean);

  /** Turns a keydown (or a middle/side mouse button) into a gesture the host understands ("Ctrl+Alt+M", "Ctrl+/", "Mouse4"). */
  function gestureFrom(e) {
    if (e.type === 'mousedown' || e.type === 'auxclick' || ('button' in e && !('code' in e))) {
      const b = MOUSE_NAMES[e.button];
      return b ? [...mods(e), b].join('+') : null;
    }
    const c = e.code || '';
    let key = null;
    if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
    else if (/^Digit\d$/.test(c)) key = 'D' + c.slice(5);
    else if (/^F\d{1,2}$/.test(c)) key = c;
    else if (/^Numpad\d$/.test(c)) key = 'NumPad' + c.slice(6);
    else key = KEY_NAMES[c] || null;
    if (!key) return null;
    return [...mods(e), key].join('+');
  }

  function renderMicState() {
    const v = micState || (mic && { verdict: mic.verdict, label: mic.label, explain: mic.explain, windows: mic.windows.state, obs: mic.obs.state, obsConnected: mic.obs.connected, obsError: mic.obs.error });
    const pill = $('#sd-mic-pill');
    if (pill && v) { pill.hidden = v.verdict === 'notsetup'; pill.className = 'sd-mic-pill ' + v.verdict; pill.textContent = '🎙 ' + v.label; }
    const box = $('#mic-verdict');
    if (!box || !v) return;
    box.className = 'mic-verdict ' + v.verdict;
    box.replaceChildren(el('div', { class: 'mic-big', text: v.verdict === 'notsetup' ? 'Not set up' : v.label }), el('p', { text: v.explain }),
      el('div', { class: 'mic-sides' },
        el('span', { 'data-side': 'windows' }, 'Windows mic: ', el('strong', { text: MIC_WORD[v.windows] || v.windows })),
        el('span', { 'data-side': 'obs' }, 'OBS: ', el('strong', { text: MIC_WORD[v.obs] || v.obs })),
        el('span', {}, 'Discord: ', el('strong', { text: v.windows === 'off' ? 'not covered' : 'hears the Windows mic' }))));
    const obsLine = $('#mic-obs-line');
    if (obsLine) obsLine.textContent = v.obsConnected ? `Connected${mic && mic.obs.version ? ` · obs-websocket ${mic.obs.version}` : ''}` : v.obsError || (mic && mic.config.obs ? 'Not connected' : '');
  }

  async function renderMic(body, gen) {
    try { mic = await req('mic.status'); } catch (err) { hooks.showError(err); return; }
    if (gen !== renderGen) return;
    micState = null;
    const c = mic.config;
    const frag = document.createDocumentFragment();
    const save = async (patch, redraw = true) => {
      if (redraw) micSettled = false;
      try { mic = await req('mic.config', patch); micState = null; } catch (err) { hooks.showError(err); }
      if (redraw && tab === 'mic') setTab('mic'); else renderMicState();
    };
    const check = (id, checked, label, onChange) => { const i = el('input', { type: 'checkbox', id }); i.checked = !!checked; i.addEventListener('change', () => onChange(i.checked)); return el('label', { class: 'inline' }, i, label); };

    const device = el('select', { id: 'mic-device', 'aria-label': 'Microphone' },
      el('option', { value: '', text: `Default microphone${mic.devices.find((d) => d.isDefault) ? ` (${mic.devices.find((d) => d.isDefault).name})` : ''}` }),
      ...mic.devices.map((d) => el('option', { value: d.id, text: d.name })));
    device.value = c.deviceId || '';
    device.addEventListener('change', () => save({ deviceId: device.value || null }));

    const url = el('input', { type: 'text', id: 'mic-obs-url', value: c.obsUrl, 'aria-label': 'OBS WebSocket address', spellcheck: 'false' });
    const pw = el('input', { type: 'password', id: 'mic-obs-pw', autocomplete: 'off', 'aria-label': 'OBS WebSocket password', placeholder: mic.obs.hasPassword ? 'saved in Windows Credential Manager' : 'password from OBS' });
    const remember = el('input', { type: 'checkbox', id: 'mic-obs-remember' }); remember.checked = true;
    const connect = async () => {
      try {
        if (url.value.trim() !== c.obsUrl) await req('mic.config', { obsUrl: url.value.trim() });
        mic = await req('mic.obs.connect', { password: pw.value, remember: remember.checked });
        pw.value = '';
        notice('Connected to OBS', 1600);
      } catch (err) {
        // Keep the form as it is, so a mistyped password can just be corrected.
        hooks.showError(err);
        const line = $('#mic-obs-line');
        if (line) line.textContent = err.message;
        return;
      }
      if (tab === 'mic') setTab('mic');
    };
    const input = el('select', { id: 'mic-obs-input', 'aria-label': 'OBS microphone source', disabled: !mic.obs.inputs.length || undefined },
      ...(mic.obs.inputs.length ? mic.obs.inputs.map((i) => el('option', { value: i.name, text: i.name })) : [el('option', { value: '', text: 'Connect to list the sources' })]));
    input.value = c.obsInput || '';
    input.addEventListener('change', () => save({ obsInput: input.value }, false));

    const hk = el('input', { type: 'text', id: 'mic-hotkey', readonly: true, value: c.hotkey || '', placeholder: 'Click here, then press keys or a mouse button', 'aria-label': 'Mic Guard hotkey' });
    hk.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
      if (e.key === 'Escape' || (plain && (e.key === 'Backspace' || e.key === 'Delete'))) { hk.value = ''; return; }
      const g = gestureFrom(e);
      if (g) hk.value = g;
    });
    // Middle and side mouse buttons: record them, and keep the side buttons from acting as Back / Forward here.
    hk.addEventListener('mousedown', (e) => { const g = gestureFrom(e); if (g) { e.preventDefault(); hk.focus(); hk.value = g; } });
    ['mouseup', 'auxclick'].forEach((t) => hk.addEventListener(t, (e) => { if (e.button !== 0) e.preventDefault(); }));
    const range = (id, key, min, max, step) => { const r = el('input', { type: 'range', id, min, max, step, value: String(c[key]) }); r.addEventListener('change', () => save({ [key]: Number(r.value) }, false)); return r; };

    frag.append(el('div', { class: 'sd-grid' },
      el('div', { class: 'sd-col' },
        el('section', { class: 'sd-card' },
          el('div', { class: 'mic-verdict', id: 'mic-verdict' }),
          el('div', { class: 'sd-row' },
            el('button', { class: 'action', id: 'mic-mute', onclick: async () => { try { mic = await req('mic.set', { muted: true }); micState = null; renderMicState(); } catch (err) { hooks.showError(err); } } }, '🔇 Mute everywhere'),
            el('button', { class: 'action', id: 'mic-unmute', onclick: async () => { try { mic = await req('mic.set', { muted: false }); micState = null; renderMicState(); } catch (err) { hooks.showError(err); } } }, '🎙 Unmute everywhere'),
            el('button', { class: 'action primary', id: 'mic-toggle', onclick: toggleMic }, c.hotkey ? `Toggle (${c.hotkey})` : 'Toggle'))),
        el('section', { class: 'sd-card' },
          el('h3', { text: 'Windows microphone' }),
          check('mic-windows', c.windows, 'Mute and unmute the microphone in Windows', (on) => save({ windows: on })),
          el('div', { class: 'sd-row' }, el('span', { class: 'sd-label', text: 'Microphone' }), device),
          el('p', { class: 'pref-hint', text: 'This is the switch that matters: a muted Windows microphone is silent for OBS, Discord, games and every other program at once.' + (mic.windows.error ? ' — ' + mic.windows.error : '') })),
        el('section', { class: 'sd-card' },
          el('h3', { text: 'OBS' }),
          check('mic-obs', c.obs, 'Also mute OBS’s microphone source', (on) => save({ obs: on })),
          el('div', { class: 'sd-row' }, el('span', { class: 'sd-label', text: 'Address' }), url),
          el('div', { class: 'sd-row' }, el('span', { class: 'sd-label', text: 'Password' }), pw,
            el('label', { class: 'inline' }, remember, 'Remember'),
            el('button', { class: 'utility-btn', id: 'mic-obs-connect', onclick: connect }, 'Connect'),
            mic.obs.hasPassword ? el('button', { class: 'utility-btn danger', id: 'mic-obs-forget', onclick: async () => { try { mic = await req('mic.obs.forget'); notice('Password removed from Windows Credential Manager', 2000); setTab('mic'); } catch (err) { hooks.showError(err); } } }, 'Forget password') : null),
          el('div', { class: 'sd-row' }, el('span', { class: 'sd-label', text: 'Mic source' }), input),
          el('p', { class: 'pref-hint', id: 'mic-obs-line' }),
          el('p', { class: 'pref-hint', text: 'In OBS: Tools › WebSocket Server Settings › Enable, then Show Connect Info for the password. NoorMD sets the source’s mute explicitly and listens when you change it in OBS. The password is kept in Windows Credential Manager, never in NoorMD’s files.' }))),
      el('div', { class: 'sd-col' },
        el('section', { class: 'sd-card' },
          el('h3', { text: 'One hotkey' }),
          el('div', { class: 'sd-row' }, hk, el('button', { class: 'utility-btn', id: 'mic-hotkey-save', onclick: () => save({ hotkey: hk.value }) }, 'Use this key'),
            el('button', { class: 'utility-btn', onclick: () => save({ hotkey: '' }) }, 'Clear')),
          mic.hotkey.error ? el('p', { class: 'mic-error', text: mic.hotkey.error }) : null,
          el('p', { class: 'pref-hint', text: 'A key with Ctrl/Alt/Shift (also / \\ , . and the like), a function key up to F24, or a side mouse button. Works everywhere, also in games. If anything is live it mutes everything; only when everything is muted does it unmute. Use a key that OBS and Discord do NOT also use, and remove their own mute keybinds: two switches on one key is what makes them drift apart.' })),
        el('section', { class: 'sd-card' },
          el('h3', { text: 'Floating indicator' }),
          check('mic-indicator', c.indicator, 'Show the indicator on top of other windows', (on) => save({ indicator: on })),
          el('div', { class: 'sd-row' }, el('span', { class: 'sd-label', text: 'Opacity' }), range('mic-opacity', 'opacity', '0.2', '1', '0.05')),
          el('div', { class: 'sd-row' }, el('span', { class: 'sd-label', text: 'Size' }), range('mic-scale', 'scale', '0.6', '2.5', '0.1')),
          check('mic-capture', c.hideFromCapture, 'Hide it from OBS and screenshots', (on) => save({ hideFromCapture: on })),
          el('p', { class: 'pref-hint', text: 'Click the indicator to mute or unmute, drag it anywhere, right-click for more. It never takes focus from a game. It is not drawn over games in exclusive full screen; use borderless windowed. ' + (mic.indicator.shown && c.hideFromCapture && !mic.indicator.excludedFromCapture ? 'This Windows version can’t hide it from capture (needs Windows 10 2004 or newer).' : '') })),
        el('section', { class: 'sd-card' },
          el('h3', { text: 'Discord' }),
          el('p', { class: 'pref-hint', text: 'Discord doesn’t let other apps read or press its own mute button reliably, so NoorMD doesn’t try. With the Windows microphone muted, Discord hears silence; Discord’s mute icon just won’t change. NoorMD never logs into Discord or automates your account.' })))));
    body.replaceChildren(frag);
    micSettled = true;
    renderMicState();
  }

  return {
    init, open, close, toggle, isOpen, nowPlaying, toggleMic, _gesture: gestureFrom,
    _state: () => ({ open: isOpen(), tab, micSettled, mic: mic && mic.config, micVerdict: (micState || mic || {}).verdict, np, cr, effects: effects.map((e) => e.id), supporters: supporters.length, dirty: supportersDirty, current: current && { title: current.title, path: current.path, tracks: (current.tracklist || []).length } }),
  };
})();
