// NoorCalendar: important days, birthdays, reminders, appointments and schedules. The app keeps the calendar and
// works out repeats, ages and reminders (the same code for every view); this page shows the month, a week or the
// agenda, edits entries and shows reminders as cards (and, when NoorMD isn't in front, the app shows them near the clock).
window.NoorCalendar = (() => {
  'use strict';
  const { $, el, notice } = NoorUI;
  const req = (type, payload) => NoorBridge.request(type, payload);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const CATEGORY = {
    important: { label: 'Important', icon: '⭐', color: '#e5484d' },
    birthday: { label: 'Birthday / anniversary', icon: '🎂', color: '#f59e0b' },
    appointment: { label: 'Appointment', icon: '📌', color: '#3b82f6' },
    reminder: { label: 'Reminder / to do', icon: '🔔', color: '#8b5cf6' },
    stream: { label: 'Stream', icon: '🔴', color: '#10b981' },
    holiday: { label: 'Holiday / day off', icon: '🌴', color: '#ec4899' },
    other: { label: 'Other', icon: '•', color: '#64748b' },
  };
  const TIMED_REMINDERS = [[0, 'At the start'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before'], [2880, '2 days before'], [10080, '1 week before']];
  const ALLDAY_REMINDERS = [[-540, 'On the day at 9:00'], [-480, 'On the day at 8:00'], [900, 'The day before at 9:00'], [2340, '2 days before at 9:00'], [9540, 'A week before at 9:00'], [0, 'At midnight']];

  let hooks = { showError: (e) => console.error(e), insertMarkdown: () => false, hasDocument: () => false };
  let built = false;
  let entries = [];
  let byId = new Map();
  let view = (() => { try { return ['month', 'week', 'agenda'].includes(localStorage.getItem('noormd.cal.view')) ? localStorage.getItem('noormd.cal.view') : 'month'; } catch { return 'month'; } })();
  let weekStartsMonday = (() => { try { return localStorage.getItem('noormd.cal.monday') !== 'off'; } catch { return true; } })();
  // Public holidays of one country (worked out by their rules in the app; shown on their days, not saved or edited).
  let holidayCountry = (() => { try { return /^[A-Z]{2}$/.test(localStorage.getItem('noormd.cal.holidays') || '') ? localStorage.getItem('noormd.cal.holidays') : ''; } catch { return ''; } })();
  let countries = [];
  let cursor = startOfDay(new Date()); // the day the view is around
  let selected = startOfDay(new Date());
  let occurrences = [];
  let search = '';
  let loadGen = 0;
  const cards = new Map(); // reminder cards by key
  let lastDeleted = null;

  const isOpen = () => document.body.classList.contains('cal-open');

  // ---------------------------------------------------------------- dates (local, as "yyyy-MM-dd" / "yyyy-MM-ddTHH:mm")

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()); }
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeKey = (d) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  function parse(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s || '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)) : null;
  }
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const fmt = (d, opts) => d.toLocaleString(undefined, opts);
  const timeText = (d) => fmt(d, { hour: '2-digit', minute: '2-digit' });
  function weekStart(d) { const day = (d.getDay() + 7 - (weekStartsMonday ? 1 : 0)) % 7; return startOfDay(addDays(d, -day)); }
  const weekdayNames = () => Array.from({ length: 7 }, (_, i) => fmt(new Date(2024, 0, (weekStartsMonday ? 1 : 7) + i), { weekday: 'short' }));

  function init(h) {
    hooks = { ...hooks, ...h };
    NoorBridge.on('cal.reminders', (p) => (p.reminders || []).forEach(showCard));
    NoorBridge.on('cal.handled', (p) => dropCard(p.key));
    NoorBridge.on('cal.open', async (p) => {
      await open();
      dropCard(p.dismiss);
      if (p.date) { cursor = selected = parse(p.date); await refresh(); }
      const e = byId.get(p.entryId);
      if (e) editEntry(e, p.date);
    });
  }

  async function open() {
    if (!built) build();
    if (window.NoorDock) NoorDock.opened('calendar');
    document.body.classList.add('cal-open');
    $('#calendar').hidden = false;
    await loadEntries();
    $('#calendar').focus({ preventScroll: true });
  }

  function close() {
    if (!built || !isOpen()) return;
    document.body.classList.remove('cal-open');
    $('#calendar').hidden = true;
    if (window.NoorDock) NoorDock.closed('calendar');
  }

  function toggle() { if (isOpen()) close(); else open(); }

  async function loadEntries() {
    try {
      const r = await req('cal.entries');
      setEntries(r.entries);
      countries = r.countries || [];
      fillCountries();
      if (r.problem) notice(r.problem, 6000);
    } catch (err) { hooks.showError(err); return; }
    await refresh();
  }

  function setEntries(list) { entries = list || []; byId = new Map(entries.map((e) => [e.id, e])); }

  /** The days the view shows: [from, to). */
  function range() {
    if (view === 'month') {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const from = weekStart(first);
      return [from, addDays(from, 42)];
    }
    if (view === 'week') { const from = weekStart(cursor); return [from, addDays(from, 7)]; }
    // Agenda: from the chosen day, two months (a year either way when searching).
    return search ? [addDays(startOfDay(new Date()), -365), addDays(startOfDay(new Date()), 366)] : [cursor, addDays(cursor, 62)];
  }

  async function refresh() {
    if (!built) return;
    const gen = ++loadGen;
    const [from, to] = range();
    try {
      const r = await req('cal.range', { from: dayKey(from), to: dayKey(to), holidays: holidayCountry || undefined });
      if (gen !== loadGen) return;
      // Holidays as read-only all-day entries of their own.
      for (const id of [...byId.keys()]) if (id.startsWith('hol-')) byId.delete(id);
      const country = (countries.find((c) => c.code === holidayCountry) || {}).name || holidayCountry;
      const holidays = (r.holidays || []).map((h) => {
        byId.set(h.id, { id: h.id, title: h.name, category: 'holiday', allDay: true, notes: `Public holiday in ${country}`, readOnly: true, color: '' });
        const day = parse(h.date);
        return { entryId: h.id, date: h.date, start: h.date, end: dayKey(addDays(day, 1)), allDay: true, s: day, e: addDays(day, 1), holiday: true };
      });
      occurrences = [...holidays, ...r.occurrences.map((o) => ({ ...o, s: parse(o.start), e: parse(o.end) })).filter((o) => byId.has(o.entryId))]
        .sort((a, b) => a.s - b.s || (a.allDay ? -1 : 1));
    } catch (err) { hooks.showError(err); return; }
    render();
  }

  // ---------------------------------------------------------------- building

  function build() {
    built = true;
    const root = el('section', { id: 'calendar', class: 'soundbench calbench', hidden: true, tabindex: '-1', role: 'region', 'aria-label': 'Calendar' },
      el('header', { class: 'music-head' },
        el('div', { class: 'music-title' }, el('span', { class: 'glyph', text: '📅' }), el('strong', { text: 'Calendar' }), el('small', { id: 'cal-today' })),
        el('span', { class: 'panel-head-buttons' },
          el('button', { class: 'icon-btn', id: 'cal-import', title: 'Import a calendar (.ics) from Google, Outlook, Apple or another app', 'aria-label': 'Import a calendar', onclick: importIcs }, '📥'),
          el('button', { class: 'icon-btn', id: 'cal-export', title: 'Export the calendar (.ics) for another calendar app', 'aria-label': 'Export the calendar', onclick: exportIcs }, '📤'),
          el('button', { class: 'icon-btn', id: 'cal-agenda-insert', title: 'Insert the agenda of the week from the selected day into the document', 'aria-label': 'Insert the agenda into the document', onclick: insertAgenda }, '📝'),
          el('select', { id: 'cal-holidays', class: 'cal-holidays', title: 'Public holidays to show (worked out by their rules, nothing is downloaded)', 'aria-label': 'Public holidays' }, el('option', { value: '', text: 'No holidays' })),
          el('button', { class: 'icon-btn', id: 'cal-dock', title: 'Where this panel goes', 'aria-label': 'Move the calendar', onclick: (e) => NoorDock.showMenu('calendar', e.currentTarget) }, '⊞'),
          el('button', { class: 'icon-btn', title: 'Close (Ctrl+Alt+C)', 'aria-label': 'Close the calendar', onclick: close }, '✕'))),
      el('div', { class: 'cal-bar' },
        el('button', { class: 'icon-btn', id: 'cal-prev', title: 'Earlier (Page Up)', 'aria-label': 'Earlier', onclick: () => step(-1) }, '‹'),
        el('button', { class: 'utility-btn', id: 'cal-todaybtn', title: 'Go to today (T)', onclick: () => { cursor = selected = startOfDay(new Date()); refresh(); } }, 'Today'),
        el('button', { class: 'icon-btn', id: 'cal-next', title: 'Later (Page Down)', 'aria-label': 'Later', onclick: () => step(1) }, '›'),
        el('strong', { class: 'cal-title', id: 'cal-title' }),
        el('span', { class: 'cal-space' }),
        el('input', { type: 'search', id: 'cal-search', placeholder: 'Search', 'aria-label': 'Search the calendar', spellcheck: 'false' }),
        el('div', { class: 'cal-views', role: 'tablist' }, ...[['month', 'Month'], ['week', 'Week'], ['agenda', 'Agenda']].map(([id, label]) =>
          el('button', { role: 'tab', 'data-view': id, class: 'utility-btn', onclick: () => setView(id) }, label))),
        el('button', { class: 'action primary', id: 'cal-new', title: 'A new entry on the selected day (N)', onclick: () => newEntry(selected) }, '＋ New')),
      el('div', { class: 'cal-body', id: 'cal-body' }));
    ($('#app') || document.body).append(root);
    $('#cal-holidays').addEventListener('change', (e) => {
      holidayCountry = e.target.value;
      try { localStorage.setItem('noormd.cal.holidays', holidayCountry); } catch { /* private storage off */ }
      refresh();
    });
    fillCountries();
    $('#cal-search').addEventListener('input', (e) => {
      search = e.target.value.trim().toLowerCase();
      if (search && view !== 'agenda') setView('agenda'); else refresh();
    });
    root.addEventListener('keydown', onKey);
    new ResizeObserver(() => root.classList.toggle('narrow', root.clientWidth < 620)).observe(root);
  }

  function onKey(e) {
    if (e.target.closest('input, select, textarea')) { if (e.key === 'Escape' && e.target.id === 'cal-search') { e.target.value = ''; search = ''; refresh(); } return; }
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const k = e.key.toLowerCase();
    if (e.key === 'PageUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); step(1); }
    else if (k === 't' && !e.ctrlKey && !e.altKey) { e.preventDefault(); cursor = selected = startOfDay(new Date()); refresh(); }
    else if (k === 'n' && !e.ctrlKey && !e.altKey) { e.preventDefault(); newEntry(selected); }
    else if (k === 'm' && !e.ctrlKey && !e.altKey) setView('month');
    else if (k === 'w' && !e.ctrlKey && !e.altKey) setView('week');
    else if (k === 'a' && !e.ctrlKey && !e.altKey) setView('agenda');
    else if (k === 'z' && e.ctrlKey && lastDeleted) { e.preventDefault(); undoDelete(); }
  }

  function setView(v) {
    view = v;
    try { localStorage.setItem('noormd.cal.view', v); } catch { /* private storage off */ }
    cursor = selected;
    refresh();
  }

  function step(dir) {
    if (view === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
    else if (view === 'week') cursor = addDays(cursor, 7 * dir);
    else cursor = addDays(cursor, 30 * dir);
    if (view !== 'agenda') selected = view === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(selected.getDate(), 28)) : cursor;
    refresh();
  }

  // ---------------------------------------------------------------- views

  const colorOf = (e) => e.color || (CATEGORY[e.category] || CATEGORY.other).color;
  const labelOf = (o) => {
    const e = byId.get(o.entryId);
    if (!e) return '';
    const age = o.age != null ? (e.category === 'birthday' ? ` (${o.age})` : ` · ${o.age} yr${o.age === 1 ? '' : 's'}`) : '';
    return `${e.title}${age}`;
  };

  function fillCountries() {
    const sel = $('#cal-holidays');
    if (!sel || !countries.length || sel.options.length > 1) return;
    sel.append(...countries.map((c) => el('option', { value: c.code, text: `🎌 ${c.name}` })));
    sel.value = holidayCountry;
  }

  /** The agenda of the week from the selected day, as a block in the document on screen. */
  async function insertAgenda() {
    if (!hooks.hasDocument()) { notice('Open a document first: the agenda goes in at the cursor', 2500); return; }
    try {
      const r = await req('cal.agenda', { from: dayKey(selected), days: 7, holidays: holidayCountry || undefined });
      if (hooks.insertMarkdown(r.markdown)) notice('Agenda inserted', 1400);
    } catch (err) { hooks.showError(err); }
  }

  function render() {
    const today = startOfDay(new Date());
    $('#cal-today').textContent = fmt(today, { weekday: 'long', day: 'numeric', month: 'long' });
    document.querySelectorAll('#calendar .cal-views [data-view]').forEach((b) => { b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-selected', String(b.dataset.view === view)); });
    const [from, to] = range();
    $('#cal-title').textContent = view === 'month' ? fmt(cursor, { month: 'long', year: 'numeric' })
      : view === 'week' ? `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(addDays(to, -1), { day: 'numeric', month: 'short', year: 'numeric' })}`
        : search ? `Search: “${search}”` : `From ${fmt(cursor, { day: 'numeric', month: 'long' })}`;
    const body = $('#cal-body');
    body.replaceChildren(nextStrip(), view === 'month' ? monthView(from) : view === 'week' ? weekView(from) : agendaView());
    if (view === 'week') { const g = body.querySelector('.cal-weekgrid'); if (g) g.scrollTop = 8 * 44; }
  }

  /** "Today: 2 entries · Next: Ola's birthday on Friday" — at the top of every view. */
  function nextStrip() {
    const now = new Date();
    const todays = occurrences.filter((o) => o.s < addDays(startOfDay(now), 1) && o.e > startOfDay(now));
    const next = occurrences.find((o) => o.s > now);
    return el('div', { class: 'cal-strip', id: 'cal-strip' },
      el('span', { text: todays.length ? `Today: ${todays.map(labelOf).join(', ')}` : 'Nothing today' }),
      next ? el('button', { class: 'cal-link', onclick: () => editEntry(byId.get(next.entryId), next.date) }, `Next: ${labelOf(next)} · ${relative(next)}`) : null);
  }

  function relative(o) {
    const days = Math.round((startOfDay(o.s) - startOfDay(new Date())) / 86400000);
    const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? fmt(o.s, { weekday: 'long' }) : fmt(o.s, { day: 'numeric', month: 'short' });
    return o.allDay ? when : `${when} ${timeText(o.s)}`;
  }

  function chip(o, compact) {
    const e = byId.get(o.entryId);
    const c = CATEGORY[e.category] || CATEGORY.other;
    return el('button', {
      class: 'cal-chip' + (o.allDay ? ' allday' : ''), style: `--c:${colorOf(e)}`, 'data-entry': o.entryId, 'data-date': o.date,
      title: `${labelOf(o)}${o.allDay ? '' : ' · ' + timeText(o.s) + '–' + timeText(o.e)}${e.notes ? '\n' + e.notes.slice(0, 200) : ''}`,
      onclick: (ev) => { ev.stopPropagation(); editEntry(e, o.date); },
    }, compact && !o.allDay ? `${timeText(o.s)} ` : '', `${c.icon === '•' ? '' : c.icon + ' '}${labelOf(o)}`);
  }

  function dayOccurrences(day) {
    const next = addDays(day, 1);
    return occurrences.filter((o) => o.s < next && o.e > day && (o.e > o.s || sameDay(o.s, day)));
  }

  function monthView(from) {
    const today = startOfDay(new Date());
    const head = el('div', { class: 'cal-monthhead' }, ...weekdayNames().map((n) => el('span', { text: n })));
    const cells = Array.from({ length: 42 }, (_, i) => {
      const day = addDays(from, i);
      const list = dayOccurrences(day);
      const more = list.length > 3 ? list.length - 3 : 0;
      return el('div', {
        class: 'cal-day' + (day.getMonth() !== cursor.getMonth() ? ' other' : '') + (sameDay(day, today) ? ' today' : '') + (sameDay(day, selected) ? ' sel' : ''),
        'data-day': dayKey(day), role: 'gridcell', tabindex: sameDay(day, selected) ? '0' : '-1', 'aria-label': fmt(day, { weekday: 'long', day: 'numeric', month: 'long' }) + (list.length ? `, ${list.length} entr${list.length === 1 ? 'y' : 'ies'}` : ''),
        onclick: () => { selected = day; render(); },
        ondblclick: () => newEntry(day),
      }, el('span', { class: 'cal-daynum', text: String(day.getDate()) }),
      ...list.slice(0, 3).map((o) => chip(o, true)),
      more ? el('button', { class: 'cal-more', onclick: (ev) => { ev.stopPropagation(); selected = cursor = day; setView('agenda'); } }, `+${more} more`) : null);
    });
    return el('div', { class: 'cal-month' }, head, el('div', { class: 'cal-monthgrid', role: 'grid' }, ...cells));
  }

  function weekView(from) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    const today = startOfDay(new Date());
    const head = el('div', { class: 'cal-weekhead' }, el('span'), ...days.map((d) => el('button', { class: 'cal-weekday' + (sameDay(d, today) ? ' today' : '') + (sameDay(d, selected) ? ' sel' : ''), onclick: () => { selected = d; render(); } },
      el('small', { text: fmt(d, { weekday: 'short' }) }), el('strong', { text: String(d.getDate()) }))));
    const allDay = el('div', { class: 'cal-alldayrow' }, el('span', { class: 'cal-hourlabel', text: 'all day' }),
      ...days.map((d) => el('div', { class: 'cal-alldaycell', ondblclick: () => newEntry(d, true) }, ...dayOccurrences(d).filter((o) => o.allDay).map((o) => chip(o)))));
    const hours = el('div', { class: 'cal-hours' }, ...Array.from({ length: 24 }, (_, h) => el('div', { class: 'cal-hourlabel', text: fmt(new Date(2024, 0, 1, h), { hour: 'numeric' }) })));
    const cols = days.map((d) => {
      const col = el('div', { class: 'cal-col', 'data-day': dayKey(d) }, ...Array.from({ length: 24 }, (_, h) => el('div', { class: 'cal-slot', 'data-hour': String(h), ondblclick: () => newEntry(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h)) })));
      // Timed occurrences that touch this day, side by side when they overlap.
      const timed = dayOccurrences(d).filter((o) => !o.allDay).sort((a, b) => a.s - b.s);
      const lanes = [];
      for (const o of timed) {
        const s = Math.max(o.s, d), e = Math.min(o.e, addDays(d, 1));
        let lane = lanes.findIndex((end) => end <= s);
        if (lane < 0) { lane = lanes.length; lanes.push(e); } else lanes[lane] = e;
        o._lane = lane; o._s = s; o._e = e;
      }
      for (const o of timed) {
        const top = ((o._s - d) / 3600000) * 44, height = Math.max(20, ((o._e - o._s) / 3600000) * 44 - 2);
        const block = chip(o, true);
        block.classList.add('cal-block');
        block.style.cssText += `;top:${top}px;height:${height}px;left:calc(${(o._lane / lanes.length) * 100}% + 2px);width:calc(${100 / lanes.length}% - 4px)`;
        col.append(block);
      }
      if (sameDay(d, today)) { const now = new Date(); col.append(el('div', { class: 'cal-now', style: `top:${((now - d) / 3600000) * 44}px` })); }
      return col;
    });
    return el('div', { class: 'cal-week' }, head, allDay, el('div', { class: 'cal-weekgrid' }, hours, ...cols));
  }

  function agendaView() {
    const list = occurrences.filter((o) => {
      if (!search) return true;
      const e = byId.get(o.entryId);
      return `${e.title} ${e.notes} ${e.game || ''} ${e.platform || ''}`.toLowerCase().includes(search);
    });
    if (!list.length) return el('p', { class: 'pref-hint cal-empty', text: search ? 'Nothing found.' : 'Nothing in the next two months. ＋ New adds an entry.' });
    const groups = new Map();
    for (const o of list) {
      const key = dayKey(o.s < (search ? new Date(0) : cursor) ? cursor : o.s);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
    const today = startOfDay(new Date());
    return el('div', { class: 'cal-agenda' }, ...[...groups].map(([key, items]) => {
      const d = parse(key);
      return el('section', { class: 'cal-agendaday' + (sameDay(d, today) ? ' today' : ''), 'data-day': key },
        el('h4', { text: (sameDay(d, today) ? 'Today · ' : sameDay(d, addDays(today, 1)) ? 'Tomorrow · ' : '') + fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined }) }),
        ...items.map((o) => {
          const e = byId.get(o.entryId);
          return el('button', { class: 'cal-agendaitem', style: `--c:${colorOf(e)}`, 'data-entry': o.entryId, onclick: () => editEntry(e, o.date) },
            el('span', { class: 'cal-agendatime', text: o.allDay ? 'all day' : `${timeText(o.s)}–${timeText(o.e)}` }),
            el('span', { class: 'cal-agendatitle', text: `${(CATEGORY[e.category] || CATEGORY.other).icon} ${labelOf(o)}` }),
            e.reminders.length ? el('span', { class: 'cal-bell', title: `${e.reminders.length} reminder${e.reminders.length > 1 ? 's' : ''}`, text: '🔔' }) : null,
            e.repeat ? el('span', { class: 'cal-bell', title: 'Repeats', text: '🔁' }) : null,
            e.notes ? el('small', { class: 'cal-agendanotes', text: e.notes.split('\n')[0].slice(0, 120) }) : null);
        }));
    }));
  }

  // ---------------------------------------------------------------- editing

  function newEntry(day, allDay) {
    const d = day instanceof Date ? day : startOfDay(new Date());
    const timed = !allDay && (d.getHours() || d.getMinutes() || view === 'week');
    const start = timed ? d : startOfDay(d);
    editEntry({
      id: '', title: '', notes: '', category: 'appointment', color: '', allDay: !timed,
      start: timed ? timeKey(start) : dayKey(start), end: timed ? timeKey(new Date(start.getTime() + 3600000)) : dayKey(start),
      repeat: null, skip: [], moved: [], reminders: timed ? [15] : [], sinceYear: null, note: null, game: null, platform: null,
    }, null);
  }

  /**
   * The entry editor. Opened from an occurrence of a repeating entry, it can change every time or only that day
   * (moved), or leave that day out.
   */
  function editEntry(entry, occurrenceDate) {
    if (!entry) return;
    if (entry.readOnly) { notice(`${entry.title}: ${entry.notes}`, 2500); return; }
    const e = clone(entry);
    const isNew = !e.id;
    const repeating = !!e.repeat && !!occurrenceDate;
    const occ = repeating ? occurrences.find((o) => o.entryId === e.id && o.date === occurrenceDate) : null;
    NoorUI.modal({ label: isNew ? 'New entry' : 'Entry', width: 600 }, (s, closeModal) => {
      const row = (label, ...kids) => el('label', { class: 'cal-row' }, el('span', { text: label }), ...kids);
      const title = el('input', { type: 'text', id: 'cal-e-title', value: e.title, maxlength: '200', placeholder: 'What is it?', autofocus: true, 'aria-label': 'Title' });
      const cat = el('select', { id: 'cal-e-cat', 'aria-label': 'Kind' }, ...Object.entries(CATEGORY).map(([k, c]) => el('option', { value: k, text: `${c.icon} ${c.label}` })));
      cat.value = e.category;
      const color = el('input', { type: 'color', id: 'cal-e-color', value: e.color || (CATEGORY[e.category] || CATEGORY.other).color, 'aria-label': 'Colour' });
      let colorTouched = !!e.color;
      color.addEventListener('input', () => { colorTouched = true; });
      const allDay = el('input', { type: 'checkbox', id: 'cal-e-allday', checked: e.allDay || undefined });
      const scope = repeating ? el('select', { id: 'cal-e-scope', 'aria-label': 'Change' },
        el('option', { value: 'all', text: 'every time it repeats' }), el('option', { value: 'one', text: `only on ${fmt(parse(occurrenceDate), { weekday: 'long', day: 'numeric', month: 'long' })}` })) : null;
      const s0 = repeating && occ ? occ.s : parse(e.start), e0 = repeating && occ ? (e.allDay ? addDays(occ.e, -1) : occ.e) : parse(e.end);
      const startDay = el('input', { type: 'date', id: 'cal-e-startday', value: dayKey(s0), 'aria-label': 'Start day' });
      const startTime = el('input', { type: 'time', id: 'cal-e-starttime', value: `${pad(s0.getHours())}:${pad(s0.getMinutes())}`, 'aria-label': 'Start time' });
      const endDay = el('input', { type: 'date', id: 'cal-e-endday', value: dayKey(e0), 'aria-label': 'End day' });
      const endTime = el('input', { type: 'time', id: 'cal-e-endtime', value: `${pad(e0.getHours())}:${pad(e0.getMinutes())}`, 'aria-label': 'End time' });
      // Moving the start moves the end with it (same length).
      let length = e.allDay ? 0 : (e0 - s0);
      const syncEnd = () => {
        const ns = parse(`${startDay.value}T${startTime.value || '00:00'}`);
        if (!ns) return;
        if (allDay.checked) { const ne = parse(endDay.value); if (!ne || ne < startOfDay(ns)) endDay.value = startDay.value; }
        else { const ne = new Date(ns.getTime() + Math.max(length, 15 * 60000)); endDay.value = dayKey(ne); endTime.value = `${pad(ne.getHours())}:${pad(ne.getMinutes())}`; }
      };
      startDay.addEventListener('change', syncEnd); startTime.addEventListener('change', syncEnd);
      const remember = () => { const ns = parse(`${startDay.value}T${startTime.value}`), ne = parse(`${endDay.value}T${endTime.value}`); if (ns && ne && ne > ns) length = ne - ns; };
      endDay.addEventListener('change', remember); endTime.addEventListener('change', remember);
      const times = el('div', { class: 'cal-times' });
      const drawTimes = () => {
        times.replaceChildren(row('From', startDay, allDay.checked ? null : startTime), row(allDay.checked ? 'To (the last day)' : 'To', endDay, allDay.checked ? null : endTime));
      };
      allDay.addEventListener('change', () => {
        // To a time: 9:00 to 10:00 unless one was set; reminders that only fit the other kind are swapped for a usual one.
        if (!allDay.checked) {
          if (startTime.value === '00:00' || !startTime.value) startTime.value = '09:00';
          if (length < 15 * 60000) length = 3600000;
          syncEnd();
        }
        const keep = reminders.filter((m) => (allDay.checked ? ALLDAY_REMINDERS : TIMED_REMINDERS).some(([v]) => v === m) || (!allDay.checked && m > 0));
        reminders.splice(0, reminders.length, ...keep);
        if (!reminders.length && !allDay.checked) reminders.push(15);
        if (!reminders.length && allDay.checked && cat.value === 'birthday') reminders.push(-540);
        drawTimes(); drawReminders();
      });
      drawTimes();

      // Repeat.
      const r = e.repeat ? clone(e.repeat) : null;
      const freq = el('select', { id: 'cal-e-freq', 'aria-label': 'Repeats' }, ...[['', 'Does not repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']].map(([v, t]) => el('option', { value: v, text: t })));
      freq.value = r ? r.freq : '';
      const repeatBox = el('div', { class: 'cal-repeat', id: 'cal-e-repeat' });
      const rs = { interval: r ? r.interval : 1, days: r ? [...r.days] : [], monthMode: r ? r.monthMode : 'day', until: r ? r.until : null, count: r ? r.count : null };
      const drawRepeat = () => {
        if (!freq.value) { repeatBox.replaceChildren(); return; }
        const unit = { daily: ['day', 'days'], weekly: ['week', 'weeks'], monthly: ['month', 'months'], yearly: ['year', 'years'] }[freq.value];
        const interval = el('input', { type: 'number', id: 'cal-e-interval', min: '1', max: '999', value: String(rs.interval), class: 'cal-num', 'aria-label': 'Every how many' });
        interval.addEventListener('change', () => { rs.interval = Math.max(1, Math.min(999, Math.round(Number(interval.value) || 1))); });
        const kids = [el('div', { class: 'cal-inline' }, el('span', { text: 'Every' }), interval, el('span', { text: unit[1] + ' (1 = every ' + unit[0] + ')' }))];
        const sd = parse(startDay.value) || new Date();
        if (freq.value === 'weekly') {
          const names = weekdayNames();
          const order = weekStartsMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
          if (!rs.days.length) rs.days = [sd.getDay()];
          kids.push(el('div', { class: 'cal-inline cal-daypicks', id: 'cal-e-days' }, el('span', { text: 'On' }), ...order.map((d, i) => {
            const c = el('input', { type: 'checkbox', 'data-weekday': String(d), checked: rs.days.includes(d) || undefined });
            c.addEventListener('change', () => { rs.days = c.checked ? [...new Set([...rs.days, d])] : rs.days.filter((x) => x !== d); });
            return el('label', { class: 'cal-daypick' }, c, el('span', { text: names[i] }));
          })));
        }
        if (freq.value === 'monthly') {
          const nth = Math.floor((sd.getDate() - 1) / 7) + 1;
          const wd = fmt(sd, { weekday: 'long' });
          const mm = el('select', { id: 'cal-e-monthmode', 'aria-label': 'Which day of the month' },
            el('option', { value: 'day', text: `on day ${sd.getDate()}` }), el('option', { value: 'weekday', text: `on the ${['first', 'second', 'third', 'fourth', 'fifth'][nth - 1]} ${wd}` }), el('option', { value: 'last', text: `on the last ${wd}` }));
          mm.value = rs.monthMode;
          mm.addEventListener('change', () => { rs.monthMode = mm.value; });
          kids.push(el('div', { class: 'cal-inline' }, mm));
        }
        const ends = el('select', { id: 'cal-e-ends', 'aria-label': 'Ends' }, el('option', { value: 'never', text: 'for ever' }), el('option', { value: 'until', text: 'until' }), el('option', { value: 'count', text: 'this many times' }));
        ends.value = rs.until ? 'until' : rs.count ? 'count' : 'never';
        const until = el('input', { type: 'date', id: 'cal-e-until', value: rs.until || dayKey(addDays(sd, 90)), 'aria-label': 'Until', hidden: ends.value !== 'until' || undefined });
        const count = el('input', { type: 'number', id: 'cal-e-count', min: '1', max: '10000', value: String(rs.count || 10), class: 'cal-num', 'aria-label': 'How many times', hidden: ends.value !== 'count' || undefined });
        const apply = () => { until.hidden = ends.value !== 'until'; count.hidden = ends.value !== 'count'; rs.until = ends.value === 'until' ? until.value : null; rs.count = ends.value === 'count' ? Math.max(1, Math.round(Number(count.value) || 1)) : null; };
        [ends, until, count].forEach((x) => x.addEventListener('change', apply));
        kids.push(el('div', { class: 'cal-inline' }, el('span', { text: 'Repeats' }), ends, until, count));
        repeatBox.replaceChildren(...kids);
      };
      freq.addEventListener('change', () => { rs.days = []; drawRepeat(); });
      drawRepeat();

      // Reminders.
      const reminders = [...e.reminders];
      const remBox = el('div', { class: 'cal-reminders', id: 'cal-e-reminders' });
      const remText = (m) => (allDay.checked ? ALLDAY_REMINDERS : TIMED_REMINDERS).find(([v]) => v === m)?.[1]
        || (m < 0 ? `On the day at ${pad(Math.floor(-m / 60))}:${pad(-m % 60)}` : m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'} before` : m % 60 === 0 ? `${m / 60} hours before` : `${m} minutes before`);
      const drawReminders = () => {
        const add = el('select', { id: 'cal-e-addreminder', 'aria-label': 'Add a reminder' }, el('option', { value: '', text: '＋ Add a reminder…' }),
          ...(allDay.checked ? ALLDAY_REMINDERS : TIMED_REMINDERS).filter(([v]) => !reminders.includes(v)).map(([v, t]) => el('option', { value: String(v), text: t })));
        add.addEventListener('change', () => { if (add.value === '') return; if (reminders.length < 8) reminders.push(Number(add.value)); reminders.sort((a, b) => a - b); drawReminders(); });
        remBox.replaceChildren(...reminders.map((m) => el('span', { class: 'cal-remchip', 'data-minutes': String(m) }, `🔔 ${remText(m)}`,
          el('button', { class: 'icon-btn', 'aria-label': 'Remove this reminder', onclick: (ev) => { ev.preventDefault(); reminders.splice(reminders.indexOf(m), 1); drawReminders(); } }, '✕'))), add);
      };
      drawReminders();

      const since = el('input', { type: 'number', id: 'cal-e-since', min: '1', max: '9999', value: e.sinceYear ? String(e.sinceYear) : '', class: 'cal-num', placeholder: 'year', 'aria-label': 'Since the year (for the age)' });
      const sinceRow = row('Born / since', since, el('small', { class: 'pref-hint', text: 'for the age ("turns 30")' }));
      const game = el('input', { type: 'text', id: 'cal-e-game', value: e.game || '', maxlength: '120', placeholder: 'game or category', 'aria-label': 'Game or category' });
      const platform = el('input', { type: 'text', id: 'cal-e-platform', value: e.platform || '', maxlength: '60', placeholder: 'Twitch, YouTube…', 'aria-label': 'Platform' });
      const streamRow = row('Game, platform', game, platform);
      // The note this entry belongs to (a note in the Vault): open it, or link the note on screen.
      const noteBox = el('div', { class: 'cal-inline', id: 'cal-e-note' });
      const drawNote = () => noteBox.replaceChildren(
        e.note ? el('button', { class: 'utility-btn', id: 'cal-e-note-open', title: e.note, onclick: (ev) => { ev.preventDefault(); req('vault.openFile', { path: e.note }).then(() => { closeModal(); close(); }).catch(hooks.showError); } }, `📄 ${e.note.split('/').pop().replace(/\.md$/i, '')}`) : el('small', { class: 'pref-hint', text: 'none' }),
        el('button', { class: 'utility-btn', id: 'cal-e-note-link', title: 'Link the note open on screen (from your Vault)', onclick: async (ev) => {
          ev.preventDefault();
          try { const r = await req('cal.note.current'); e.note = r.path; drawNote(); } catch (err) { status.textContent = err && err.message ? err.message : String(err); }
        } }, 'Link the open note'),
        e.note ? el('button', { class: 'icon-btn', id: 'cal-e-note-clear', 'aria-label': 'Unlink the note', title: 'Unlink the note', onclick: (ev) => { ev.preventDefault(); e.note = null; drawNote(); } }, '✕') : null);
      drawNote();
      const notes = el('textarea', { id: 'cal-e-notes', rows: '3', maxlength: '10000', placeholder: 'Notes', 'aria-label': 'Notes' });
      notes.value = e.notes || '';
      const kindRows = () => {
        sinceRow.hidden = !['birthday', 'important', 'holiday'].includes(cat.value);
        streamRow.hidden = cat.value !== 'stream';
        if (!colorTouched) color.value = (CATEGORY[cat.value] || CATEGORY.other).color;
      };
      cat.addEventListener('change', () => {
        // A birthday: all day, every year, a reminder on the day.
        if (cat.value === 'birthday' && isNew) { allDay.checked = true; freq.value = 'yearly'; drawTimes(); drawRepeat(); if (!reminders.length) reminders.push(-540); drawReminders(); }
        kindRows();
      });
      kindRows();
      const status = el('p', { class: 'pref-hint cal-status', id: 'cal-e-status', 'aria-live': 'polite' });

      const collect = () => {
        const out = clone(e);
        out.title = title.value.trim();
        out.category = cat.value;
        out.color = colorTouched && color.value !== (CATEGORY[cat.value] || CATEGORY.other).color ? color.value : '';
        out.allDay = allDay.checked;
        out.start = out.allDay ? startDay.value : `${startDay.value}T${startTime.value || '09:00'}`;
        out.end = out.allDay ? endDay.value : `${endDay.value}T${endTime.value || '10:00'}`;
        out.repeat = freq.value ? { freq: freq.value, interval: rs.interval, days: freq.value === 'weekly' ? rs.days : [], monthMode: rs.monthMode, until: rs.until, count: rs.count } : null;
        out.reminders = reminders;
        out.sinceYear = since.value && !sinceRow.hidden ? Number(since.value) : null;
        out.game = !streamRow.hidden && game.value.trim() ? game.value.trim() : null;
        out.platform = !streamRow.hidden && platform.value.trim() ? platform.value.trim() : null;
        out.notes = notes.value;
        out.note = e.note || null;
        return out;
      };
      const save = async () => {
        if (!title.value.trim()) { status.textContent = 'Give it a title.'; title.focus(); return; }
        const out = collect();
        if (!out.allDay && parse(out.end) <= parse(out.start)) { status.textContent = 'It has to end after it starts.'; return; }
        if (out.allDay && parse(out.end) < parse(out.start)) { status.textContent = 'The last day can\'t be before the first.'; return; }
        let toSave = out;
        if (scope && scope.value === 'one') {
          // Only this day: the entry keeps its rule; this occurrence is moved (its new time and length).
          toSave = clone(entry);
          toSave.moved = (toSave.moved || []).filter((m) => m.date !== occurrenceDate).concat([{ date: occurrenceDate, start: out.start, end: out.end }]);
        }
        try {
          const r = await req('cal.save', { entry: toSave });
          entries = entries.filter((x) => x.id !== r.entry.id).concat([r.entry]);
          setEntries(entries);
          closeModal();
          await refresh();
          notice(isNew ? `“${r.entry.title}” added` : 'Saved', 1400);
        } catch (err) { status.textContent = err && err.message ? err.message : String(err); }
      };
      const skipDay = async () => {
        const toSave = clone(entry);
        toSave.skip = [...new Set([...(toSave.skip || []), occurrenceDate])];
        toSave.moved = (toSave.moved || []).filter((m) => m.date !== occurrenceDate);
        try { const r = await req('cal.save', { entry: toSave }); setEntries(entries.filter((x) => x.id !== r.entry.id).concat([r.entry])); closeModal(); await refresh(); notice('That day is left out', 1400); }
        catch (err) { hooks.showError(err); }
      };
      title.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } });
      s.append(NoorUI.head(isNew ? 'New entry' : 'Entry', closeModal),
        el('div', { class: 'modal-body cal-editor' },
          title,
          ...(scope ? [row('Change', scope)] : []),
          el('div', { class: 'cal-inline' }, cat, color, el('label', { class: 'cal-inline' }, allDay, el('span', { text: 'All day' }))),
          times,
          row('Repeats', freq), repeatBox,
          row('Reminders', remBox),
          sinceRow, streamRow,
          row('Note', noteBox),
          notes, status),
        el('div', { class: 'modal-foot' },
          el('div', { class: 'modal-buttons cal-editbuttons' },
            ...(isNew ? [] : [el('button', { class: 'action danger', id: 'cal-e-delete', onclick: async () => { closeModal(); await deleteEntry(entry); } }, '🗑 Delete')]),
            ...(repeating ? [el('button', { class: 'action', id: 'cal-e-skip', title: 'Leave this one day out (the others stay)', onclick: skipDay }, 'Skip this day')] : []),
            el('span', { class: 'cal-space' }),
            el('button', { class: 'action', onclick: () => closeModal() }, 'Cancel'),
            el('button', { class: 'action primary', id: 'cal-e-save', onclick: save }, isNew ? 'Add' : 'Save'))));
    });
  }

  async function deleteEntry(entry) {
    try {
      const r = await req('cal.delete', { id: entry.id });
      if (!r.entry) return;
      lastDeleted = r.entry;
      setEntries(entries.filter((x) => x.id !== entry.id));
      await refresh();
      showUndo(`“${entry.title}” deleted`);
    } catch (err) { hooks.showError(err); }
  }

  function showUndo(text) {
    const old = $('#cal-undo');
    if (old) old.remove();
    const bar = el('div', { class: 'cal-undo', id: 'cal-undo', role: 'status' }, el('span', { text }),
      el('button', { class: 'utility-btn', onclick: undoDelete }, 'Undo (Ctrl+Z)'));
    $('#calendar').append(bar);
    setTimeout(() => { if (bar.isConnected) bar.remove(); }, 8000);
  }

  async function undoDelete() {
    if (!lastDeleted) return;
    const e = lastDeleted;
    lastDeleted = null;
    const bar = $('#cal-undo'); if (bar) bar.remove();
    try { const r = await req('cal.save', { entry: e }); setEntries(entries.concat([r.entry])); await refresh(); notice(`“${e.title}” is back`, 1400); }
    catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- import / export

  async function importIcs() {
    try {
      const r = await req('cal.import');
      if (!r || r.cancelled) return;
      if (r.entries) setEntries(r.entries);
      await refresh();
      const msg = r.added ? `Imported ${r.added} entr${r.added === 1 ? 'y' : 'ies'} from ${r.file}.` : `Nothing to import in ${r.file}.`;
      if (r.notes && r.notes.length) {
        NoorUI.choose('Calendar imported', [msg, 'Imported as near as possible:', ...r.notes.slice(0, 12), ...(r.notes.length > 12 ? [`…and ${r.notes.length - 12} more.`] : [])], [{ label: 'OK', value: true, primary: true }]);
      } else notice(msg, 2400);
    } catch (err) { hooks.showError(err); }
  }

  async function exportIcs() {
    try {
      const r = await req('cal.export', { name: 'NoorMD calendar' });
      if (r && !r.cancelled) notice(`Exported ${r.count} entr${r.count === 1 ? 'y' : 'ies'}`, 2000);
    } catch (err) { hooks.showError(err); }
  }

  // ---------------------------------------------------------------- reminder cards (in the app, whatever is open)

  function showCard(r) {
    if (cards.has(r.key)) return;
    let stack = $('#cal-cards');
    if (!stack) { stack = el('div', { class: 'cal-cards', id: 'cal-cards', 'aria-live': 'polite' }); document.body.append(stack); }
    const o = { ...r.occurrence, s: parse(r.occurrence.start), e: parse(r.occurrence.end) };
    const c = CATEGORY[r.category] || CATEGORY.other;
    const title = `${r.title}${r.age != null && r.category === 'birthday' ? ` (${r.age})` : ''}`;
    const card = el('div', { class: 'cal-card', 'data-key': r.key, role: 'alert', style: `--c:${c.color}` },
      el('strong', { text: `${c.icon} ${title}` }),
      el('span', { class: 'cal-cardwhen', text: relative(o) }),
      el('div', { class: 'cal-cardbuttons' },
        el('button', { class: 'utility-btn', onclick: () => { dropCard(r.key); req('cal.dismiss', { key: r.key }).catch(() => {}); open().then(() => { cursor = selected = startOfDay(o.s); refresh().then(() => editEntry(byId.get(r.entryId), r.occurrence.date)); }); } }, 'Open'),
        el('select', { class: 'cal-snooze', 'aria-label': 'Snooze', onchange: (ev) => { const m = Number(ev.target.value); if (!m) return; dropCard(r.key); req('cal.snooze', { key: r.key, minutes: m }).catch(hooks.showError); } },
          el('option', { value: '', text: 'Snooze…' }), ...[[5, '5 minutes'], [15, '15 minutes'], [60, '1 hour'], [180, '3 hours'], [1440, 'Tomorrow']].map(([v, t]) => el('option', { value: String(v), text: t }))),
        el('button', { class: 'utility-btn', onclick: () => { dropCard(r.key); req('cal.dismiss', { key: r.key }).catch(() => {}); } }, 'Dismiss')));
    cards.set(r.key, card);
    stack.append(card);
  }

  function dropCard(key) {
    const card = cards.get(key);
    if (card) { card.remove(); cards.delete(key); }
  }

  return {
    init, open, close, toggle, isOpen,
    _state: () => ({ view, cursor: dayKey(cursor), selected: dayKey(selected), entries: clone(entries), occurrences: occurrences.map((o) => ({ entryId: o.entryId, date: o.date, start: o.start, end: o.end, allDay: o.allDay, age: o.age })), cards: [...cards.keys()], search, lastDeleted: lastDeleted ? lastDeleted.id : null, weekStartsMonday }),
  };
})();
