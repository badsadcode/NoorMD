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

            var expected = File.ReadAllText(path).Replace("\r\n", "\n");
            Check("loaded text matches file", st.Markdown.TrimEnd() == expected.TrimEnd(), st.Markdown.Length + " chars");
            Check("not dirty after open", !st.Dirty);
            Check("opened in Visual mode", st.Mode == "wysiwyg", st.Mode);
            Check("bundled editor loaded offline", await Eval("!!(window.toastui && window.toastui.Editor && document.querySelector('.toastui-editor-defaultUI'))") == "true");
            Check("app stylesheet applied", (await Eval("getComputedStyle(document.body).overflow")).Contains("hidden"));
            Check("relative image served from document folder", await Eval("[...document.querySelectorAll('#editor img')].some(i => i.complete && i.naturalWidth === 2)") == "true");
            Check("window title shows file", Title.StartsWith("selftest.md"), Title);

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
            await Capture("screenshot-focus.png");
            await Eval("window.NoorMD.runCommand('view.focus')");

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
