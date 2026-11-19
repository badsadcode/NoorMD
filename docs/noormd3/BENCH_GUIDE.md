# Building a bench for NoorMD 3.0

A **bench** is one tab in NoorMD (Markdown, Vault, Music…). It's a .NET DLL that NoorMD loads at start. This guide
shows how to build one, using a **level generator** (maps for Doom 1/2, Quake 1/2, Unreal/UT) as the example. The
contract is small, and the benches in `src/Benches/` are working examples: `Sandbox` is the smallest, `Vault` and
`Music` the fullest.

Contract version: **1** (`Noor.Contracts.Contract.Version`).

## 1. The shape: two projects

Every bench is a pair, so the logic can be tested (and reused) without any interface:

```
src/Benches/Levels/
  Levels.Core/            the generator: no UI, no NoorMD types. Pure C#: input → map file.
    Levels.Core.csproj      net10.0, a class library
    Generators/             Doom (binary WAD / UDMF), Quake (.map, Valve 220), Quake 2, Unreal (.t3d)…
    Styles/                 "tech base", "castle", "cave", "hub and spokes"…
  Levels.Bench/           the bench: the manifest, commands, and its web page (packed into the DLL)
    Levels.Bench.csproj     references Noor.Contracts and Levels.Core; <EmbeddedResource Include="web\**" />
    LevelsBench.cs          the bench class
    web/bench.js            the page module (the view and its panels)
    web/bench.css
```

The DLL **must** be named `*.Bench.dll`. NoorMD loads every `*.Bench.dll` beside `NoorMD3.exe` and finds the classes
that implement `IBench` (public, not abstract, with a parameterless constructor).

The csproj (copy `Sandbox.Bench.csproj`):

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AssemblyName>Levels.Bench</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="..\..\..\Noor.Contracts\Noor.Contracts.csproj" />
    <ProjectReference Include="..\Levels.Core\Levels.Core.csproj" />
    <EmbeddedResource Include="web\**" />
  </ItemGroup>
</Project>
```

For now (stage 1), benches are built with the app: add the project to `NoorMD3.slnx` and a `ProjectReference` in
`src/NoorMD3/NoorMD3.csproj`, and it ships in the zip. Benches that install separately come later; the contract
stays the same.

## 2. The Python script: port the core to C#

NoorMD ships as one self-contained app, and most people don't have Python installed. NoorMD also doesn't start
other programs on its own: apps only run when the user adds them by name. So the generator belongs **in
Levels.Core, in C#**. The Python script is the reference while porting:

- Port it module by module and keep the same outputs. Give it a **seed**, so the same seed always makes the same
  map. Then the C# tests can compare against files the Python script made (golden files in the tests folder).
- Keep the core free of I/O except "write this map to this stream": `Generate(LevelSpec spec, int seed) →
  LevelModel`, then `DoomWadWriter.Write(model, stream)`, `QuakeMapWriter.Write(model, stream)`. The bench decides
  where files go (the user picks, in a dialog).
- Nothing over the network, and no reading files the user didn't pick.

## 3. The bench class (C#)

```csharp
using System.Text.Json;
using System.Text.Json.Nodes;
using Noor.Contracts;

namespace Levels.Bench;

public sealed class LevelsBench : BenchBase
{
    public override BenchManifest Manifest { get; } = new()
    {
        Id = "noor.levels",            // unique, lowercase, dot-separated; it's in every URL and setting
        Name = "Levels",
        Icon = "🗺",
        Description = "Generate maps for Doom, Quake and Unreal in many styles.",
        Version = "3.0.12",
        Density = "roomy",             // or "compact" for dense tool benches
        Menus =
        [
            // Menus called File, Edit, View, Tools or Help merge into the shell's own; others get their own place.
            new MenuSpec("File", [
                new MenuItemSpec("New level…", "levels.new", "Ctrl+N"),
                new MenuItemSpec("Export…", "levels.export", "Ctrl+E"),
            ]),
            new MenuSpec("Generate", [
                new MenuItemSpec("Generate again", "levels.regen", "F5"),
                new MenuItemSpec("A new seed", "levels.reseed"),
            ]),
        ],
        Panels =
        [
            new PanelSpec("settings", "Settings", "⚙", "left"),    // docks left, right or bottom; the user can move it
            new PanelSpec("stats", "Statistics", "∑", "right"),
        ],
        FileTypes = [".noorlevel"],    // files NoorMD hands this bench when dropped or opened with NoorMD
    };

    public LevelsBench()
    {
        Command("levels.generate", async (a, host, cancel) =>
        {
            var spec = LevelSpec.FromJson(a);                    // parse and check every value the page sends
            var model = await Task.Run(() => Generator.Generate(spec, spec.Seed, cancel), cancel);
            return Preview.ToJson(model);                        // what the page draws: rooms, lines, things
        });
        Command("levels.export", async (a, host, cancel) =>
        {
            var game = a.GetProperty("game").GetString();
            var path = await host.PickSaveFileAsync("Export the level", "level.wad", [new FileFilter("Doom WAD", [".wad"])]);
            if (path == null) return null;                       // the user cancelled
            // … generate, then write atomically (to a temporary file, then move it into place)
            return new JsonObject { ["path"] = path };
        });
    }
}
```

What `IBenchHost` (the `host` argument) gives a bench:

| | |
| --- | --- |
| `Post(name, payload)` | an event to the bench's page, in every window (progress, "done") |
| `DataFolder` | the bench's own folder for settings, caches and indexes |
| `PickFilesAsync`, `PickSaveFileAsync`, `PickFolderAsync` | the system dialogs. **The only way to get a path:** the page never sends one |
| `OpenFilesAsync(paths)` | hands files to the bench that opens them (e.g. a level's notes to Markdown) |
| `SavePageAsPdfAsync`, `Log` | printing a page to PDF; logging |

Rules:

- **Errors the user can read:** throw `BenchException("The map is too big for Doom (more than 32,767 lines).")`.
  The shell shows it as a toast.
- **Long work off the UI thread** (`Task.Run`), honouring the `CancellationToken`. Report progress with
  `host.Post("progress", new { done, total })`.
- **Never trust the page:** check every number's range, every string's length, every enum.
- **Streaming to the page** (big previews, sounds, pictures): implement `IBenchMedia`. The page then fetches
  `/media/noor.levels/<anything>`, and the bench decides what that path means. See `MusicBench.ServeMedia`.

## 4. The page (web/bench.js)

It's an ES module whose default export has the view (`mount`), the panels, and optionally `start`/`closed`:

```js
import { el, menu } from '/ui/js/noor-ui.js';    // the shared design system: el(), menus, dialogs, toasts

export default {
  mount(root, ctx) {
    ctx.useStyle(new URL('bench.css', import.meta.url).href);
    const canvas = el('canvas', { class: 'lv-map' });
    root.replaceChildren(canvas);
    async function generate() {
      const model = await ctx.call('levels.generate', { game: 'doom2', style: 'techbase', seed: 1234, size: 'medium' });
      draw(canvas, model);
      ctx.emit('generated', model.stats);         // the Statistics panel hears it
      ctx.setStatus(`${model.stats.rooms} rooms · seed 1234`);
    }
    generate();
    return {
      commands: { 'levels.regen': generate },     // menu items run these first (else the C# command of that id)
      unmount() { /* stop timers, remove listeners */ },
    };
  },
  panels: {
    stats: { mount(root, ctx) { const off = ctx.on('generated', (s) => { root.textContent = `${s.rooms} rooms`; }); return { unmount: off }; } },
  },
};
```

The `ctx` a bench gets:

| | |
| --- | --- |
| `call(cmd, args)` | runs a C# command, returns its result (a promise) |
| `on(name, fn)` / `emit(name, payload)` | the bench's own events. They reach its view and panels in every window (a floating panel, a bench window) |
| `keep(key, value)` / `restore(key, fallback)` | small state that comes back next time (seed, last style, zoom) |
| `setStatus(text)`, `setTitle(text)`, `toast(text, { error })`, `dialog(title, body, buttons)` | the status bar, the window title, messages, dialogs |
| `publish(topic, payload)` / `subscribe(topic, fn)` | topics shared with other benches |
| `callBench(id, cmd, args)`, `hasBench(id)`, `openBench(id)` | other benches' commands (e.g. save the level's notes to the Vault) |
| `setStatusWidget(node)`, `isMainWindow`, `start(ctx)` / `closed(ctx)` | for things that run without a view (see the Music bench's player) |

Look and feel:

- Use the theme tokens (`var(--accent)`, `var(--text)`, `var(--border)`…) and Noor.UI's classes (`nui-btn`,
  `nui-field`…). Then the bench follows all nine themes and both densities.
- Every action is a menu command with its shortcut shown. **No Ctrl+Alt shortcuts:** that's AltGr on Polish and
  many other keyboards, and the shell ignores it.
- A bench can be dragged into a window of its own, so nothing it needs may live outside its `ctx`.

## 5. Tests (every bench has them)

- **C# (xUnit, `tests/NoorMD3.Tests`)**: the core (seed → the same map; golden files from the Python script; the
  writers' output read back), and the bench's commands through `HandleAsync` with a small fake host (see
  `MusicTests.Host`). Add the bench to `FixtureTests`, so the web tests' copy of its manifest stays true.
- **Browser (Playwright, `tests/web3/<bench>.test.js`)**: the real shell page with a stand-in for the C# side. Copy
  `music.test.js` or `vault.test.js`. Add it to `scripts/publish-noormd3.sh` and `.github/workflows/build.yml`.

## 6. For the level generator in particular

- **The preview:** draw the map in 2D on a canvas (lines, sectors, things; for Quake, a top view of the brushes).
  A 3D view can come later. Send a compact model to the page, not the map file itself.
- **Per game:** keep each format's limits in the core and report them clearly before writing ("Vanilla Doom: at
  most 32,767 linedefs; this map has 40,112. Try a smaller size, or Boom/UDMF").
- **Files out:** WAD (binary or UDMF), `.map` (Quake 1/2, Valve 220), `.t3d` (Unreal/UT). Write atomically. Never
  overwrite without the system dialog's own "replace?" question.
- **Its own document:** a `.noorlevel` file (JSON: game, style, seed, settings), so a level can be saved, reopened
  and regenerated exactly. List the extension in `FileTypes`, and handle `Contract.OpenCommand` ("shell.open") to
  open dropped files.
- **Later, Send to:** once the exchange arrives, a level can go to Gallery (its picture) or the Vault (its notes).
