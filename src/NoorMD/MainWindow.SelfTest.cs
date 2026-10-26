using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using NoorMD.Core;
using NoorMD.Core.Export;
using NoorMD.Core.Settings;

namespace NoorMD;

/// <summary>
/// End-to-end smoke test of the real app (WPF + WebView2 + editor), used by CI on Windows:
///   NoorMD.exe --self-test &lt;output folder&gt;
/// It opens a generated CRLF/Polish/image document, edits, saves, switches modes and themes, exports a PDF,
/// captures a screenshot, writes result.json and exits with code 0 (all passed) or 1. It uses its own data
/// folders inside the output folder, so it never touches the user's settings, recovery drafts or files.
/// </summary>
public partial class MainWindow
{
    internal static string? SelfTestDir { get; set; }
    private readonly List<object> _selfTestResults = [];
    private bool _selfTestStarted;

    internal static string PrepareSelfTestDocument(string outDir)
    {
        var docDir = Path.Combine(outDir, "sample");
        Directory.CreateDirectory(Path.Combine(docDir, "img"));
        // 2x2 violet PNG
        File.WriteAllBytes(Path.Combine(docDir, "img", "pic.png"), Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPcOOs/AwMDEwMDAwMDAwAbVAJOcyj10QAAAABJRU5ErkJggg=="));
        var md = "# Zażółć gęślą jaźń\r\n\r\nPolish text: żółw, łódź, źdźbło.\r\n\r\n- one\r\n- two\r\n\r\n| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\n```csharp\r\nConsole.WriteLine(\"ą\");\r\n```\r\n\r\n![pic](img/pic.png)\r\n";
        var path = Path.Combine(docDir, "selftest.md");
        File.WriteAllBytes(path, new UTF8Encoding(false).GetBytes(md));
        return path;
    }

    private void StartSelfTestWatchdog()
    {
        if (SelfTestDir == null) return;
        var watchdog = new DispatcherTimer { Interval = TimeSpan.FromSeconds(90) };
        watchdog.Tick += (_, _) =>
        {
            watchdog.Stop();
            Check("app became ready within 90 s", _selfTestStarted);
            FinishSelfTest();
        };
        watchdog.Start();
    }

    private void Check(string name, bool ok, string? detail = null)
    {
        _selfTestResults.Add(new { name, ok, detail });
        Log.Info($"SELFTEST {(ok ? "PASS" : "FAIL")} {name} {detail}");
    }

    private async Task RunSelfTestAsync()
    {
        if (SelfTestDir == null || _selfTestStarted) return;
        _selfTestStarted = true;
        try
        {
            await Task.Delay(2500);
            var path = _session.Path;
            Check("startup document opened", path != null && path.EndsWith("selftest.md"), path);
            var st = await GetEditorStateAsync();
            Check("editor state readable", st != null);
            if (st == null || path == null) { FinishSelfTest(); return; }

            var originalBytes = File.ReadAllBytes(path);
            // Visual mode may normalize cosmetics (e.g. "- item" -> "* item"); the content must all be there.
            var mustContain = new[] { "# Zażółć gęślą jaźń", "żółw, łódź, źdźbło", "one", "two", "| 1 | 2 |", "```csharp\nConsole.WriteLine(\"ą\");\n```", "![pic](img/pic.png)" };
            var missing = mustContain.Where(m => !st.Markdown.Contains(m)).ToList();
            Check("loaded content is complete (diacritics, table, code fence, image)", missing.Count == 0, missing.Count == 0 ? null : "missing: " + string.Join(" | ", missing) + " in: " + st.Markdown);
            Check("not dirty after open", !st.Dirty);
            Check("opened in Visual mode", st.Mode == "wysiwyg", st.Mode);
            Check("bundled editor loaded offline", await Eval("!!(window.toastui && window.toastui.Editor && document.querySelector('.toastui-editor-defaultUI'))") == "true");
            Check("app stylesheet applied", (await Eval("getComputedStyle(document.body).overflow")).Contains("hidden"));
            Check("relative image served from document folder", await Eval("[...document.querySelectorAll('#editor img')].some(i => i.complete && i.naturalWidth === 2)") == "true");
            Check("window title shows file", Title.StartsWith("selftest.md"), Title);

            // Markdown source editor: exact original source after Visual, uniform font size, line numbers.
            await Eval("window.NoorMD.runCommand('view.markdown')");
            await Task.Delay(600);
            var source = await GetEditorStateAsync();
            Check("Markdown mode shows the exact original source (no Visual normalization)", source?.Markdown == File.ReadAllText(path).Replace("\r\n", "\n"));
            Check("source lines use one font size and line height",
                await Eval("(() => { const pm = document.querySelector('#editor .toastui-editor-md-container .ProseMirror'); const s = new Set(), l = new Set(); pm.querySelectorAll('*').forEach(n => { const c = getComputedStyle(n); s.add(c.fontSize); l.add(c.lineHeight); }); return s.size === 1 && l.size === 1; })()") == "true");
            Check("bundled source font is used", (await Eval("document.fonts.check('14px \"JetBrains Mono Variable\"') && getComputedStyle(document.querySelector('#editor .toastui-editor-md-container .ProseMirror')).fontFamily")).Contains("JetBrains"));
            await Capture("screenshot-source.png");
            await Eval("window.NoorMD.runCommand('view.visual')");
            await Task.Delay(600);
            Check("still clean after mode switches", (await GetEditorStateAsync()) is { Dirty: false });

            var noop = await SaveCoreAsync(saveAs: false, st);
            Check("Ctrl+S on an unedited file does not rewrite it", noop && File.ReadAllBytes(path).SequenceEqual(originalBytes));

            PushEvent("insert.text", new { markdown = " Dodano ąę." });
            await Task.Delay(1800);
            var edited = await GetEditorStateAsync();
            Check("edit marks document dirty", edited is { Dirty: true });
            Check("recovery draft written while dirty", _recovery.HasOwnDraft);
            Check("dirty marker in title", Title.StartsWith("● "), Title);

            var saved = edited != null && await SaveCoreAsync(saveAs: false, edited);
            var bytes = File.ReadAllBytes(path);
            var text = Encoding.UTF8.GetString(bytes);
            Check("save succeeded", saved);
            Check("saved file contains edit and diacritics", text.Contains("Dodano ąę.") && text.Contains("Zażółć gęślą jaźń"));
            Check("CRLF line endings preserved", text.Contains("\r\n") && !text.Replace("\r\n", "").Contains('\n'));
            Check("no BOM added", !(bytes.Length > 2 && bytes[0] == 0xEF));
            await Task.Delay(800);
            var afterSave = await GetEditorStateAsync();
            Check("clean after save", afterSave is { Dirty: false });
            Check("recovery draft removed after save", !_recovery.HasOwnDraft);

            await Eval("window.NoorMD.runCommand('view.split')");
            await Task.Delay(800);
            Check("split view shows two panes", await Eval("(() => { const a = document.querySelector('#editor .toastui-editor-md-container > .toastui-editor').getBoundingClientRect().width; const b = document.querySelector('#editor .toastui-editor-md-preview').getBoundingClientRect().width; return a > 200 && b > 200; })()") == "true");
            await Eval("window.NoorMD.runCommand('view.visual')");
            await Task.Delay(800);
            var back = await GetEditorStateAsync();
            Check("mode round trip keeps text", back != null && back.Markdown.TrimEnd() == afterSave?.Markdown.TrimEnd());

            await Eval("window.NoorMD.runCommand('view.focus')");
            await Task.Delay(600);
            Check("focus mode uses the window width", await Eval("document.querySelector('#editor-card').getBoundingClientRect().width > window.innerWidth - 60") == "true");
            await Capture("screenshot-focus-comfortable.png");
            const string textWidth = "(() => { const pm = document.querySelector('#editor .toastui-editor-ww-container .ProseMirror'); const cs = getComputedStyle(pm); return pm.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); })()";
            var comfortable = double.Parse(await Eval(textWidth), System.Globalization.CultureInfo.InvariantCulture);
            await Eval("window.NoorMD.runCommand('width.full')");
            await Task.Delay(600);
            var full = double.Parse(await Eval(textWidth), System.Globalization.CultureInfo.InvariantCulture);
            Check("Full width preset widens the text in Focus mode", full > comfortable + 100, $"{comfortable:0} -> {full:0} px");
            Check("width preset persisted", _settings.Prefs.LineWidth == "full", _settings.Prefs.LineWidth);
            await Capture("screenshot-focus-fullwidth.png");
            await Eval("window.NoorMD.runCommand('width.comfortable')");
            await Eval("window.NoorMD.runCommand('view.focus')");
            await Task.Delay(400);

            var top = await Eval("document.querySelector('#editor-card').getBoundingClientRect().top");
            await Eval("window.NoorMD.runCommand('layout.compact')");
            await Task.Delay(500);
            var compactTop = await Eval("document.querySelector('#editor-card').getBoundingClientRect().top");
            Check("compact layout gains vertical room", double.Parse(top, System.Globalization.CultureInfo.InvariantCulture) - double.Parse(compactTop, System.Globalization.CultureInfo.InvariantCulture) > 40, $"{top} -> {compactTop}");
            await Capture("screenshot-compact.png");
            await Eval("window.NoorMD.runCommand('layout.compact')");

            var before = (await GetEditorStateAsync())?.Markdown;
            await Eval("window.NoorMD.runCommand('spell.toggle')");
            await Task.Delay(300);
            Check("spellcheck off: attribute set, text unchanged, persisted",
                await Eval("[...document.querySelectorAll('#editor [contenteditable=\"true\"]')].every(n => n.getAttribute('spellcheck') === 'false')") == "true"
                && (await GetEditorStateAsync())?.Markdown == before && !_settings.Prefs.Spellcheck);
            await Eval("window.NoorMD.runCommand('spell.toggle')");

            await Eval("window.NoorMD.runCommand('theme.toggle')");
            await Task.Delay(800);
            Check("theme toggle persisted", _settings.Prefs.Theme == "light", _settings.Prefs.Theme);
            await Capture("screenshot-light.png");
            await Eval("window.NoorMD.runCommand('theme.toggle')");
            await Task.Delay(600);
            await Capture("screenshot-dark.png");

            var body = JsonSerializer.Deserialize<string>(await Eval("NoorMarkdown.renderSafe('# T\\n\\n<img src=x onerror=alert(1)><script>alert(2)</script>')")) ?? "";
            var html = HtmlExport.Build("T", body);
            Check("HTML export is sanitized", !html.Contains("onerror") && !html.Contains("<script"), body);

            await RunMusicSelfTestAsync();

            await Eval("document.querySelector('#print-root').innerHTML = NoorMarkdown.renderSafe(NoorMD.getState().markdown)");
            var pdf = Path.Combine(SelfTestDir, "export.pdf");
            var ok = await Core.PrintToPdfAsync(pdf);
            Check("PDF export", ok && File.Exists(pdf) && new FileInfo(pdf).Length > 1000, File.Exists(pdf) ? new FileInfo(pdf).Length + " bytes" : null);
        }
        catch (Exception ex)
        {
            Check("self-test ran without exceptions", false, ex.ToString());
        }
        FinishSelfTest();
    }

    private async Task<string> Eval(string script) => await Core.ExecuteScriptAsync(script);

    /// <summary>Creator's Bench on real WebView2: index, play through NoorMD's range handler, rename and
    /// re-tag while playing, resume. Uses audio files CI copies into &lt;out&gt;/music (skipped if absent).</summary>
    private async Task RunMusicSelfTestAsync()
    {
        var musicDir = Path.Combine(SelfTestDir!, "music");
        if (!Directory.Exists(musicDir) || !Directory.EnumerateFiles(musicDir).Any()) { Check("music self-test (no fixtures provided — skipped)", true); return; }
        var folder = Music.AddFolder(musicDir);
        var scan = await Task.Run(() => Music.ScanFolder(folder));
        Check("music folder indexed", scan.Added >= 1 && scan.Errors == 0, $"{scan.Added} added");
        var ids = Music.QueryIds(new NoorMD.Media.LibraryQuery(Sort: "filename"));
        var mp3 = Music.GetMany(ids).First(t => t.Path.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase));
        await Eval($"window.NoorMusic._testPlay([{string.Join(',', ids)}], {ids.ToList().IndexOf(mp3.Id)}, true)");
        await Task.Delay(1800);
        var st = await Eval("JSON.stringify(window.NoorMusic._state())");
        Check("WebView2 plays MP3 served by NoorMD (HTTP ranges)", await Eval("(() => { const s = window.NoorMusic._state(); return !s.paused && s.time > 0.3; })()") == "true", st);
        await Capture("screenshot-music.png");

        // Rename + retag the file while it is loaded in the player, *without* releasing it first: this proves
        // NoorMD keeps no handle open between range requests (the edit dialog additionally releases it).
        var edit = await Task.Run(() => Editor.Apply(mp3.Id, new NoorMD.Media.TagEdit { Title = "Żółta łódź" }, "Żółta łódź"));
        Check("rename + retag succeeds while the track was loaded in the player", edit.Ok && edit.Renamed && edit.TagsSaved, string.Join(" ", edit.Problems));
        Check("renamed file has the Polish name and title on disk", File.Exists(Path.Combine(musicDir, "Żółta łódź.mp3")) && NoorMD.Media.TagIO.Read(Path.Combine(musicDir, "Żółta łódź.mp3")).Title == "Żółta łódź");
        var undo = await Task.Run(() => Editor.Undo(edit.JournalId!.Value));
        Check("undo restores the original file name and tags", undo.Ok && File.Exists(mp3.Path), string.Join(" ", undo.Problems));
        await Eval("window.NoorMusic.toggle()");
    }

    private async Task Capture(string name)
    {
        try
        {
            await using var fs = File.Create(Path.Combine(SelfTestDir!, name));
            await Core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
        }
        catch (Exception ex) { Log.Error("Screenshot failed", ex); }
    }

    private void FinishSelfTest()
    {
        var passed = _selfTestResults.Count > 0 && _selfTestResults.All(r => (bool)r.GetType().GetProperty("ok")!.GetValue(r)!);
        var report = new
        {
            passed,
            os = Environment.OSVersion.VersionString,
            runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
            webView2 = Web.CoreWebView2?.Environment.BrowserVersionString,
            dpi = System.Windows.Media.VisualTreeHelper.GetDpi(this).PixelsPerInchX,
            checks = _selfTestResults,
        };
        File.WriteAllText(Path.Combine(SelfTestDir!, "result.json"), JsonSerializer.Serialize(report, SettingsStore.Json));
        _closeConfirmed = true;
        _session.Dirty = false;
        Application.Current.Shutdown(passed ? 0 : 1);
    }
}
