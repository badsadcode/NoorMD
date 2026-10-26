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
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) via @fontsource-variable/jetbrains-mono | 5.2.8 | SIL Open Font License 1.1 | Markdown source editor font |
| [Microsoft.Web.WebView2](https://www.nuget.org/packages/Microsoft.Web.WebView2) | 1.0.4191.47 | Microsoft BSD-style license (see the NuGet package) | Hosting the editor in WPF |
| .NET runtime (portable package only) | 10.0 | MIT | Application runtime |

The editor bundle is built reproducibly by `web/vendor-build` (`npm install && npm run
build`), which pins every version listed above.

NoorMD does not use or include OpenAI, ChatGPT or other third-party trademarks or branding.
