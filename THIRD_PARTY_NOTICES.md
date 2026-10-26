# Third-party notices

NoorMD Desktop bundles the following components. Their full license texts are in the
`licenses` folder next to `NoorMD.exe` and in `src/NoorMD/wwwroot/vendor/licenses/`.

| Component | Version | License | Used for |
|---|---|---|---|
| [TOAST UI Editor](https://github.com/nhn/tui.editor) (NHN Cloud Corp.) | 3.2.2 | MIT | Markdown and WYSIWYG editor engine |
| [ProseMirror](https://prosemirror.net) (model 1.19.0, view 1.30.1, state 1.4.2, transform 1.7.1, commands 1.5.0, history 1.3.0, inputrules 1.2.0, keymap 1.2.1) | see left | MIT | Editing core used by TOAST UI Editor |
| DOMPurify 2.5.9 (inside the TOAST UI Editor bundle) | 2.5.9 | Apache-2.0 or MPL-2.0 | Sanitizing the preview |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.2.6 | Apache-2.0 or MPL-2.0 | Sanitizing HTML export and print |
| [Inter](https://rsms.me/inter/) via @fontsource-variable/inter | 5.2.6 | SIL Open Font License 1.1 | Bundled UI and writing font |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) via @fontsource-variable/jetbrains-mono | 5.3.0 | SIL Open Font License 1.1 | Markdown source editor font |
| [TagLib#](https://github.com/mono/taglib-sharp) (`TagLibSharp`) | 2.3.0 | LGPL-2.1, used unmodified as a separate, replaceable DLL (`TagLibSharp.dll`) | Reading and writing audio tags (Creator's Bench) |
| [Microsoft.Data.Sqlite](https://github.com/dotnet/efcore) | 10.0.12 | MIT | Music library index |
| [SQLitePCLRaw](https://github.com/ericsink/SQLitePCL.raw) | 2.1.12 | Apache-2.0 | SQLite native binding |
| [SQLite](https://www.sqlite.org) | bundled with SQLitePCLRaw | Public domain | Database engine |
| [Microsoft.Web.WebView2](https://www.nuget.org/packages/Microsoft.Web.WebView2) | 1.0.4191.47 | Microsoft BSD-style license (see the NuGet package) | Hosting the editor in WPF |
| .NET runtime (portable package only) | 10.0 | MIT | Application runtime |

The editor bundle is built reproducibly by `web/vendor-build` (`npm install && npm run
build`), which pins every version listed above.

**LGPL note (TagLib#):** NoorMD uses TagLib# unmodified, through its public API, as the separate assembly
`TagLibSharp.dll` next to `NoorMD.exe`. You may replace that file with a compatible build of TagLib#. Its
source is available at https://github.com/mono/taglib-sharp, and the full license text ships in `licenses/`.

NoorMD does not use or include OpenAI, ChatGPT or other third-party trademarks or branding.
