// NoorMD NoorRadio: your internet radio stations, in a panel that docks like the other benches. A station plays
// through the app's relay on 127.0.0.1, which also reads the song titles from the stream. One sound at a time: the
// radio pauses the music and the video, and stops when they play. Nothing is recorded.
window.NoorRadio = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const SLEEP = [0, 15, 30, 45, 60, 90];

  let hooks = { showError: (e) => console.error(e), onPlay: () => {}, onNowPlaying: () => {} };
  let built = false;
  let stations = [];
  let view = 'all';
  let filter = '';
  // What is on: a saved station (id) or one tried from the directory (url); token matches the relay's title events.
  let on = null; // { id, name, url, token, title, state: 'connecting' | 'playing' | 'error', message }
  let sleepTimer = null, sleepUntil = 0, sleepTick = null;
  const audio = new Audio();
  audio.preload = 'none';

  const isOpen = () => document.body.classList.contains('radio-open');
  const isPlaying = () => !!on && on.state !== 'error' && !audio.paused;
  const volume = () => { try { const v = Number(localStorage.getItem('noormd.radio.volume')); return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0.8; } catch { return 0.8; } };

  function init(h) {
    hooks = { ...hooks, ...h };
    audio.volume = volume();
    // NoorMusic's sound (equalizer, even loudness, limiter) for the radio too, unless that is turned off there.
    if (window.NoorFx) NoorFx.attachRadio(audio);
    NoorBridge.on('radio.title', (p) => { if (on && p.token === on.token) { on.title = p.title; renderNow(); emit(); } });
    NoorBridge.on('radio.failed', (p) => { if (on && p.token === on.token) fail(p.message); });
    audio.addEventListener('playing', () => { if (on) { on.state = 'playing'; on.message = null; renderNow(); renderList(); emit(); } });
    audio.addEventListener('pause', () => { renderNow(); emit(); });
    // A stream that was playing and broke. (While connecting, play() itself and the relay say what went wrong.)
    audio.addEventListener('error', () => {
      if (on && on.state === 'playing' && audio.getAttribute('src')) fail(`The station stopped or can’t be played${audio.error ? ` (media error ${audio.error.code})` : ''}.`);
    });
  }

  async function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('radio');
    document.body.classList.add('radio-open');
    $('#radiobench').hidden = false;
    await refresh();
    $('#radio-search').focus({ preventScroll: true });
  }

  function close() {
    if (!built || !isOpen()) return;
    document.body.classList.remove('radio-open');
    $('#radiobench').hidden = true;
    if (window.NoorDock) NoorDock.closed('radio');
  }

  function toggle() { if (isOpen()) close(); else open(); }

  async function refresh() {
    try { stations = (await req('radio.list')).stations; } catch (err) { hooks.showError(err); return; }
    render();
  }

  // ---------------------------------------------------------------- playing

  async function play(station) {
    stop(true, true); // the relay closes the old stream itself when it opens the new one
    on = { id: station.id ?? null, name: station.name, url: station.url, token: null, title: null, state: 'connecting', message: null };
    hooks.onPlay(); // the music and the video pause
    renderNow(); renderList();
    try {
      const r = await req('radio.play', station.id != null ? { id: station.id } : { url: station.url });
      if (!on || on.url !== station.url) return; // another station was chosen meanwhile
      on.token = r.token;
      audio.src = r.url;
      audio.volume = volume();
      await audio.play();
      if (station.id != null) { const s = stations.find((x) => x.id === station.id); if (s) { s.plays++; s.lastPlayed = new Date().toISOString(); } }
    } catch (err) {
      // An interrupted play() (another station, Stop) is not a failure of its own.
      if (err && err.name === 'AbortError') return;
      if (on && on.url === station.url) fail(err && err.name === 'NotSupportedError' ? 'This station’s sound can’t be played here (format or address).' : err && err.message ? err.message : String(err));
    }
  }

  function fail(message) {
    if (!on || on.state === 'error') return; // the first reason is the one worth showing
    on.state = 'error';
    on.message = message;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    renderNow(); renderList(); emit();
  }

  /** Stops the radio (silent: a new station is about to start; keepHost: the relay switches by itself). */
  function stop(silent, keepHost) {
    const was = on;
    on = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (was && !keepHost) req('radio.stop').catch(() => {});
    if (!silent) { setSleep(0); renderNow(); renderList(); emit(); }
  }

  function playPause() {
    if (on && on.state === 'playing' && !audio.paused) { stop(); return; } // live radio: pausing is stopping
    const last = on || lastStation();
    if (last) play(last); else notice('Choose a station first.', 1600);
  }

  function lastStation() {
    return [...stations].filter((s) => s.lastPlayed).sort((a, b) => String(b.lastPlayed).localeCompare(String(a.lastPlayed)))[0] || stations[0] || null;
  }

  /** Tells NoorStream what is on (its Now Playing overlay). */
  function emit() {
    // A number from the station and song (negative: never a music track's id), so each new song is a new line in the stream's tracklist.
    const key = on ? `${on.url}|${on.title || ''}` : '';
    let id = 0;
    for (let i = 0; i < key.length; i++) id = (id * 31 + key.charCodeAt(i)) | 0;
    hooks.onNowPlaying(on && on.state === 'playing' && !audio.paused ? { id: -Math.abs(id || 1), title: on.title || on.name, artist: on.title ? on.name : 'NoorRadio', hasArt: false, playing: true, position: 0, duration: 0 } : null);
  }

  function setVolume(v) {
    audio.volume = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('noormd.radio.volume', String(audio.volume || 0.01)); } catch { /* private storage off */ }
  }

  /** Sleep timer: after the minutes, the radio fades out over ten seconds and stops. */
  function setSleep(minutes) {
    clearTimeout(sleepTimer); clearInterval(sleepTick);
    sleepTimer = null; sleepUntil = 0;
    if (minutes > 0) {
      sleepUntil = Date.now() + minutes * 60000;
      sleepTimer = setTimeout(fadeOut, minutes * 60000 - 10000);
      sleepTick = setInterval(renderSleep, 30000);
      notice(`The radio stops in ${minutes} minutes`, 1600);
    }
    renderSleep();
  }

  function fadeOut() {
    const start = audio.volume;
    let n = 0;
    const t = setInterval(() => {
      n++;
      audio.volume = Math.max(0, start * (1 - n / 20));
      if (n >= 20) { clearInterval(t); stop(); audio.volume = volume(); }
    }, 500);
  }

  function renderSleep() {
    const s = $('#radio-sleep');
    if (!s) return;
    const left = sleepUntil ? Math.max(0, Math.round((sleepUntil - Date.now()) / 60000)) : 0;
    s.value = sleepUntil ? 'on' : '0';
    s.querySelector('option[value="on"]').textContent = left ? `☾ ${left} min left` : '☾';
    s.querySelector('option[value="on"]').hidden = !sleepUntil;
  }

  // ---------------------------------------------------------------- panel

  function build() {
    built = true;
    const root = el('section', { id: 'radiobench', class: 'radiobench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'NoorRadio' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '📻' }), el('strong', { text: 'NoorRadio' }), el('small', { id: 'radio-count' })),
        el('span', { class: 'panel-head-buttons' },
          el('button', { class: 'icon-btn', id: 'radio-add', title: 'Add a station', 'aria-label': 'Add a station', onclick: () => editStation(null) }, '＋'),
          el('button', { class: 'icon-btn', id: 'radio-more', title: 'Find stations online, import, export', 'aria-label': 'NoorRadio menu', onclick: (e) => mainMenu(e.currentTarget) }, '⋯'),
          el('button', { class: 'icon-btn', id: 'radio-dock', title: 'Where this panel goes (left, right, bottom, the middle)', 'aria-label': 'Move NoorRadio', onclick: (e) => NoorDock.showMenu('radio', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn', title: 'Close (Ctrl+Alt+I)', 'aria-label': 'Close NoorRadio', onclick: close }, '✕'))),
      el('section', { class: 'radio-now', id: 'radio-now', 'aria-live': 'polite' }),
      el('div', { class: 'apps-toolbar' },
        el('input', { id: 'radio-search', type: 'search', placeholder: 'Find a station…', 'aria-label': 'Find a station', autocomplete: 'off', spellcheck: 'false' }),
        el('div', { class: 'apps-cats', id: 'radio-views', role: 'tablist', 'aria-label': 'Show' })),
      el('div', { class: 'radio-list', id: 'radio-list', role: 'listbox', 'aria-label': 'Stations', tabindex: '0' }));
    ($('#app') || document.body).append(root);
    $('#radio-search').addEventListener('input', (e) => { filter = e.target.value.trim().toLowerCase(); renderList(); });
    $('#radio-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = shown()[0]; if (first) { e.preventDefault(); play(first); } }
      if (e.key === 'ArrowDown') { e.preventDefault(); $('#radio-list .radio-item')?.focus(); }
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.target.closest('input, select')) { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === ' ' && !e.target.closest('input, select, button')) { e.preventDefault(); playPause(); }
    });
  }

  function render() {
    if (!built) return;
    $('#radio-count').textContent = stations.length ? String(stations.length) : '';
    renderViews(); renderNow(); renderList();
  }

  function renderNow() {
    const box = $('#radio-now');
    if (!box) return;
    const state = !on ? 'idle' : on.state === 'error' ? 'error' : audio.paused && on.state === 'playing' ? 'idle' : on.state;
    const vol = el('input', { type: 'range', id: 'radio-volume', min: '0', max: '100', value: String(Math.round(audio.volume * 100)), 'aria-label': 'Volume', title: 'Volume' });
    vol.addEventListener('input', () => setVolume(Number(vol.value) / 100));
    const sleep = el('select', { id: 'radio-sleep', 'aria-label': 'Sleep timer', title: 'Sleep timer: stop the radio after…' },
      el('option', { value: 'on', hidden: true }), ...SLEEP.map((m) => el('option', { value: String(m), text: m ? `☾ ${m} min` : '☾ Sleep: off' })));
    sleep.addEventListener('change', () => { if (sleep.value !== 'on') setSleep(Number(sleep.value)); });
    const playing = state === 'playing' || state === 'connecting';
    box.className = 'radio-now ' + state;
    box.replaceChildren(
      el('button', { class: 'radio-play', id: 'radio-play', title: playing ? 'Stop (Space)' : 'Play (Space)', 'aria-label': playing ? 'Stop' : 'Play', onclick: playPause }, playing ? '■' : '▶'),
      el('div', { class: 'radio-now-text' },
        el('strong', { id: 'radio-now-name', text: on ? on.name : 'NoorRadio' }),
        el('span', { id: 'radio-now-title', text: state === 'connecting' ? 'Connecting…' : state === 'error' ? on.message : on && on.title ? on.title : on ? 'On air' : stations.length ? 'Choose a station, or press Space for the last one' : 'Add a station to start' })),
      vol, sleep);
    renderSleep();
  }

  function renderViews() {
    const tags = [...new Set(stations.flatMap((s) => s.tags || []))].sort((a, b) => a.localeCompare(b));
    const views = [['all', 'All'], ['fav', '★ Favourites'], ['recent', 'Recent'], ...tags.map((t) => ['tag:' + t, '# ' + t])];
    if (!views.some(([k]) => k === view)) view = 'all';
    $('#radio-views').replaceChildren(...views.map(([k, label]) => el('button', { class: 'chip' + (view === k ? ' active' : ''), role: 'tab', 'aria-selected': String(view === k), 'data-view': k, onclick: () => { view = k; renderViews(); renderList(); } }, label)));
  }

  function shown() {
    let list = stations;
    if (view === 'fav') list = list.filter((s) => s.favorite);
    else if (view === 'recent') list = list.filter((s) => s.lastPlayed).sort((a, b) => String(b.lastPlayed).localeCompare(String(a.lastPlayed))).slice(0, 20);
    else if (view.startsWith('tag:')) list = list.filter((s) => (s.tags || []).includes(view.slice(4)));
    if (filter) list = list.filter((s) => (s.name + ' ' + (s.tags || []).join(' ')).toLowerCase().includes(filter));
    return list;
  }

  function renderList() {
    const box = $('#radio-list');
    if (!box) return;
    const list = shown();
    if (!stations.length) {
      box.replaceChildren(el('div', { class: 'vb-empty' }, el('h2', { text: 'Your radio stations' }),
        el('p', { text: 'Add a station by its stream address, import an .m3u or .pls list, or find stations in the free Radio Browser directory (online, only when you search).' }),
        el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => editStation(null) }, '＋ Add a station…'), el('button', { class: 'action primary', id: 'radio-find-empty', onclick: findOnline }, '🔎 Find stations online…'))));
      return;
    }
    if (!list.length) { box.replaceChildren(el('p', { class: 'music-none', text: filter ? 'No station matches.' : view === 'fav' ? 'No favourites yet: click ☆ next to a station.' : 'Nothing here yet.' })); return; }
    box.replaceChildren(...list.map((s) => {
      const isOn = on && on.id === s.id;
      const row = el('div', { class: 'radio-item' + (isOn ? ' on ' + on.state : ''), role: 'option', tabindex: '0', 'data-id': String(s.id), 'aria-selected': String(!!isOn), title: s.url,
        ondblclick: () => play(s), oncontextmenu: (e) => { e.preventDefault(); stationMenu(s, e.clientX, e.clientY); } },
      el('button', { class: 'radio-fav' + (s.favorite ? ' on' : ''), title: s.favorite ? 'Favourite (click to remove)' : 'Add to favourites', 'aria-label': 'Favourite', 'aria-pressed': String(!!s.favorite), onclick: (e) => { e.stopPropagation(); favorite(s, !s.favorite); } }, s.favorite ? '★' : '☆'),
      el('span', { class: 'radio-item-text' }, el('span', { class: 'radio-item-name', text: s.name }), el('small', { text: [(s.tags || []).join(', '), s.plays ? `played ${s.plays}×` : ''].filter(Boolean).join(' · ') || hostOf(s.url) })),
      el('button', { class: 'icon-btn radio-item-play', title: isOn && on.state !== 'error' ? 'Stop' : 'Play', 'aria-label': isOn && on.state !== 'error' ? 'Stop' : `Play ${s.name}`, onclick: (e) => { e.stopPropagation(); if (isOn && on.state !== 'error') stop(); else play(s); } }, isOn && on.state !== 'error' ? '■' : '▶'));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); play(s); }
        if (e.key === 'Delete') { e.preventDefault(); removeStation(s); }
        if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); editStation(s); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); (e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling)?.focus(); }
      });
      return row;
    }));
  }

  const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

  function stationMenu(s, x, y) {
    NoorChrome.openMenu(null, [
      { label: on && on.id === s.id && on.state !== 'error' ? 'Stop' : 'Play', run: () => (on && on.id === s.id && on.state !== 'error' ? stop() : play(s)) },
      { label: s.favorite ? 'Not a favourite' : 'Favourite', run: () => favorite(s, !s.favorite) },
      '-',
      { label: 'Edit…  (F2)', run: () => editStation(s) },
      { label: 'Copy the stream address', run: () => navigator.clipboard.writeText(s.url).then(() => notice('Address copied', 1200)).catch(() => notice(s.url, 4000)) },
      '-',
      { label: 'Delete…  (Del)', run: () => removeStation(s) },
    ], { x, y });
  }

  function mainMenu(anchorEl) {
    NoorChrome.openMenu(anchorEl, [
      { label: 'Find stations online (Radio Browser)…', run: findOnline },
      { label: 'Add a station…', run: () => editStation(null) },
      '-',
      { label: 'Import stations (.m3u, .pls)…', run: importStations },
      { label: 'Export stations (.m3u8)…', disabled: !stations.length, run: exportStations },
      { label: 'Sound: equalizer and even loudness (shared with NoorMusic)…', run: () => window.NoorMusic && NoorMusic.openSound() },
    ]);
  }

  async function favorite(s, onOff) {
    try { stations = (await req('radio.favorite', { id: s.id, on: onOff })).stations; render(); } catch (err) { hooks.showError(err); }
  }

  async function removeStation(s) {
    if (!await NoorUI.confirm(`Delete “${s.name}”?`, 'The station is removed from your list.', 'Delete')) return;
    try {
      if (on && on.id === s.id) stop();
      stations = (await req('radio.delete', { id: s.id })).stations;
      render();
    } catch (err) { hooks.showError(err); }
  }

  function editStation(s) {
    NoorUI.modal({ label: s ? 'Edit station' : 'Add a station', width: 520 }, (box, closeModal) => {
      const name = el('input', { type: 'text', id: 'rs-name', value: s ? s.name : '', placeholder: 'e.g. Radio Nowy Świat', maxlength: '120', spellcheck: 'false' });
      const url = el('input', { type: 'url', id: 'rs-url', value: s ? s.url : '', placeholder: 'https://…/stream (or a .pls / .m3u link)', spellcheck: 'false', autofocus: !s || undefined });
      const home = el('input', { type: 'url', id: 'rs-home', value: s && s.homepage ? s.homepage : '', placeholder: 'https://… (optional)', spellcheck: 'false' });
      const tags = el('input', { type: 'text', id: 'rs-tags', value: s ? (s.tags || []).join(', ') : '', placeholder: 'jazz, polish, talk (optional)', spellcheck: 'false' });
      const msg = el('p', { class: 'pref-hint', id: 'rs-msg', text: 'The stream address is the one a player opens (Icecast/Shoutcast MP3, AAC or Ogg). A .pls or .m3u link is read for you.' });
      const save = async () => {
        msg.textContent = 'Checking…';
        const payload = { name: name.value, url: url.value, homepage: home.value || null, tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean) };
        try {
          const r = s ? await req('radio.update', { id: s.id, ...payload }) : await req('radio.add', payload);
          stations = r.stations;
          closeModal();
          render();
          if (!s) notice(r.added ? 'Station added' : 'That station was already in your list', 1600);
        } catch (err) { msg.textContent = err && err.message ? err.message : String(err); }
      };
      [name, url, home, tags].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }));
      box.append(NoorUI.head(s ? '📻 Edit station' : '📻 Add a station', closeModal),
        el('div', { class: 'modal-body apps-form' },
          el('label', {}, el('span', { text: 'Stream address' }), url),
          el('label', {}, el('span', { text: 'Name' }), name),
          el('label', {}, el('span', { text: 'Website' }), home),
          el('label', {}, el('span', { text: 'Tags' }), tags),
          msg),
        el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' },
          el('button', { class: 'action', onclick: () => closeModal() }, 'Cancel'),
          el('button', { class: 'action primary', id: 'rs-save', onclick: save }, s ? 'Save' : 'Add'))));
      if (s) setTimeout(() => name.focus(), 0);
    });
  }

  async function importStations() {
    try {
      const r = await req('radio.import');
      if (!r || r.cancelled) return;
      stations = r.stations;
      render();
      notice(`Imported ${r.added} station${r.added === 1 ? '' : 's'}${r.known ? ` (${r.known} already in your list)` : ''}`, 2600);
    } catch (err) { hooks.showError(err); }
  }

  async function exportStations() {
    try { const r = await req('radio.export'); if (r && !r.cancelled) notice(`Exported ${r.count} stations to ${r.path}`, 3500); } catch (err) { hooks.showError(err); }
  }

  /** The Radio Browser directory: asked only when you press Search, with only what you typed. */
  function findOnline() {
    NoorUI.modal({ label: 'Find stations online', width: 720 }, (box, closeModal) => {
      const q = el('input', { type: 'search', id: 'rf-query', placeholder: 'Station name, e.g. jazz, Trójka, lofi…', spellcheck: 'false', autofocus: true });
      const status = el('p', { class: 'pref-hint', id: 'rf-status', text: 'Searches radio-browser.info, a free community directory, over the internet. Only what you type is sent.' });
      const results = el('div', { class: 'radio-results', id: 'rf-results' });
      let busy = false;
      const search = async () => {
        if (busy || q.value.trim().length < 2) { if (q.value.trim().length < 2) status.textContent = 'Type at least two letters.'; return; }
        busy = true; status.textContent = 'Searching…';
        try {
          const found = await req('radio.search', { query: q.value.trim() });
          status.textContent = found.length ? `${found.length} station${found.length === 1 ? '' : 's'} found.` : 'Nothing found. Try another name.';
          results.replaceChildren(...found.map((f) => el('div', { class: 'radio-result' },
            el('span', { class: 'radio-item-text' }, el('span', { class: 'radio-item-name', text: f.name }),
              el('small', { text: [f.country, f.codec && f.bitrate ? `${f.codec} ${f.bitrate} kbps` : f.codec, (f.tags || []).slice(0, 4).join(', '), f.hls ? 'HLS' : ''].filter(Boolean).join(' · ') })),
            el('button', { class: 'utility-btn', title: 'Listen without adding it', onclick: () => play({ id: null, name: f.name, url: f.url }) }, '▶ Try'),
            f.saved ? el('span', { class: 'radio-saved', text: '✓ In your list' })
              : el('button', { class: 'utility-btn', onclick: async (e) => {
                const b = e.currentTarget;
                try { const r = await req('radio.add', { name: f.name, url: f.url, homepage: f.homepage, tags: (f.tags || []).slice(0, 4) }); stations = r.stations; render(); b.replaceWith(el('span', { class: 'radio-saved', text: '✓ Added' })); } catch (err) { status.textContent = err.message || String(err); }
              } }, '＋ Add'))));
        } catch (err) { status.textContent = err && err.message ? err.message : String(err); } finally { busy = false; }
      };
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
      box.append(NoorUI.head('🔎 Find stations online', closeModal),
        el('div', { class: 'modal-body' }, el('div', { class: 'radio-searchrow' }, q, el('button', { class: 'action primary', id: 'rf-go', onclick: search }, 'Search')), status, results),
        el('div', { class: 'modal-foot' }, el('span'), el('div', { class: 'modal-buttons' }, el('button', { class: 'action', onclick: () => closeModal() }, 'Done'))));
    });
  }

  return {
    init, open, close, toggle, isOpen, isPlaying, playPause, findOnline,
    /** Another player started (music, a video): the radio stops. */
    stopForOther: () => { if (on) { stop(); notice('NoorRadio stopped', 1200); } },
    stop: () => stop(),
    /** Self-test: play an address muted (autoplay rules allow muted sound without a click). */
    _testPlay: (stationUrl) => { audio.muted = true; return play({ id: null, name: 'Self-test', url: stationUrl }); },
    _state: () => ({ on: on ? { ...on } : null, src: audio.getAttribute('src'), crossOrigin: audio.crossOrigin, paused: audio.paused, view, count: stations.length, sleepUntil }),
  };
})();
