# Creator's Bench: engineering plan

This plan responds to *NoorMD 2.0 — Creator's Bench*. It covers what I checked in the
existing app, the decisions I made, the conflicts I found, and what ships in which phase.

## 1. What the current app gives us

- **The page is never reloaded during normal use.** Opening, saving and switching documents
  are all done with messages, so anything the page plays keeps playing across document
  changes. This is the key enabler for the persistent mini-player.
- **The host serves every page request** through `WebResourceRequested` on
  `https://noormd.local/`. Media can use the same route. No local web server or open port is
  needed.
- **File safety helpers already exist:** atomic writes, a backups folder, the safe-name logic
  in `DocumentFile.SafeFileName`, path checks in `AssetResolver`, and the bridge validation
  rules.
- **One document per window.** Tabs are designed in `TABS_DESIGN.md` but not built, and the
  music features do not depend on them.

## 2. Decisions

| Topic | Decision | Why |
|---|---|---|
| Playback engine | **Chromium's `<audio>` element inside the existing WebView2** | Plays MP3, FLAC, WAV, OGG/Opus and AAC/M4A with no extra native binaries; LibVLC would add ~100 MB and LGPL plugin obligations. Seeking uses HTTP Range requests that NoorMD answers itself. The Media Session API exposes title, artist and media-key handlers. The same player runs in automated Chromium tests. **Revisit for NoorVideo:** Chromium does not handle MKV/ASS well, so LibVLCSharp may be justified there. |
| Tags | **TagLib#** (`TagLibSharp` 2.3.0, LGPL-2.1, managed) | A mature ID3v2/v1, FLAC, Vorbis and MP4 tag reader and writer. It ships as a separate DLL, which satisfies LGPL, and the license text is shipped. It is pure .NET, so tag writing is unit-tested on real files. |
| Library index | **SQLite** via `Microsoft.Data.Sqlite` (MIT) and SQLitePCLRaw (Apache-2.0) | Standard choice and well tested. It keeps 20,000+ tracks searchable without loading everything into memory. |
| Track identity | Internal integer `id`, plus a **fingerprint** (file size + SHA-256 of 64 KB from the middle of the file), recalculated after every NoorMD edit | Ratings, playlists, queue and triage refer to the `id`, never to a path. A rename made in NoorMD updates the path in place. A file moved outside NoorMD is matched by fingerprint on rescan and relinked, not duplicated. A file that was both moved and re-tagged by another program can't be matched; it shows up as *missing* plus a new track, and nothing is lost. |
| Where code lives | New `src/NoorMD.Media` library (net10.0): `MusicLibrary`, `LibraryScanner`, `TrackMetadata`, `SafeRename`, `EditJournal`, `Playlists`/`M3u`, `RangeRequest` | Clear module boundary with no WPF dependency, so it can be unit-tested. The WPF host only adds bridge commands and media serving. |
| Threading | Scanning runs on a background task with batched transactions, cancellation and progress events | Writing must never be blocked by indexing. |
| Opt-in | Nothing music-related starts until you open NoorMusic. It can be hidden completely (Preferences → *Show NoorMusic*). | Required: "disableable and not launched unnecessarily". |

## 3. Safety rules for file operations (enforced in code and tests)

1. Adding a folder never moves, renames or rewrites anything. It only reads.
2. Tags and file names change only after an explicit **Save**. There is no auto-rename.
3. **Renames:**
   - Illegal characters, reserved names, over-long paths and collisions are rejected
     *before* anything is touched.
   - Case-only renames go through a temporary name.
   - An existing file is never overwritten.
4. **Writing tags to the track that is playing:** the player releases the file first, the tag
   is written and verified, then playback resumes at the same position. This is the
   "briefly reopen the stream" option from the proposal. The file served to the player is
   opened with `FileShare.ReadWrite | Delete`, so a rename never fails because the file is
   playing.
5. **Undo:** every edit is written to a journal before it is applied: old tags, old path, new
   tags, new path. *Undo last track edit* restores both. Undo refuses, and says why, when the
   file has changed since the edit.
6. Read-only, locked, missing and malformed files produce a clear message, and the operation
   is not applied. A missing file is marked *missing*, never deleted from the library.

## 4. Conflicts and how they're resolved

| Conflict | Resolution |
|---|---|
| Proposal's **F2** for Edit current track | F2 is unused today, so I adopted it. It works even while typing, because F2 never inserts text. |
| Triage keys while writing | **Alt+1 / Alt+2 / Alt+3 / Alt+4** = Favorite / Keep / Maybe / Skip. In NoorMusic list, plain **1–4** also work. Alt+digit never types text. |
| Transport keys | **Ctrl+Alt+Space** play/pause, **Ctrl+Alt+→ / ←** next/previous, plus media keys through the Media Session API. Ctrl+Alt+digits stay free for the mode shortcuts proposed in TABS_DESIGN.md. AltGr is already excluded. |
| Screen space | NoorMusic is a resizable right-hand panel (Ctrl+Shift+M). The mini-player is a slim bar under the editor and can be hidden. Focus mode hides both but keeps the music playing. |
| WebView2 renderer crash | Playback stops with the page. Queue, track and position are saved every few seconds, so *Resume* puts you back where you were. |
| Settings compatibility | Older versions ignore the new keys, as before. The music index lives in its own `%LOCALAPPDATA%\NoorMD\Music\library.db`. |

## 5. Phases

| Phase | Contents | Status in this delivery |
|---|---|---|
| **A: NoorMusic MVP** (2.0.0-preview.1) | Folders (recursive), background index, search/filter/sort, virtualized list, play/pause/seek/volume, queue, shuffle/repeat, persistent mini-player and Now Playing, **Edit current track** (tags and/or filename, Save, Save & Next, Cancel), triage, favorites, basic playlists and `.m3u8` import/export, session resume, single-edit undo | **Implemented** |
| B: Batch Organizer | Multi-select batch tags, rename templates, before → after preview with collision checks, dry run, journal-based batch undo | Next. The journal, SafeRename and preview building blocks are already shared with A. |
| C: Music polish | EQ and presets (WebAudio), loudness normalization, richer smart collections | Later |
| D: NoorVideo | Local video library, subtitles, resume, detachable always-on-top window, timestamped notes | Later. Engine re-evaluated first. |
| Streaming services, DRM | **Out of scope** | No work planned |

The Suno metadata import and AI-suggested titles need their own approved design and real
export files, as the proposal requires. They are not implemented.
