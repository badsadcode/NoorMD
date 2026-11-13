# Bench audit

Made by `node tests/web/audit.js` against the mock host. *Unnamed*: controls with no label, tooltip or text a screen reader (or a new user) could go by. *Symbol only*: buttons showing only a symbol or emoji with no tooltip. *Menus*: the bench's own menu bar in focus mode (F11).

| Bench | Controls | Unnamed | Symbol only | Menus in focus mode | Page errors |
| --- | --- | --- | --- | --- | --- |
| NoorMesh | 53 | 0 | 0 | File, Edit, Add, Mesh, Object, View | 0 |
| NoorForge | 86 | 0 | 0 | File, Edit, Layer, Paint, Bake, View, Help | 0 |
| NoorMaterial | 166 | 0 | 0 | File, Edit, Material, Layer, View, Help | 0 |
| NoorForm | 69 | 0 | 0 | File, Edit, Generate, View, Help | 0 |
| NoorSprite | 135 | 0 | 0 | File, Edit, Sprite, Layer, Frame, Palette, View, Tools, Help | 0 |
| NoorPhoto | 79 | 0 | 0 | File, Edit, Image, Layer, Select, Filter, View | 0 |
| NoorInk | 60 | 0 | 0 | File, Edit, Object, Path, Document, View | 0 |
| NoorSound | 33 | 0 | 0 | File, Edit, Sound, Play, View, Help | 0 |
| NoorSequencer | 74 | 0 | 0 | File, Edit, Song, Track, Pattern, Transport, View, Help | 0 |
| NoorVideo | 31 | 0 | 0 | **none** | 0 |
| NoorMusic | 31 | 1 | 1 | **none** | 0 |
| NoorRadio | 13 | 0 | 0 | **none** | 0 |
| NoorGallery | 9 | 0 | 0 | **none** | 0 |
| NoorCalendar | 21 | 0 | 0 | **none** | 0 |
| NoorStream | 40 | 0 | 0 | **none** | 0 |
| NoorHub | 8 | 0 | 0 | **none** | 0 |
| NoorVoice | 6 | 0 | 0 | **none** | 0 |

## NoorMusic

Unnamed (first 1 of 1):

- `button.chip "○ — 6"`

Symbol only, no tooltip (first 1 of 1):

- `button.chip "○ — 6"`
