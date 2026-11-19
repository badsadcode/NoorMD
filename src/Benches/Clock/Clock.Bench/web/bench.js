// The Clock's web module: world clocks (main view), a small clock and a stopwatch (panels you can dock in any bench).
const css = new URL('bench.css', import.meta.url).href;

// The stopwatch is one for the whole bench, however many places (and windows) its panel is shown in. Its state is in
// wall-clock time, so a floating window (with its own copy of this module) can take it over through an event.
const watch = { running: false, since: 0, banked: 0 };
const elapsed = () => watch.banked + (watch.running ? Date.now() - watch.since : 0);
const snapshot = () => ({ running: watch.running, since: watch.since, banked: watch.banked });
const adopt = (st) => { if (st && typeof st === 'object' && 'running' in st) Object.assign(watch, { running: !!st.running, since: Number(st.since) || 0, banked: Number(st.banked) || 0 }); };
const fmtWatch = (ms) => { const t = Math.floor(ms / 10), cs = t % 100, s = Math.floor(t / 100) % 60, m = Math.floor(t / 6000); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`; };
const fmtTime = (zone, opts = {}) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', ...opts, timeZone: zone || undefined }).format(new Date());
const local = Intl.DateTimeFormat().resolvedOptions().timeZone;

function every(ms, fn) { fn(); const t = setInterval(fn, ms); return () => clearInterval(t); }
function toggle(ctx) { if (watch.running) { watch.banked = elapsed(); watch.running = false; } else { watch.since = Date.now(); watch.running = true; } ctx.emit('stopwatch', snapshot()); }
function reset(ctx) { watch.running = false; watch.banked = 0; ctx.emit('stopwatch', snapshot()); }
/** A stopwatch shown somewhere new asks for the current state; whoever has one answers. */
function answerAsks(ctx) { return ctx.on('stopwatch.ask', () => { if (watch.running || watch.banked) ctx.emit('stopwatch', snapshot()); }); }

export default {
  mount(el, ctx) {
    ctx.useStyle(css);
    let zones = ctx.restore('zones', ['UTC', 'America/New_York', 'Asia/Tokyo']);
    el.innerHTML = '<div class="ck-page"><div class="ck-big"></div><div class="ck-date nui-muted"></div><div class="ck-zones"></div><button class="nui-btn ck-add">＋ Add a time zone</button></div>';
    const big = el.querySelector('.ck-big'), date = el.querySelector('.ck-date'), list = el.querySelector('.ck-zones');
    const draw = () => {
      big.textContent = fmtTime(null, { second: '2-digit' });
      date.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()) + ` · ${local}`;
      list.replaceChildren(...zones.map((z) => { const card = document.createElement('div'); card.className = 'ck-zone'; card.innerHTML = `<span class="ck-zt"></span><span class="nui-muted ck-zn"></span><button class="nui-icon" title="Remove" aria-label="Remove ${z}">✕</button>`; card.querySelector('.ck-zt').textContent = fmtTime(z); card.querySelector('.ck-zn').textContent = z.replace(/_/g, ' '); card.querySelector('button').onclick = () => { zones = zones.filter((x) => x !== z); ctx.keep('zones', zones); draw(); }; return card; }));
    };
    const add = async () => {
      const all = await ctx.call('clock.zones');
      const sel = document.createElement('select'); sel.className = 'nui-select'; sel.setAttribute('aria-label', 'Time zone'); sel.style.width = '100%';
      for (const z of all.sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id))) { const o = document.createElement('option'); o.value = z.id; o.textContent = `${z.id.replace(/_/g, ' ')} (UTC${z.offset >= 0 ? '+' : '−'}${String(Math.floor(Math.abs(z.offset) / 60)).padStart(2, '0')}:${String(Math.abs(z.offset) % 60).padStart(2, '0')})`; sel.append(o); }
      const ok = await ctx.dialog('Add a time zone', sel, [{ label: 'Cancel', value: false }, { label: 'Add', value: true, primary: true }]);
      if (ok && !zones.includes(sel.value)) { zones = [...zones, sel.value]; ctx.keep('zones', zones); draw(); }
    };
    el.querySelector('.ck-add').onclick = add;
    const stop = every(1000, draw);
    const offAsk = answerAsks(ctx);
    ctx.setStatus(`${local} · ${zones.length} more time zone${zones.length === 1 ? '' : 's'}`);
    return { commands: { 'clock.add': add, 'clock.toggle': () => toggle(ctx), 'clock.reset': () => reset(ctx) }, unmount() { stop(); offAsk(); } };
  },
  panels: {
    now: {
      mount(el, ctx) {
        ctx.useStyle(css);
        el.innerHTML = '<div class="ck-mini"><div class="ck-mt"></div><div class="nui-muted ck-md"></div></div>';
        return { unmount: every(1000, () => { el.querySelector('.ck-mt').textContent = fmtTime(null, { second: '2-digit' }); el.querySelector('.ck-md').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date()); }) };
      },
    },
    stopwatch: {
      mount(el, ctx) {
        ctx.useStyle(css);
        el.innerHTML = '<div class="ck-watch"><div class="ck-wt">00:00.00</div><button class="nui-btn primary ck-go">Start</button><button class="nui-btn ck-reset">Reset</button></div>';
        const t = el.querySelector('.ck-wt'), go = el.querySelector('.ck-go');
        let raf = 0;
        const draw = (st) => { adopt(st); t.textContent = fmtWatch(elapsed()); go.textContent = watch.running ? 'Stop' : elapsed() ? 'Go on' : 'Start'; cancelAnimationFrame(raf); if (watch.running) raf = requestAnimationFrame(() => draw()); };
        go.onclick = () => toggle(ctx);
        el.querySelector('.ck-reset').onclick = () => reset(ctx);
        const off = ctx.on('stopwatch', draw), offAsk = answerAsks(ctx);
        draw();
        ctx.emit('stopwatch.ask');
        return { unmount() { off(); offAsk(); cancelAnimationFrame(raf); } };
      },
    },
  },
};
