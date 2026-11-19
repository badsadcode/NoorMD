// The Sandbox's web module (contract v1): the shell imports it and calls mount() for the bench's main view and
// panels[id].mount() for its panels. Menu commands run here when the module has them, else on the C# side.
const css = new URL('bench.css', import.meta.url).href;
// The last count, so a Statistics panel shown later (or in another place) starts with it instead of zeros.
let last = { words: 0, characters: 0, sentences: 0, minutes: 0 };

export default {
  mount(el, ctx) {
    ctx.useStyle(css);
    const text = ctx.restore('text', '');
    el.innerHTML = `<div class="sb-page"><textarea class="sb-text" spellcheck="true" placeholder="Type anything. The C# side counts it, and the Statistics panel shows the result."></textarea></div>`;
    const area = el.querySelector('textarea');
    area.value = text;
    let timer = 0;
    const count = async () => {
      ctx.keep('text', area.value);
      const r = await ctx.call('sandbox.count', { text: area.value });
      last = r; ctx.emit('counted', r);
      ctx.setStatus(`${r.words} word${r.words === 1 ? '' : 's'} · ${r.minutes} min read`);
    };
    area.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(count, 250); });
    ctx.on('hello', (p) => ctx.toast(`The C# side waved at ${p.at} 👋`));
    count();
    return {
      focus: () => area.focus(),
      commands: {
        'sandbox.clear': () => { area.value = ''; count(); area.focus(); },
        'sandbox.sample': () => { area.value = 'NoorMD 3.0 is one home for every bench. Each bench is its own DLL. They talk through Send to!'; count(); },
        'sandbox.count': () => count().then(() => ctx.toast('Counted by the C# side.')),
        'sandbox.hello': async () => ctx.toast((await ctx.call('sandbox.hello')).message),
      },
      unmount() { clearTimeout(timer); },
    };
  },
  panels: {
    stats: {
      mount(el, ctx) {
        el.innerHTML = '<div class="nui-list sb-stats"></div>';
        const list = el.firstChild;
        const show = (r) => { list.innerHTML = [['Words', r.words], ['Characters', r.characters], ['Sentences', r.sentences], ['Reading time', `${r.minutes} min`]].map(([k, v]) => `<div class="nui-row"><span>${k}</span><span class="nui-muted">${v}</span></div>`).join(''); };
        show(last);
        const off = ctx.on('counted', show);
        return { unmount: off };
      },
    },
    about: {
      mount(el) {
        el.innerHTML = '<p class="nui-muted sb-about">The Sandbox proves the bench contract: its web files come out of <b>Sandbox.Bench.dll</b>, its menu and panels from its manifest, and the counting runs in C#. It goes away when the real benches arrive.</p>';
      },
    },
  },
};
