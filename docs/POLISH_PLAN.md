# Polish plan: one bench at a time

After nineteen days of building in every direction at once (see the [devlog](../DEVLOG.md)), NoorMD has twenty
benches that each work and none that feel *finished*. From here on we polish **one bench at a time**, finish it, and
only then move to the next. New ideas for other benches don't get lost: they go into the
[ideas inbox](IDEAS_INBOX.md) and wait for their bench's turn.

## How a polish pass works

Every bench goes through the same steps, so "finished" means the same thing everywhere:

1. **Walk through it as a new user.** Open it fresh, make something real with it from start to export, and write
   down everything that is confusing, hidden, slow, ugly or broken. (Rescan hiding in a dialog is the kind of thing
   this finds.)
2. **Read its inbox.** Your notes for this bench from [IDEAS_INBOX.md](IDEAS_INBOX.md), plus the "not yet" and
   "later" items in its plan document.
3. **Agree on the list.** You pick what's in. Everything else stays in the inbox for a later pass. No new big
   features during a polish pass unless you say so: a polish pass makes what's there good.
4. **The checklist.** Every bench has to pass these:
   - **Findable:** every feature is in a menu (the bench's own menus in focus mode, or a right-click menu), with
     its shortcut shown, and a tooltip on every button.
   - **Consistent:** it works like the other benches (undo/redo, save/open/export, right-click, focus mode,
     layout memory, the same words for the same things).
   - **Safe:** nothing is lost (undo for everything, autosave or recovery where it matters, clear "unsaved" state).
   - **Clear:** error messages say what happened and what to do; empty states say how to start.
   - **Fast enough:** no freezes on big files; long jobs show progress and can be cancelled.
   - **Translated:** Polish, German, French and Spanish complete.
   - **Documented:** the README section and the bench's plan document say what it does *now*; a short "how to"
     for the first five minutes.
   - **Tested:** every fix has a test; the full suite is green.
5. **Release it, you try it, and then it's done.** It gets a ✅ in the table below and a devlog entry.

## The order (a suggestion: reorder freely)

The game-development pipeline comes first, because that's where your work is going and because NoorArchitect
and the spaceship generator will build on it (they export GLB for the same engines).

| # | Bench | Why here | Known items to start from |
| --- | --- | --- | --- |
| 0 | **Groundwork** (small) | Things every pass needs | README (NoorMesh still says "planned"; build sizes), the CI script that never reports back, this plan and the inbox, a shared bench checklist test where possible |
| 1 | **NoorMesh** | The newest and biggest; Blender users expect a lot; the hub of the 3D pipeline | Right-click select (needs the right-click menus designed first), the "not yet" lists in [NOORMESH_PLAN.md](NOORMESH_PLAN.md) (knife and bevel details, cursor rotation, UV pinning and stitching…), performance on dense meshes |
| 2 | **NoorForge** | Textures what NoorMesh and NoorForm make | Live NoorMaterial materials fed by the baked maps, your own materials in the material list, the ideas in [NOORFORGE_PLAN.md](NOORFORGE_PLAN.md) |
| 3 | **NoorMaterial** | Feeds NoorForge and NoorForm | The ideas list in [TEXTURE_BENCH_PLAN.md](TEXTURE_BENCH_PLAN.md), your saved materials in NoorForge |
| 4 | **NoorForm** | Trees, rocks and plants: lots of new work this month | Plant preset review in an engine (cards at full resolution), the stage 1 leftovers in [ASSET_BENCH_PLAN.md](ASSET_BENCH_PLAN.md) |
| — | *→ NoorArchitect and the spaceship generator* | New benches start on a polished pipeline | Your handoffs |
| 5 | **NoorSprite** | The most complete 2D bench; shares ideas with NoorPhoto and NoorInk | — |
| 6 | **NoorPhoto** | | — |
| 7 | **NoorInk** | | — |
| 8 | **NoorSound** (with Voice Forge) | | — |
| 9 | **NoorSequencer** | | "Later" list in [SEQUENCER_PLAN.md](SEQUENCER_PLAN.md) |
| 10 | **NoorVideo** | | Rescan where it can be seen, the subtitle editor, pop-out sharing the picture/sound settings (see [ROADMAP.md](ROADMAP.md)) |
| 11 | **NoorMusic** and **NoorRadio** | | — |
| 12 | **NoorGallery** | | — |
| 13 | **NoorMD itself** (editor, tabs, Vaults) | The home everything lives in; already the most used and tested | — |
| 14 | **NoorCalendar**, **NoorStream**, **NoorHub**, **NoorVoice**, **NoorSketch** | The small ones, one pass together | — |

If you write in NoorMD every day, it's worth moving it up: an annoyance you hit daily is worth more than one you
hit monthly.

## Progress

| Bench | Status |
| --- | --- |
| Groundwork | ⏳ next |
| NoorMesh | — |
| NoorForge | — |
| NoorMaterial | — |
| NoorForm | — |
| NoorSprite | — |
| NoorPhoto | — |
| NoorInk | — |
| NoorSound | — |
| NoorSequencer | — |
| NoorVideo | — |
| NoorMusic, NoorRadio | — |
| NoorGallery | — |
| NoorMD | — |
| The small ones | — |

## House rules

- **One bench at a time.** A bug that blocks you in another bench gets fixed on the spot; everything else goes in
  the inbox.
- **Small releases.** A polish pass can be several previews; each one is tested and sent as usual.
- **The devlog gets a line** when a bench is done (and when something funny happens, which it will).
