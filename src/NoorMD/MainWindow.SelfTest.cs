using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using NoorMD.Core;
using NoorMD.Media;
using NoorMD.Core.Export;
using NoorMD.Core.Settings;
using NoorMD.Core.Vaults;

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
            var tab = ActiveSession!;
            var path = tab.Path;
            Check("startup document opened", path != null && path.EndsWith("selftest.md"), path);
            var st = await GetEditorStateAsync(tab.TabId);
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
            // The shown tab's editor is created after the page has told the host which tab it is; give the image time to load.
            var imageOk = false;
            for (int i = 0; i < 30 && !imageOk; i++)
            {
                imageOk = await Eval("[...document.querySelectorAll('#editor .doc-pane:not([hidden]) img')].some(i => i.complete && i.naturalWidth === 2)") == "true";
                if (!imageOk) await Task.Delay(200);
            }
            Check("relative image served from document folder", imageOk, await Eval("JSON.stringify([...document.querySelectorAll('#editor img')].map(i => [i.getAttribute('src'), i.complete, i.naturalWidth]))"));
            Check("menu bar and toolbar are built from the command registry",
                await Eval("document.querySelectorAll('#menubar .menu-title').length === 9 && !!document.querySelector('#toolbar [data-cmd-id=\"doc.save\"]')") == "true");
            Check("window title shows file", Title.StartsWith("selftest.md"), Title);

            // Markdown source editor: exact original source after Visual, uniform font size, line numbers.
            await Eval("window.NoorMD.runCommand('view.markdown')");
            await Task.Delay(600);
            var source = await GetEditorStateAsync(tab.TabId);
            Check("Markdown mode shows the exact original source (no Visual normalization)", source?.Markdown == File.ReadAllText(path).Replace("\r\n", "\n"));
            Check("source lines use one font size and line height",
                await Eval("(() => { const pm = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror'); const s = new Set(), l = new Set(); pm.querySelectorAll('*').forEach(n => { const c = getComputedStyle(n); s.add(c.fontSize); l.add(c.lineHeight); }); return s.size === 1 && l.size === 1; })()") == "true");
            Check("bundled source font is used", (await Eval("document.fonts.check('14px \"JetBrains Mono Variable\"') && getComputedStyle(document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container .ProseMirror')).fontFamily")).Contains("JetBrains"));
            await Capture("screenshot-source.png");
            await Eval("window.NoorMD.runCommand('view.visual')");
            await Task.Delay(600);
            Check("still clean after mode switches", (await GetEditorStateAsync(tab.TabId)) is { Dirty: false });

            var noop = await SaveCoreAsync(tab, saveAs: false, st);
            Check("Ctrl+S on an unedited file does not rewrite it", noop && File.ReadAllBytes(path).SequenceEqual(originalBytes));

            PushEvent("insert.text", new { markdown = " Dodano ąę." });
            await Task.Delay(1800);
            var edited = await GetEditorStateAsync(tab.TabId);
            Check("edit marks document dirty", edited is { Dirty: true });
            Check("recovery draft written while dirty", _recovery.HasOwnDraft(tab.TabId));
            Check("dirty marker in title", Title.StartsWith("● "), Title);

            var saved = edited != null && await SaveCoreAsync(tab, saveAs: false, edited);
            var bytes = File.ReadAllBytes(path);
            var text = Encoding.UTF8.GetString(bytes);
            Check("save succeeded", saved);
            Check("saved file contains edit and diacritics", text.Contains("Dodano ąę.") && text.Contains("Zażółć gęślą jaźń"));
            Check("CRLF line endings preserved", text.Contains("\r\n") && !text.Replace("\r\n", "").Contains('\n'));
            Check("no BOM added", !(bytes.Length > 2 && bytes[0] == 0xEF));
            await Task.Delay(800);
            var afterSave = await GetEditorStateAsync(tab.TabId);
            Check("clean after save", afterSave is { Dirty: false });
            Check("recovery draft removed after save", !_recovery.HasOwnDraft(tab.TabId));

            await Eval("window.NoorMD.runCommand('view.split')");
            await Task.Delay(800);
            Check("split view shows two panes", await Eval("(() => { const a = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-container > .toastui-editor').getBoundingClientRect().width; const b = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-md-preview').getBoundingClientRect().width; return a > 200 && b > 200; })()") == "true");
            await Eval("window.NoorMD.runCommand('view.visual')");
            await Task.Delay(800);
            var back = await GetEditorStateAsync(tab.TabId);
            Check("mode round trip keeps text", back != null && back.Markdown.TrimEnd() == afterSave?.Markdown.TrimEnd());

            await Eval("window.NoorMD.runCommand('view.focus')");
            await Task.Delay(600);
            Check("focus mode uses the window width", await Eval("document.querySelector('#editor-card').getBoundingClientRect().width > window.innerWidth - 60") == "true");
            await Capture("screenshot-focus-comfortable.png");
            const string textWidth = "(() => { const pm = document.querySelector('#editor .doc-pane:not([hidden]) .toastui-editor-ww-container .ProseMirror'); const cs = getComputedStyle(pm); return pm.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); })()";
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

            var before = (await GetEditorStateAsync(tab.TabId))?.Markdown;
            await Eval("window.NoorMD.runCommand('spell.toggle')");
            await Task.Delay(300);
            Check("spellcheck off: attribute set, text unchanged, persisted",
                await Eval("[...document.querySelectorAll('#editor .doc-pane:not([hidden]) [contenteditable=\"true\"]')].every(n => n.getAttribute('spellcheck') === 'false')") == "true"
                && (await GetEditorStateAsync(tab.TabId))?.Markdown == before && !_settings.Prefs.Spellcheck);
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

            await RunTabsSelfTestAsync(tab);
            await RunVaultSelfTestAsync(tab);
            await RunSketchSelfTestAsync(tab);
            await RunMusicSelfTestAsync();
            await RunVideoSelfTestAsync();
            await RunStreamSelfTestAsync();
            await RunMicSelfTestAsync();

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

    /// <summary>Multi-document tabs on real WebView2: separate editors, drafts and saves; same file selects its tab.</summary>
    private async Task RunTabsSelfTestAsync(Host.DocumentSession first)
    {
        var dir = Path.GetDirectoryName(first.Path!)!;
        var pathB = Path.Combine(dir, "tab-b.md");
        var pathC = Path.Combine(dir, "tab-c.md");
        File.WriteAllBytes(pathB, [.. new UTF8Encoding(true).GetPreamble(), .. Encoding.UTF8.GetBytes("# Tab B\n\nŻółw B.\n")]);
        File.WriteAllBytes(pathC, Encoding.UTF8.GetBytes("# Tab C\r\n\r\nC body.\r\n"));
        var firstBytes = File.ReadAllBytes(first.Path!);
        var bytesC = File.ReadAllBytes(pathC);

        await OpenPathAsync(pathB);
        await OpenPathAsync(pathC);
        await Task.Delay(1200);
        var sb = FindTabByPath(pathB)!;
        var sc = FindTabByPath(pathC)!;
        Check("files open in their own tabs", _tabs.Count == 3 && await Eval("window.NoorMD.tabs().length") == "3" && _activeTabId == sc.TabId, $"{_tabs.Count} tabs");
        Check("tab strip is shown", await Eval("document.querySelectorAll('#tabs .tab').length") == "3");

        PushEvent("insert.text", new { markdown = " EditC" });
        await Task.Delay(1500);
        SelectTab(sb);
        await Task.Delay(1200);
        PushEvent("insert.text", new { markdown = " EditB" });
        await Task.Delay(1500);
        var stA = await GetEditorStateAsync(first.TabId);
        var stB = await GetEditorStateAsync(sb.TabId);
        var stC = await GetEditorStateAsync(sc.TabId);
        Check("each tab holds only its own edit (no cross-document contamination)",
            stB != null && stC != null && stA != null && stB.Markdown.Contains("EditB") && !stB.Markdown.Contains("EditC") && stC.Markdown.Contains("EditC") && !stC.Markdown.Contains("EditB")
            && !stA.Markdown.Contains("EditB") && !stA.Markdown.Contains("EditC"));
        Check("each dirty tab has its own recovery draft", _recovery.HasOwnDraft(sb.TabId) && _recovery.HasOwnDraft(sc.TabId) && !_recovery.HasOwnDraft(first.TabId));

        var savedB = stB != null && await SaveCoreAsync(sb, saveAs: false, stB);
        var diskB = File.ReadAllBytes(pathB);
        var textB = Encoding.UTF8.GetString(diskB);
        Check("saving one tab writes only that file", savedB && textB.Contains("EditB") && File.ReadAllBytes(pathC).SequenceEqual(bytesC) && File.ReadAllBytes(first.Path!).SequenceEqual(firstBytes));
        Check("that tab keeps its own BOM and LF line endings", diskB.Length > 3 && diskB[0] == 0xEF && !textB.Contains('\r'));
        Check("the other tab is still dirty with its draft", (await GetEditorStateAsync(sc.TabId)) is { Dirty: true } && _recovery.HasOwnDraft(sc.TabId));

        await OpenPathAsync(Path.Combine(dir, "..", Path.GetFileName(dir), "TAB-C.MD"));
        await Task.Delay(800);
        Check("opening an open file by another spelling selects its tab", _tabs.Count == 3 && _activeTabId == sc.TabId);

        var stC2 = await GetEditorStateAsync(sc.TabId);
        var savedC = stC2 != null && await SaveCoreAsync(sc, saveAs: false, stC2);
        Check("second tab keeps CRLF", savedC && File.ReadAllText(pathC).Contains("EditC") && File.ReadAllText(pathC).Contains("\r\n"));
        await Task.Delay(600);
        var closed = await CloseTabAsync(sb);
        await Task.Delay(1000);
        Check("closing a saved tab removes it everywhere", _tabs.Count == 2 && await Eval("window.NoorMD.tabs().length") == "2", JsonSerializer.Serialize(closed));
        Check("session remembers the open tabs", _settings.Session is { } ses && ses.Tabs.Count == 2 && ses.Tabs.Any(t => t.Path == sc.Path));
        await Capture("screenshot-tabs.png");
        SelectTab(first);
        await Task.Delay(1000);
        Check("switching back shows the first document unchanged", (await GetEditorStateAsync(first.TabId))?.Markdown == stA?.Markdown && await Eval("window.NoorMD.activeTab()") == $"\"{first.TabId}\"");
    }

    /// <summary>Vaults on real Windows: scan, search, backlinks, ../ images, rename following a tab, Recycle Bin.</summary>
    private async Task RunVaultSelfTestAsync(Host.DocumentSession first)
    {
        var root = Path.Combine(SelfTestDir!, "Vault Ąę");
        Directory.CreateDirectory(Path.Combine(root, "Images"));
        Directory.CreateDirectory(Path.Combine(root, "World", "Deep"));
        Directory.CreateDirectory(Path.Combine(root, ".obsidian"));
        File.WriteAllText(Path.Combine(root, ".obsidian", "app.json"), "{\"untouched\":true}");
        File.Copy(Path.Combine(Path.GetDirectoryName(first.Path!)!, "img", "pic.png"), Path.Combine(root, "Images", "pic.png"));
        File.WriteAllText(Path.Combine(root, "Index.md"), "# Index\n\nSee [[Rivers]] and [Rivers](World/Deep/Rivers.md).\n");
        File.WriteAllText(Path.Combine(root, "World", "Deep", "Rivers.md"), "# Rivers\n\nŻółw swims here.\n\n![pic](../../Images/pic.png)\n");
        for (int i = 0; i < 300; i++) File.WriteAllText(Path.Combine(root, "World", $"Note {i}.md"), $"# Note {i}\n\nFiller text {i}.\n");

        OpenVault(root);
        var v = _vault!;
        await v.Ready;
        await Task.Delay(500);
        Check("Vault scanned and indexed (300+ notes)", v.Indexed && v.Index.Count >= 302, v.Index.Count.ToString());
        Check("explorer shows the Vault tree", await Eval("document.querySelectorAll('#vault-tree .vt-row').length > 0 && document.body.classList.contains('has-vault')") == "true");
        Check("other tools' folders are skipped and untouched", !v.Entries.Any(e => e.Path.StartsWith(".obsidian")) && File.ReadAllText(Path.Combine(root, ".obsidian", "app.json")) == "{\"untouched\":true}");
        var hits = v.Index.Search("zolw");
        Check("Find in Vault ignores accents", hits.Any(h => h.Path == "World/Deep/Rivers.md" && h.Line == 3));
        var back = v.Index.Backlinks("World/Deep/Rivers.md");
        Check("backlinks find [[wiki]] and relative links", back.Count == 1 && back[0].Source == "Index.md", string.Join(",", back.Select(b => b.Source)));

        var rivers = Path.Combine(root, "World", "Deep", "Rivers.md");
        await OpenPathAsync(rivers);
        await Task.Delay(1500);
        var imageOk = false;
        for (int i = 0; i < 25 && !imageOk; i++)
        {
            imageOk = await Eval("[...document.querySelectorAll('#editor .doc-pane:not([hidden]) img')].some(i => i.complete && i.naturalWidth === 2)") == "true";
            if (!imageOk) await Task.Delay(200);
        }
        Check("a ../../Images picture inside the Vault is shown", imageOk);

        var s = FindTabByPath(rivers)!;
        var move = v.Ops.Rename("World/Deep/Rivers.md", "Streams.md");
        FollowMoves([move]);
        await Task.Delay(500);
        Check("renaming an open note: its tab follows the file", s.Path!.EndsWith("Streams.md") && (await Eval("window.NoorMD.tabs().some(t => (t.path || '').endsWith('Streams.md'))")) == "true");

        var junk = Path.Combine(root, "World", "Note 299.md");
        Host.RecycleBin.Send([junk]);
        Check("delete moves the file to the Recycle Bin", !File.Exists(junk));
        var unicodeNote = v.Ops.CreateNote("World", "Zażółć");
        Check("notes with Polish names can be created", File.Exists(Path.Combine(root, "World", "Zażółć.md")), unicodeNote);

        // Renaming a note updates the links to it (CRLF and the rest of the note kept as they were).
        var linker = Path.Combine(root, "Links.md");
        File.WriteAllText(linker, "# Links\r\n\r\nSee [it](World/Zażółć.md) and [[Zażółć]] — gęś \\[\\[Zażółć\\]\\].\r\n", new System.Text.UTF8Encoding(false));
        v.Entries = VaultScanner.Scan(root, v.Info.Excluded);
        var linkPlan = await PlanLinkUpdatesAsync(v, [("World/Zażółć.md", "World/Źdźbło.md")]);
        var renamed = v.Ops.Rename("World/Zażółć.md", "Źdźbło.md");
        var result = System.Text.Json.JsonSerializer.Serialize(await ApplyLinkUpdatesAsync(v, [renamed], linkPlan.FilesBefore));
        var after = File.ReadAllText(linker);
        Check("renaming a note updates the Markdown and wiki links to it", linkPlan.Links == 3 && after == "# Links\r\n\r\nSee [it](World/Źdźbło.md) and [[Źdźbło]] — gęś [[Źdźbło]].\r\n", after + " " + result);

        var zipPath = Path.Combine(SelfTestDir!, "vault-pack.zip");
        var plan = PackagePlanner.Build(root, new PackageOptions { Selection = ["World/Deep"], IncludeDependencies = true, Handoff = true, HandoffNote = "Review please." });
        var packed = await Task.Run(() => ZipPackager.Create(plan, zipPath, null, CancellationToken.None));
        using (var z = System.IO.Compression.ZipFile.OpenRead(zipPath))
        {
            var names = z.Entries.Select(e => e.FullName).ToList();
            Check("Pack & Share: folder + linked picture + handoff files, Polish names intact",
                names.Contains("World/Deep/Streams.md") && names.Contains("Images/pic.png") && names.Contains("_noormd_handoff/README.md") && packed.Failures.Count == 0, string.Join(", ", names));
        }

        await CloseTabAsync(s);
        CloseVault(remember: false);
        await Task.Delay(300);
        Check("closing the Vault leaves the other tabs open", _tabs.Count >= 1 && await Eval("document.body.classList.contains('has-vault')") == "false");
        SelectTab(first);
        await Task.Delay(800);
    }

    /// <summary>NoorSketch on real WebView2: separate window, exact PNG through the .noorsketch format, editor untouched.</summary>
    private async Task RunSketchSelfTestAsync(Host.DocumentSession first)
    {
        var before = (await GetEditorStateAsync(first.TabId))?.Markdown;
        var w = OpenSketch(null);
        string ready = "false";
        for (int i = 0; i < 50 && ready != "true"; i++) { await Task.Delay(200); try { ready = await w.EvalAsync("!!(window.NoorSketch && window.NoorSketch._state().W === 1920)"); } catch { } }
        Check("NoorSketch opens in its own window with a 1920×1080 canvas", ready == "true");
        await Task.Delay(400);
        var size = await w.EvalAsync("JSON.stringify([window.innerWidth, window.innerHeight, !!document.querySelector('.sk-bar') && document.querySelector('.sk-bar').getBoundingClientRect().height > 10])");
        Check("the NoorSketch page fills its window right away (no resize needed)", size.Contains("true") && !size.StartsWith("\"[0,"), size);
        if (ready != "true") { w.CloseWithoutPrompt(); return; }
        await w.EvalAsync("window.NoorSketch._newCanvas(256, 128, 'transparent'); window.__png = null; window.NoorSketch._encode().then(p => window.__png = p)");
        string png = "null";
        for (int i = 0; i < 30 && png == "null"; i++) { await Task.Delay(100); png = await w.EvalAsync("window.__png"); }
        var bytes = Convert.FromBase64String(JsonSerializer.Deserialize<string>(png) ?? "");
        var file = Path.Combine(SelfTestDir!, "selftest.noorsketch");
        NoorMD.Core.Sketch.SketchFile.Save(file, bytes, "transparent");
        var (back, manifest) = NoorMD.Core.Sketch.SketchFile.Load(file);
        Check("sketch PNG from the page saves and loads byte-identical (.noorsketch)", back.SequenceEqual(bytes) && manifest.Width == 256 && manifest.Height == 128);
        await Capture("screenshot-before-sketch-close.png");
        w.CloseWithoutPrompt();
        await Task.Delay(400);
        Check("closing NoorSketch leaves the document untouched", (await GetEditorStateAsync(first.TabId))?.Markdown == before && !_sketches.Contains(w));
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
        // The page's own query payload (with nulls) through the real bridge — regression for the null-number bug.
        await Eval("window.__nq = null; NoorBridge.request('music.query', { search: '', triage: null, missingOnly: false, playlistId: null, sort: 'title', desc: false, offset: 0, limit: 200 }).then(r => window.__nq = r.total, e => window.__nq = 'error: ' + e.message)");
        await Task.Delay(700);
        var nq = await Eval("window.__nq");
        Check("music.query with the page's null filters works through the bridge", nq == scan.Added.ToString(System.Globalization.CultureInfo.InvariantCulture), nq);
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

        // Loudness: WebView2 decodes the file through /_media/ (connect-src 'self') and measures it.
        await Eval($"window.__lu = null; NoorFx.analyze('_media/{mp3.Id}?v=99').then(r => window.__lu = r.lufs, e => window.__lu = 'error: ' + e.message)");
        for (var i = 0; i < 20 && await Eval("window.__lu") == "null"; i++) await Task.Delay(250);
        var lu = await Eval("window.__lu");
        Check("loudness of an MP3 is measured in WebView2", double.TryParse(lu, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var lufs) && lufs is < 0 and > -60, lu);
        // Equalizer + limiter graph: playback must continue through it.
        await Eval("NoorFx.update({ eqOn: true, preset: 'bass', normalize: true })");
        await Eval($"window.NoorMusic._testPlay([{string.Join(',', ids)}], {ids.ToList().IndexOf(mp3.Id)}, true)");
        await Task.Delay(1500);
        Check("playback continues through the equalizer and limiter", await Eval("(() => { const s = window.NoorMusic._state(); return NoorFx.active && !s.paused && s.time > 0.3; })()") == "true", await Eval("JSON.stringify([NoorFx.active, window.NoorMusic._state().time])"));
        await Eval("NoorFx.update({ eqOn: false, normalize: false })");

        // Batch Organizer on real NTFS files: swap two names in one batch, then undo the whole batch.
        var two = Music.GetMany(ids).Where(t => t.Path.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase)).Take(2).ToList();
        if (two.Count == 2)
        {
            var names = two.Select(t => Path.GetFileNameWithoutExtension(t.Path)).ToList();
            NoorMD.Media.TagIO.Write(two[0].Path, new NoorMD.Media.TagEdit { Comment = names[1] }); Music.Refresh(two[0].Id, two[0].Path);
            NoorMD.Media.TagIO.Write(two[1].Path, new NoorMD.Media.TagEdit { Comment = names[0] }); Music.Refresh(two[1].Id, two[1].Path);
            var spec = new NoorMD.Media.BatchSpec { Rename = new NoorMD.Media.RenameRules { Enabled = true, Template = "{Comment}" } };
            var res = await Task.Run(() => Batch.Apply([two[0].Id, two[1].Id], spec));
            Check("Batch Organizer swaps two file names in one batch", res.Done == 2 && Music.Get(two[0].Id)!.Path == two[1].Path, string.Join(" ", res.Items.Select(x => x.Status + ":" + x.Message)));
            var bu = await Task.Run(() => Batch.Undo(res.BatchId!.Value));
            Check("…and undoes the whole batch", bu.Done == 2 && Music.Get(two[0].Id)!.Path == two[0].Path);
        }
        await Eval("window.NoorMusic.toggle()");
    }

    /// <summary>A bridge request made by the page itself, waited for; returns the JSON result or "error: …".</summary>
    private async Task<string> PageRequest(string type, string payloadJson)
    {
        await Eval($"window.__pr = null; NoorBridge.request({JsonSerializer.Serialize(type)}, {payloadJson}).then(r => window.__pr = JSON.stringify(r), e => window.__pr = 'error: ' + e.message)");
        for (var i = 0; i < 40; i++) { var r = await Eval("window.__pr"); if (r != "null") return JsonSerializer.Deserialize<string>(r) ?? ""; await Task.Delay(100); }
        return "timeout";
    }

    private async Task RunStreamSelfTestAsync()
    {
        var root = Path.Combine(SelfTestDir!, "Stream Vault Ż");
        Directory.CreateDirectory(root);
        OpenVault(root);
        await _vault!.Ready;
        StreamCfg["txtEnabled"] = true;
        StreamCfg["txtPath"] = Path.Combine(SelfTestDir!, "now-playing.txt");
        int port = 47321;
        try { StartOverlay(port); } catch (System.Net.Sockets.SocketException) { port = 47399; StartOverlay(port); }
        Check("overlay server listens on the loopback address", _overlay is { Running: true }, _overlay?.BaseUrl);
        using var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        var page = await http.GetStringAsync($"http://127.0.0.1:{port}/now-playing.html");
        var font = await http.GetAsync($"http://127.0.0.1:{port}/inter-ext.woff2");
        Check("OBS can load the Now Playing page and its font", page.Contains("np-render.js") && font.IsSuccessStatusCode && font.Content.Headers.ContentType?.MediaType == "font/woff2");
        var nextPage = await http.GetStringAsync($"http://127.0.0.1:{port}/next-stream.html");
        var weekPage = await http.GetStringAsync($"http://127.0.0.1:{port}/schedule.html");
        var scRender = await http.GetAsync($"http://127.0.0.1:{port}/sc-render.js");
        Check("OBS can load the Next stream and This week overlays", nextPage.Contains("sc-render.js") && weekPage.Contains("data-mode=\"week\"") && scRender.IsSuccessStatusCode);
        using (var evil = new System.Net.Sockets.TcpClient())
        {
            await evil.ConnectAsync(System.Net.IPAddress.Loopback, port);
            var es = evil.GetStream();
            await es.WriteAsync(Encoding.ASCII.GetBytes($"GET /now-playing.html HTTP/1.1\r\nHost: attacker.example:{port}\r\n\r\n"));
            var answer = await new StreamReader(es).ReadToEndAsync();
            Check("requests for another host name are refused (DNS rebinding)", answer.StartsWith("HTTP/1.1 421", StringComparison.Ordinal), answer.Split('\n')[0]);
        }
        // Live push: the page reports a song; an SSE client (like OBS) receives it.
        using (var sse = new System.Net.Sockets.TcpClient())
        {
            await sse.ConnectAsync(System.Net.IPAddress.Loopback, port);
            var s = sse.GetStream();
            await s.WriteAsync(Encoding.ASCII.GetBytes($"GET /events HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"));
            await Task.Delay(300);
            await Eval("NoorStream.nowPlaying(null)");
            await Eval("NoorStream.nowPlaying({ id: 1, title: 'Żółta łódź', artist: 'Noor', hasArt: false, playing: true, position: 3, duration: 120 })");
            var got = new StringBuilder();
            var buf = new byte[8192];
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            // System.Text.Json escapes non-ASCII ("\u017B…"); the overlay's JSON.parse reads either form.
            bool Has() => got.ToString().Contains("Żółta łódź") || got.ToString().Contains("\\u017B\\u00F3\\u0142ta \\u0142\\u00F3d\\u017A", StringComparison.OrdinalIgnoreCase);
            try { while (!Has()) { var n = await s.ReadAsync(buf, cts.Token); if (n == 0) break; got.Append(Encoding.UTF8.GetString(buf, 0, n)); } } catch (OperationCanceledException) { }
            Check("the playing song is pushed to OBS overlays over Server-Sent Events", got.ToString().Contains("event: np.track") && Has(), got.Length > 400 ? got.ToString()[^400..] : got.ToString());
        }
        var txt = Path.Combine(SelfTestDir!, "now-playing.txt");
        Check("now-playing.txt is written for an OBS Text source", File.Exists(txt) && File.ReadAllText(txt) == "Noor - Żółta łódź", File.Exists(txt) ? File.ReadAllText(txt) : "missing");

        var saveSup = await PageRequest("stream.supporters.save", "{ supporters: [{ name: 'Zośka Ćwik', channel: 'https://www.youtube.com/@zoska', tier: 'Złoto', since: '2026-01-02' }, { name: 'Bartek', until: '2026-05-01' }] }");
        var supFile = Path.Combine(root, "Stream", "Supporters.md");
        var parsed = File.Exists(supFile) ? NoorMD.Core.Stream.SupportersFile.Parse(File.ReadAllText(supFile)) : [];
        Check("supporters are kept as a Markdown table note in the Vault", parsed.Count == 2 && parsed[0].Name == "Zośka Ćwik" && parsed[0].Tier == "Złoto" && !parsed[1].Active, saveSup);
        var log = await PageRequest("stream.log.save", "{ entry: { title: 'Nocny stream: synthwave', date: '2026-10-26', number: 7, description: 'Opis {tracklist}', keywords: 'suno, synthwave', tracklist: [{ offset: 0, text: 'Noor – Żółta łódź' }], notes: '' } }");
        var logDir = Path.Combine(root, "Streams");
        var note = Directory.Exists(logDir) ? Directory.GetFiles(logDir, "*.md").FirstOrDefault() : null;
        var entry = note != null ? NoorMD.Core.Stream.StreamLog.Parse(File.ReadAllText(note)) : null;
        Check("a stream is saved as a note in the Vault and reads back", entry is { Number: 7, Title: "Nocny stream: synthwave" } && entry.Tracklist.Count == 1 && entry.Keywords.Count == 2, log);
        await _overlay!.StopAsync();
        _overlay = null;
        var closed = false;
        try { using var c = new System.Net.Sockets.TcpClient(); await c.ConnectAsync(System.Net.IPAddress.Loopback, port); } catch (System.Net.Sockets.SocketException) { closed = true; }
        Check("turning the overlay server off closes the port", closed);
        StreamCfg["txtEnabled"] = false;
        CloseVault(remember: false);
    }

    /// <summary>Mic Guard on real Windows. Never changes the real microphone's mute: it only lists and reads.</summary>
    private async Task RunMicSelfTestAsync()
    {
        const string target = "NoorMD/selftest-secret";
        Host.CredentialStore.Write(target, "pa55-Zażółć");
        Check("secrets round-trip through Windows Credential Manager", Host.CredentialStore.Read(target) == "pa55-Zażółć");
        Host.CredentialStore.Delete(target);
        Check("…and can be deleted", !Host.CredentialStore.Exists(target) && Host.CredentialStore.Read(target) == null);

        IReadOnlyList<Host.CaptureDevice> devices = [];
        var listed = true;
        try { devices = Host.CaptureEndpoint.List(); } catch (Exception ex) { listed = false; Log.Error("mic list", ex); }
        Check("microphones can be listed through Core Audio", listed, $"{devices.Count} found");
        if (devices.Count > 0)
        {
            using var ep = Host.CaptureEndpoint.Open(null);
            Check("the default microphone's mute state can be read", ep != null && ep.Muted is true or false, ep?.Name);
        }

        using (var hk = new Host.GlobalHotkey(new System.Windows.Interop.WindowInteropHelper(this).Handle, () => { }))
        {
            var err = hk.Set("Ctrl+Alt+Shift+F11");
            Check("a system-wide hotkey can be registered and released", err == null && hk.Gesture == "Ctrl+Alt+Shift+F11", err);
            Check("plain letters are refused as a global hotkey", hk.Set("M") is { } e && e.Contains("Ctrl"));
            var slash = hk.Set("Ctrl+Alt+Shift+/");
            Check("keys like / can be a hotkey", slash == null && hk.Gesture == "Ctrl+Alt+Shift+/", slash);
            var side = hk.Set("Mouse5");
            Check("a side mouse button can be the hotkey (mouse hook installs and releases)", side == null && hk.Gesture == "Mouse5", side);
            hk.Clear();
        }

        var ind = new MicIndicatorWindow(this);
        ind.Configure(0.9, 1, hideFromCapture: true);
        ind.SetState(NoorMD.Core.Stream.MicVerdict.Mismatch, "Win muted · OBS live", "test");
        ind.Show();
        await Task.Delay(300);
        Check("the floating mic indicator opens on top without taking focus", ind.IsVisible && ind.Topmost && !ind.IsActive && ind.ActualWidth > 60, $"{ind.ActualWidth:0}×{ind.ActualHeight:0}");
        Check("…and is hidden from screen capture (Windows 10 2004+)", ind.ExcludedFromCapture);
        ind.Close();

        // NoorForm: a tree is grown and meshed in the app, its GLB is served to the page and read back there; separate
        // branches come out as meshes of their own with clean geometry.
        {
            await Eval(@"window.__tree = null; (async () => {
                try {
                    const r = await NoorBridge.request('asset.preset', { id: 'stylized-oak' });
                    r.budget = 1500; r.lods = 2;
                    const out = await NoorBridge.request('asset.build', { recipe: r });
                    const glb = NoorAssetView.parseGlb(await (await fetch(out.lods[0].url)).arrayBuffer());
                    window.__tree = JSON.stringify({ lods: out.lods.length, nodes: glb.nodes.filter((n) => n.mesh >= 0).map((n) => n.name), images: glb.images.length, tris: out.lods.map((l) => l.triangles) });
                } catch (e) { window.__tree = 'error ' + e.message; } })()");
            var tree = "null";
            for (var i = 0; i < 300 && tree == "null"; i++) { await Task.Delay(100); tree = await Eval("window.__tree"); }
            // Two levels and the billboard (two crossed cards, front and back: 8 triangles).
            Check("NoorForm: a tree builds in the app (two levels and a billboard) and its GLB loads in the page", tree.Contains("\\\"lods\\\":3") && tree.Contains(",8]") && tree.Contains("Trunk") && tree.Contains("Leaves") && !tree.Contains("error"), tree);
            var sep = NoorMD.Media.Assets3D.TreePresets.Make("oak");
            sep.Branches = "separate"; sep.Quality = "low"; sep.Lods = 1; sep.Budget = 2000;
            var built = NoorMD.Media.Assets3D.TreeBuilder.Build(sep, new NoorMD.Media.Assets3D.TreeBuilder.Options { TextureSize = 64 });
            var meshes = built.Lods[0].Root.All().Where(n => n.Mesh != null).ToList();
            var glbBytes = NoorMD.Media.Assets3D.GlbWriter.Write(built.Lods[0]);
            Check("NoorForm: separate branches are meshes of their own, all clean, written as GLB",
                meshes.Count(n => n.Name.StartsWith("Branch_") && !n.Name.EndsWith("_Leaves")) == built.Skeleton.Branches.Count(b => b.Level == 1)
                && meshes.All(n => n.Mesh!.Problems().Count == 0) && glbBytes.Length > 10000 && BitConverter.ToUInt32(glbBytes, 0) == 0x46546C67,
                $"{meshes.Count} meshes, {glbBytes.Length} bytes, {built.Seconds:0.0} s");

            // A rock in the app: its levels, its collision pieces named for Godot, its GLB read back in the page.
            await Eval(@"window.__rock = null; (async () => {
                try {
                    const r = await NoorBridge.request('asset.rock.preset', { id: 'angular-boulder' });
                    const out = await NoorBridge.request('asset.rock.build', { recipe: r });
                    const glb = NoorAssetView.parseGlb(await (await fetch(out.lods[0].url)).arrayBuffer());
                    window.__rock = JSON.stringify({ lods: out.lods.length, tris: out.lods.map((l) => l.triangles), collision: out.collision, nodes: glb.nodes.filter((n) => n.mesh >= 0).map((n) => n.name) });
                } catch (e) { window.__rock = 'error ' + e.message; } })()");
            var rock = "null";
            for (var i = 0; i < 300 && rock == "null"; i++) { await Task.Delay(100); rock = await Eval("window.__rock"); }
            Check("NoorForm: a rock builds in the app (three levels, convex collision) and its GLB loads in the page",
                rock.Contains("\\\"lods\\\":3") && rock.Contains("Collision-convcolonly") && !rock.Contains("\\\"collision\\\":[]") && !rock.Contains("error"), rock);
        }

        // NoorCalendar: the engine and .ics on this computer's time zone (your own calendar is not touched), and the
        // reminder pop-up near the clock, which must not take focus.
        {
            var bday = NoorMD.Core.Calendar.CalendarCheck.Clamped(new NoorMD.Core.Calendar.CalendarEntry { Id = "selftest", Title = "Self-test birthday", Category = "birthday", AllDay = true,
                Start = "2000-02-29", End = "2000-02-29", SinceYear = 2000, Repeat = new NoorMD.Core.Calendar.CalendarRepeat { Freq = "yearly" }, Reminders = [-540] });
            var occ = NoorMD.Core.Calendar.CalendarEngine.Occurrences([bday], new DateTime(2027, 1, 1), new DateTime(2028, 12, 31));
            var round = NoorMD.Core.Calendar.Ics.Import(NoorMD.Core.Calendar.Ics.Export([bday]));
            Check("NoorCalendar: a 29 February birthday repeats with its age, and survives an .ics round trip",
                occ.Count == 2 && occ[0].Date == "2027-02-28" && occ[0].Age == 27 && round.Entries.Count == 1 && round.Entries[0].SinceYear == 2000 && round.Entries[0].Reminders.SequenceEqual([-540]),
                string.Join(", ", occ.Select(o => $"{o.Date} ({o.Age})")));
            var pop = new ReminderWindow(this);
            pop.Add([new ReminderWindow.Item("selftest|x|0", "Self-test reminder", "Today 12:00", "Nothing to do")]);
            await Task.Delay(300);
            Check("NoorCalendar: the reminder pop-up shows on top without taking focus", pop.IsVisible && pop.Topmost && !pop.IsActive && pop.ActualHeight > 60, $"{pop.ActualWidth:0}×{pop.ActualHeight:0}");
            pop.Remove("selftest|x|0");
            Check("…and goes when its reminder is handled", !pop.IsVisible);
            pop.Close();
        }

        // NoorStream's own window: opens with its page at full size, reaches NoorStream, and nothing else.
        OpenStreamWindow("mic", false, false);
        var sw = _streamWindow!;
        var page = "";
        for (var i = 0; i < 40; i++)
        {
            await Task.Delay(200);
            try { page = await sw.EvalAsync("JSON.stringify([window.innerWidth, !!document.querySelector('#streamdesk:not([hidden])'), !!document.querySelector('#mic-verdict'), document.querySelector('[data-sdtab=\"mic\"]')?.getAttribute('aria-selected')])"); } catch { }
            if (page.Contains("true,true")) break;
        }
        Check("NoorStream opens in its own window, on the requested tab, at full size", page.Contains("true,true,\\\"true\\\"") && int.TryParse(page.Trim('"').TrimStart('[').Split(',')[0], out var sww) && sww > 500, page);
        await sw.EvalAsync("window.__sw = null; NoorBridge.request('doc.save', {}).then(() => window.__sw = 'allowed', e => window.__sw = 'refused: ' + e.message)");
        var refused = "";
        for (var i = 0; i < 20 && !refused.Contains("refused") && !refused.Contains("allowed"); i++) { await Task.Delay(100); refused = await sw.EvalAsync("window.__sw"); }
        Check("NoorStream window can't use the editor's commands", refused.Contains("refused"), refused);
        OpenStreamWindow(null, false, close: true);
        await Task.Delay(300);
        Check("…and closes, remembering where it was", _streamWindow == null && StreamCfg["window"] is System.Text.Json.Nodes.JsonObject);

        // Docks: the "Streaming" layout puts music left, NoorStream right and the document between them.
        await Eval("NoorDock.applyPreset('streaming')");
        await Task.Delay(1200);
        var docks = JsonSerializer.Deserialize<string>(await Eval("JSON.stringify(['#dock-left', '#editor', '#dock-right'].map(q => { const r = document.querySelector(q).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }))")) ?? "[]";
        var d = JsonSerializer.Deserialize<int[][]>(docks) ?? [];
        Check("the Streaming layout docks music left and NoorStream right, the document between", d.Length == 3 && d[0][1] <= d[1][0] + 1 && d[1][1] <= d[2][0] + 1 && d[0][1] - d[0][0] > 250 && d[2][1] - d[2][0] > 250, docks);
        await Eval("NoorDock.applyPreset('classic'); NoorMusic.togglePanel(false); NoorStream.close()");
        await Task.Delay(300);

        // NoorHub: the Windows icon of a program, with transparency, shown in the page (nothing is started).
        var notepad = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "notepad.exe");
        if (File.Exists(notepad))
        {
            var hubItem = await AddHubPathAsync(notepad, null);
            var iconFile = hubItem.Icon != null ? Path.Combine(Hub.IconsFolder, hubItem.Icon) : null;
            var png = iconFile != null && File.Exists(iconFile) ? File.ReadAllBytes(iconFile) : [];
            var transparentCorner = false;
            if (png.Length > 0)
            {
                var frame = System.Windows.Media.Imaging.BitmapFrame.Create(new MemoryStream(png));
                var px = new byte[4];
                frame.CopyPixels(new System.Windows.Int32Rect(0, 0, 1, 1), px, 4, 0);
                transparentCorner = px[3] < 40;
            }
            Check("NoorHub: a program gets its Windows icon, with a transparent background", png.Length > 200 && transparentCorner, $"{png.Length} bytes");
            await Eval($"window.__hi = null; (() => {{ const i = new Image(); i.onload = () => window.__hi = i.naturalWidth; i.onerror = () => window.__hi = -1; i.src = '/_hubicon/{hubItem.Icon}'; }})()");
            var shown = "null";
            for (var i = 0; i < 20 && shown == "null"; i++) { await Task.Delay(100); shown = await Eval("window.__hi"); }
            Check("…and the page shows it", int.TryParse(shown, out var hw) && hw >= 32, shown);
            Hub.Remove(hubItem.Id);
        }

        // Gallery: a photo taken sideways (EXIF orientation 6) gets an upright preview; the page loads the preview and the picture.
        {
            var picDir = Path.Combine(SelfTestDir!, "Pictures", "Lato");
            Directory.CreateDirectory(picDir);
            var photo = Path.Combine(picDir, "Plaża.jpg");
            var bmp = System.Windows.Media.Imaging.BitmapSource.Create(80, 40, 96, 96, System.Windows.Media.PixelFormats.Bgr24, null, new byte[80 * 40 * 3], 80 * 3);
            var meta = new System.Windows.Media.Imaging.BitmapMetadata("jpg");
            meta.SetQuery("/app1/ifd/{ushort=274}", (ushort)6);
            var jpg = new System.Windows.Media.Imaging.JpegBitmapEncoder();
            jpg.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(bmp, null, meta, null));
            using (var fs = File.Create(photo)) jpg.Save(fs);
            var gid = Gallery.AddFolder(Path.Combine(SelfTestDir!, "Pictures"));
            await ScanGalleryAsync([gid]);
            var img = Gallery.Query(new NoorMD.Media.GalleryQuery(Search: "plaza")).FirstOrDefault();
            var thumb = img != null ? await Task.Run(() => EnsureThumb(img)) : null;
            var tw = 0; var th = 0;
            if (thumb != null) { var f = System.Windows.Media.Imaging.BitmapFrame.Create(new MemoryStream(File.ReadAllBytes(thumb))); tw = f.PixelWidth; th = f.PixelHeight; }
            Check("NoorGallery: a picture is found in its album and gets an upright preview", img != null && img.Album == "Lato" && th == 80 && tw == 40, $"{img?.Album} {tw}x{th}");
            await Eval($"window.__gt = null; (() => {{ const a = new Image(), b = new Image(); let n = 0; const done = () => {{ if (++n === 2) window.__gt = a.naturalHeight + 'x' + b.naturalWidth; }}; a.onload = b.onload = done; a.onerror = b.onerror = () => window.__gt = 'error'; a.src = '/_thumb/{img?.Id}'; b.src = '/_img/{img?.Id}'; }})()");
            var gt = "null";
            for (var i = 0; i < 40 && gt == "null"; i++) { await Task.Delay(100); gt = await Eval("window.__gt"); }
            Check("…and the page shows the preview and the picture", gt.Trim('"') == "80x80" || gt.Trim('"').StartsWith("80x"), gt);
            // Organizing: rename (Polish name), a new album, move there, undo; nothing is overwritten.
            if (img != null)
            {
                Organizer.Rename(img.Id, "Morze o zachodzie");
                var album = Organizer.CreateAlbum(Path.Combine(SelfTestDir!, "Pictures"), "Góry");
                Organizer.Move([img.Id], album);
                var movedOk = File.Exists(Path.Combine(album, "Morze o zachodzie.jpg")) && Gallery.Get(img.Id)?.Album == "Góry";
                Organizer.Undo();
                Check("NoorGallery: rename, new album, move and undo work on Windows", movedOk && File.Exists(Path.Combine(picDir, "Morze o zachodzie.jpg")) && Gallery.Get(img.Id)?.Album == "Lato");
            }
            // Work files: a Photoshop file shows its own embedded preview; an album can be renamed (and back); pictures pack into a ZIP.
            {
                var jpegBytes = File.ReadAllBytes(Path.Combine(picDir, "Morze o zachodzie.jpg"));
                var ms = new MemoryStream();
                void BE(uint v, int n) { for (var k = n - 1; k >= 0; k--) ms.WriteByte((byte)(v >> (8 * k))); }
                ms.Write("8BPS"u8); BE(1, 2); ms.Write(new byte[6]); BE(3, 2); BE(1000, 4); BE(2000, 4); BE(8, 2); BE(3, 2); BE(0, 4);
                var resLen = 12 + 28 + jpegBytes.Length + (jpegBytes.Length % 2);
                BE((uint)resLen, 4); ms.Write("8BIM"u8); BE(1036, 2); ms.WriteByte(0); ms.WriteByte(0); BE((uint)(28 + jpegBytes.Length), 4); ms.Write(new byte[28]); ms.Write(jpegBytes);
                if (jpegBytes.Length % 2 == 1) ms.WriteByte(0);
                BE(0, 4);
                File.WriteAllBytes(Path.Combine(picDir, "Projekt.psd"), ms.ToArray());
                await ScanGalleryAsync([gid]);
                var psd = Gallery.Query(new NoorMD.Media.GalleryQuery(Format: "PSD")).FirstOrDefault();
                var psdThumb = psd != null ? await Task.Run(() => EnsureThumb(psd)) : null;
                Check("NoorGallery: a PSD is listed (2000×1000) with a preview", psd is { Width: 2000, Height: 1000 } && psdThumb != null, $"{psd?.Width}x{psd?.Height} {psdThumb}");
                Organizer.RenameAlbum(picDir, "Lato 2024");
                var renamedOk = Directory.Exists(Path.Combine(SelfTestDir!, "Pictures", "Lato 2024")) && Gallery.Get(psd!.Id)?.Album == "Lato 2024";
                Organizer.Undo();
                var zip = Path.Combine(SelfTestDir!, "pictures.zip");
                var packed = NoorMD.Media.GalleryZip.Create(Gallery.Query(new NoorMD.Media.GalleryQuery()).Select(i => i.Path).ToList(), zip);
                Check("NoorGallery: album rename and back, and a ZIP of the pictures", renamedOk && Directory.Exists(picDir) && packed == 2 && File.Exists(zip), $"{renamedOk} {packed}");
            }
            // Windows' thumbnails (the way Affinity and Photoshop files get previews) come out the right way up.
            {
                var px = new byte[60 * 40 * 3];
                for (var y = 0; y < 40; y++) for (var x = 0; x < 60; x++) { var i = (y * 60 + x) * 3; if (y < 20) px[i + 2] = 255; else px[i] = 255; } // red on top, blue below (BGR)
                var up = System.Windows.Media.Imaging.BitmapSource.Create(60, 40, 96, 96, System.Windows.Media.PixelFormats.Bgr24, null, px, 60 * 3);
                var upEnc = new System.Windows.Media.Imaging.PngBitmapEncoder();
                upEnc.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(up));
                var upFile = Path.Combine(SelfTestDir!, "Pictures", "orientation.png");
                using (var fs = File.Create(upFile)) upEnc.Save(fs);
                var thumbPng = await Task.Run(() => Host.ShellIcons.Thumbnail(upFile, 64));
                var orientation = "no thumbnail";
                if (thumbPng != null)
                {
                    var f = System.Windows.Media.Imaging.BitmapFrame.Create(new MemoryStream(thumbPng));
                    var conv = new System.Windows.Media.Imaging.FormatConvertedBitmap(f, System.Windows.Media.PixelFormats.Bgra32, null, 0);
                    var top = new byte[4]; var bottom = new byte[4];
                    conv.CopyPixels(new System.Windows.Int32Rect(conv.PixelWidth / 2, 2, 1, 1), top, 4, 0);
                    conv.CopyPixels(new System.Windows.Int32Rect(conv.PixelWidth / 2, conv.PixelHeight - 3, 1, 1), bottom, 4, 0);
                    orientation = top[2] > 200 && top[0] < 60 && bottom[0] > 200 && bottom[2] < 60 ? "upright" : $"top {top[2]},{top[1]},{top[0]} bottom {bottom[2]},{bottom[1]},{bottom[0]}";
                }
                Check("NoorGallery: Windows thumbnails (Affinity, Photoshop) are the right way up", orientation is "upright" or "no thumbnail", orientation);
            }
            // Picture tools: stars, a colour label and tags are kept; a JPEG turns by its orientation, a PNG keeps every pixel.
            if (img != null)
            {
                Gallery.SetRating([img.Id], 4);
                Gallery.SetLabel([img.Id], "green");
                Gallery.AddTags([img.Id], ["Wakacje", "morze"]);
                var marked = Gallery.Get(img.Id)!;
                var before = (marked.Width, marked.Height);
                TurnPicture(marked.Path, clockwise: true);
                var turnedJpg = Gallery.Refresh(img.Id)!;
                var jpgOk = (turnedJpg.Width, turnedJpg.Height) == (before.Height, before.Width) && NoorMD.Media.PictureRotate.Orientation(marked.Path) == 3;
                // The browser itself must follow the orientation NoorMD writes (a SHORT value): turned to 8, the photo shows standing.
                TurnPicture(marked.Path, clockwise: true); // 3 → 8
                await Eval($"window.__gr = null; (() => {{ const i = new Image(); i.onload = () => window.__gr = i.naturalWidth + 'x' + i.naturalHeight; i.onerror = () => window.__gr = 'error'; i.src = '/_img/{img.Id}?r=' + Date.now(); }})()");
                var gr = "null";
                for (var i = 0; i < 40 && gr == "null"; i++) { await Task.Delay(100); gr = await Eval("window.__gr"); }
                Check("NoorGallery: a photo turned in NoorMD is shown turned by the page too", gr.Trim('"') == "40x80", gr);
                TurnPicture(marked.Path, clockwise: false); // 8 → 3
                TurnPicture(marked.Path, clockwise: false); // 3 → 6
                Gallery.Refresh(img.Id);
                var upFile = Path.Combine(SelfTestDir!, "Pictures", "orientation.png");
                TurnPicture(upFile, clockwise: true);
                var pf = System.Windows.Media.Imaging.BitmapFrame.Create(new MemoryStream(File.ReadAllBytes(upFile)));
                var pc = new System.Windows.Media.Imaging.FormatConvertedBitmap(pf, System.Windows.Media.PixelFormats.Bgra32, null, 0);
                var left = new byte[4]; var right = new byte[4];
                pc.CopyPixels(new System.Windows.Int32Rect(2, pc.PixelHeight / 2, 1, 1), left, 4, 0);
                pc.CopyPixels(new System.Windows.Int32Rect(pc.PixelWidth - 3, pc.PixelHeight / 2, 1, 1), right, 4, 0);
                var pngOk = pc.PixelWidth == 40 && pc.PixelHeight == 60 && left[0] > 200 && right[2] > 200; // turned right: blue on the left, red on the right
                Check("NoorGallery: stars, label and tags are kept; a JPEG turns by its orientation and a PNG without loss",
                    marked is { Rating: 4, Label: "green" } && marked.Tags is ["morze", "Wakacje"] && jpgOk && pngOk && Gallery.Get(img.Id)!.Width == before.Width,
                    $"{marked.Rating} {marked.Label} [{string.Join(",", marked.Tags ?? [])}] jpg {before} → {turnedJpg.Width}x{turnedJpg.Height} png {pc.PixelWidth}x{pc.PixelHeight} L{left[2]},{left[0]} R{right[2]},{right[0]}");
            }
            // Convert / resize: a sideways JPEG comes out upright and smaller with its date; a PNG becomes a JPEG; the originals stay.
            if (img != null)
            {
                var outDir = Path.Combine(SelfTestDir!, "Converted out");
                Directory.CreateDirectory(outDir);
                var src = Gallery.Get(img.Id)!;
                var srcBytes = File.ReadAllBytes(src.Path);
                var (made, failed) = await Task.Run(() => ConvertPictures([img.Id], new NoorMD.Media.ConvertOptions("keep", 40, 90, "-web"), outDir));
                var again = await Task.Run(() => ConvertPictures([img.Id], new NoorMD.Media.ConvertOptions("png", 0, 90, "-web"), outDir));
                var cw = 0; var ch = 0;
                if (made.Count == 1) { var f = System.Windows.Media.Imaging.BitmapFrame.Create(new MemoryStream(File.ReadAllBytes(made[0]))); cw = f.PixelWidth; ch = f.PixelHeight; }
                var dateKept = made.Count == 1 && Math.Abs((NoorMD.Media.GalleryLibrary.ReadInfo(made[0], DateTime.UtcNow.AddYears(1)).TakenUtc - src.TakenUtc).TotalSeconds) < 1.5; // EXIF keeps whole seconds
                var names = string.Join(",", made.Concat(again.Made).Select(Path.GetFileName));
                Check("NoorGallery: convert / resize makes upright, smaller copies (with the date) and leaves the original alone",
                    failed.Count == 0 && cw == 20 && ch == 40 && dateKept && Path.GetFileName(made[0]) == "Morze o zachodzie-web.jpg"
                        && again.Made.Count == 1 && again.Made[0].EndsWith("-web.png") && File.ReadAllBytes(src.Path).AsSpan().SequenceEqual(srcBytes),
                    $"{cw}x{ch} date {dateKept} {names} {string.Join("; ", failed.Concat(again.Failed))}");
            }
            Gallery.RemoveFolder(gid);
        }

        // Radio: a station plays through the loopback relay (the page's content rules allow it), and its song title arrives.
        {
            // A tiny ICY station: an MP3 from the self-test's music (sent a few times over, like a live stream), with metadata every 2048 bytes.
            const int metaInt = 2048;
            var mp3File = Directory.GetFiles(Path.Combine(SelfTestDir!, "music"), "*.mp3").OrderBy(f => f).First();
            var one = File.ReadAllBytes(mp3File);
            var sound = Enumerable.Repeat(one, 4).SelectMany(b => b).ToArray();
            var icy = new MemoryStream();
            var meta = Encoding.UTF8.GetBytes("StreamTitle='NoorMD – Self-test tune';");
            var metaLen = (meta.Length + 15) / 16;
            for (var off = 0; off < sound.Length; off += metaInt)
            {
                icy.Write(sound, off, Math.Min(metaInt, sound.Length - off));
                if (off + metaInt >= sound.Length) break;
                if (off == 0) { icy.WriteByte((byte)metaLen); icy.Write(meta); icy.Write(new byte[metaLen * 16 - meta.Length]); } else icy.WriteByte(0);
            }
            var upstream = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
            upstream.Start();
            var upPort = ((System.Net.IPEndPoint)upstream.LocalEndpoint).Port;
            var station = Task.Run(async () =>
            {
                for (var n = 0; n < 4; n++) // the page may connect more than once
                {
                    using var c = await upstream.AcceptTcpClientAsync();
                    var st = c.GetStream();
                    await st.ReadAsync(new byte[4096]);
                    await st.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nicy-metaint: {metaInt}\r\nConnection: close\r\n\r\n"));
                    await st.WriteAsync(icy.ToArray());
                    await Task.Delay(6000); // a live station keeps sending; ending at once would read as "stopped"
                }
            });
            await Eval($"NoorRadio._testPlay('http://127.0.0.1:{upPort}/live')");
            var rs = "";
            for (var i = 0; i < 60; i++)
            {
                await Task.Delay(100);
                rs = await Eval("(() => { const s = NoorRadio._state(); return JSON.stringify({ state: s.on && s.on.state, title: s.on && s.on.title, message: s.on && s.on.message }); })()");
                if (rs.Contains("Self-test tune") && rs.Contains("playing")) break;
            }
            Check("NoorRadio: a station plays through the loopback relay and its song title arrives", rs.Contains("playing") && rs.Contains("Self-test tune"), rs);
            await Eval("NoorRadio.stop()");
            upstream.Stop();
        }

        // NoorSound: a preset renders in the app and the page plays the preview (a WAV served from memory).
        {
            await Eval("NoorSound.open()");
            var sb = "";
            for (var i = 0; i < 60; i++)
            {
                await Task.Delay(100);
                sb = await Eval("(() => { const s = NoorSound._state(); return s.render ? JSON.stringify({ url: s.render.url, seconds: s.render.seconds, peak: s.render.peakDb, rms: s.render.rmsDb }) : ''; })()");
                if (sb.Contains("_sound")) break;
            }
            await Eval("window.__sbd = null; (() => { const a = new Audio(); a.muted = true; a.onloadedmetadata = () => window.__sbd = a.duration; a.onerror = () => window.__sbd = 'error ' + (a.error && a.error.code); a.src = NoorSound._state().render.url; })()");
            var dur = "null";
            for (var i = 0; i < 40 && dur == "null"; i++) { await Task.Delay(100); dur = await Eval("window.__sbd"); }
            Check("NoorSound: a preset renders and the page can play its preview", sb.Contains("_sound") && double.TryParse(dur, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var sbSeconds) && Math.Abs(sbSeconds - 20) < 0.1, $"{sb} duration {dur}");
            await Eval("NoorSound.close()");
            // Modulation through the app: the engine preset's Motor RPM control, at idle and turned up.
            await Eval(@"window.__sbk = null; (async () => {
                try {
                    const r = await NoorBridge.request('sound.preset', { id: 'machine-engine' });
                    const idle = await NoorBridge.request('sound.render', { recipe: r });
                    r.knobs[0].value = 1;
                    const revved = await NoorBridge.request('sound.render', { recipe: r });
                    const spec = revved.feedback.spectrogram;
                    const hall = await NoorBridge.request('sound.preset', { id: 'walk-hall' });
                    const withBus = await NoorBridge.request('sound.render', { recipe: hall });
                    hall.buses[0].mute = true;
                    const noBus = await NoorBridge.request('sound.render', { recipe: hall });
                    const pluck = await NoorBridge.request('sound.render', { recipe: await NoorBridge.request('sound.preset', { id: 'pluck-string' }) });
                    const bell = await NoorBridge.request('sound.render', { recipe: await NoorBridge.request('sound.preset', { id: 'bell-church' }) });
                    window.__sbk = JSON.stringify({ knob: r.knobs[0].name, routes: r.routes.length, idle: idle.rmsDb, revved: revved.rmsDb, same: idle.url === revved.url,
                        lufsIdle: idle.feedback.lufs, lufsRevved: revved.feedback.lufs, tp: revved.feedback.truePeakDb, spec: atob(spec.data).length === spec.columns * spec.rows && spec.rows === 96,
                        hallSends: hall.layers.filter((l) => (l.sends || []).length).length, hallWet: withBus.feedback.lufs, hallDry: noBus.feedback.lufs,
                        pluck: pluck.feedback.lufs, pluckBright: pluck.feedback.centroidHz, bell: bell.feedback.lufs, bellWidth: bell.feedback.width, bellWarnings: bell.warnings.length });
                } catch (e) { window.__sbk = 'error ' + e.message; } })()");
            var sbk = "null";
            for (var i = 0; i < 80 && sbk == "null"; i++) { await Task.Delay(100); sbk = await Eval("window.__sbk"); }
            var knobOk = false;
            try
            {
                using var kd = System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Deserialize<string>(sbk) ?? "{}");
                var ke = kd.RootElement;
                knobOk = ke.GetProperty("knob").GetString() == "Motor RPM" && ke.GetProperty("routes").GetInt32() == 5 && !ke.GetProperty("same").GetBoolean()
                    && ke.GetProperty("revved").GetDouble() > ke.GetProperty("idle").GetDouble() + 1.5
                    && ke.GetProperty("lufsRevved").GetDouble() > ke.GetProperty("lufsIdle").GetDouble() + 1 && ke.GetProperty("lufsIdle").GetDouble() is > -40 and < -5
                    && ke.GetProperty("tp").GetDouble() <= 0 && ke.GetProperty("spec").GetBoolean()
                    && ke.GetProperty("hallSends").GetInt32() == 2 && ke.GetProperty("hallWet").GetDouble() > ke.GetProperty("hallDry").GetDouble() + 1
                    && ke.GetProperty("pluck").GetDouble() is > -30 and < -10 && ke.GetProperty("pluckBright").GetDouble() is > 200 and < 4000
                    && ke.GetProperty("bell").GetDouble() is > -30 and < -10 && ke.GetProperty("bellWidth").GetDouble() > 0.05 && ke.GetProperty("bellWarnings").GetInt32() == 0;
            }
            catch (Exception) { knobOk = false; }
            Check("NoorSound: a control (Motor RPM) moves the sound, the meters and spectrogram show it, a reverb bus is heard and a string resonator rings and a bell sounds inside a church", knobOk, sbk);
            // A WAV of your own as a layer: read when it was picked, refused when nobody picked it.
            var wavPath = Path.Combine(SelfTestDir!, "Sound sample.wav");
            await File.WriteAllBytesAsync(wavPath, SoundEngine.Render(SoundPresets.Make("hit-metal"), 44100).ToWav());
            var withSample = new SoundRecipe { Duration = 1, Loop = false, Layers = [new SoundLayer { Type = "sample", Path = wavPath, SampleName = "Sound sample.wav", Gain = 0, Semitones = -5 }] }; // (backwards, the first second would be the clang's quiet tail)
            var notPicked = SoundEngine.Render(withSample, 48000, LoadSample);
            _soundSampleFiles.Add(Path.GetFullPath(wavPath));
            var used = SoundEngine.Render(withSample, 48000, LoadSample);
            Check("NoorSound: a WAV of your own plays as a layer only once you picked it", notPicked.Warnings.Count == 1 && used.Warnings.Count == 0 && used.RmsDb > -40,
                $"not picked: {string.Join("; ", notPicked.Warnings)} used: {used.RmsDb} dB");
            // Grains and stretch through the same file; the region editor's waveform only for a picked file.
            withSample.Layers[0].PlayMode = "grains"; withSample.Layers[0].Position = 0.1;
            var grains = SoundEngine.Render(withSample, 48000, LoadSample);
            withSample.Layers[0].PlayMode = "stretch"; withSample.Layers[0].Speed = 0.5;
            var stretched = SoundEngine.Render(withSample, 48000, LoadSample);
            var wavJs = System.Text.Json.JsonSerializer.Serialize(wavPath);
            var notPickedPath = Path.Combine(SelfTestDir!, "never picked.wav");
            File.Copy(wavPath, notPickedPath, true); // there, readable, but nobody picked it
            var otherJs = System.Text.Json.JsonSerializer.Serialize(notPickedPath);
            await Eval($@"window.__sbp = null; (async () => {{
                const r = {{}};
                try {{ const w = await NoorBridge.request('sound.sample.peaks', {{ path: {wavJs} }}); r.seconds = w.seconds; r.peaks = w.peaks.length; }} catch (e) {{ r.error = e.message; }}
                try {{ await NoorBridge.request('sound.sample.peaks', {{ path: {otherJs} }}); r.other = 'read'; }} catch (e) {{ r.other = 'refused'; }}
                window.__sbp = JSON.stringify(r); }})()");
            var sbp = "null";
            for (var i = 0; i < 40 && sbp == "null"; i++) { await Task.Delay(100); sbp = await Eval("window.__sbp"); }
            Check("NoorSound: samples play as grains or stretched, and only a picked file's waveform is shown", grains.RmsDb > -45 && grains.Warnings.Count == 0 && stretched.RmsDb > -45
                && sbp.Contains("\\\"peaks\\\":1200") && sbp.Contains("refused"), $"grains {grains.RmsDb} dB, stretched {stretched.RmsDb} dB, {sbp}");
        }

        // NoorSequencer: a template renders in the app (the loop wrapped), the page can play it, and MIDI is written.
        {
            await Eval(@"window.__seq = null; (async () => {
                try {
                    const song = await NoorBridge.request('seq.template', { id: 'arcade' });
                    const out = await NoorBridge.request('seq.render', { song, loop: true });
                    const a = new Audio(); a.muted = true;
                    a.onloadedmetadata = () => window.__seq = JSON.stringify({ url: out.url, seconds: out.seconds, duration: a.duration, bars: out.toBar - out.fromBar, bar: out.barSeconds });
                    a.onerror = () => window.__seq = 'error ' + (a.error && a.error.code);
                    a.src = out.url;
                } catch (e) { window.__seq = 'error ' + e.message; } })()");
            var seq = "null";
            for (var i = 0; i < 100 && seq == "null"; i++) { await Task.Delay(100); seq = await Eval("window.__seq"); }
            var arcade = SongTemplates.Make("arcade")!;
            var loopSeconds = (arcade.LoopEnd - arcade.LoopStart) * arcade.BarSeconds;
            var seqDuration = System.Text.RegularExpressions.Regex.Match(seq, @"duration\\"":([0-9.]+)").Groups[1].Value;
            Check("NoorSequencer: a template's loop renders in the app and the page can play it (the loop's exact length)", seq.Contains("_sound")
                && double.TryParse(seqDuration, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var seqSeconds) && Math.Abs(seqSeconds - loopSeconds) < 0.05, seq);
            var midi = SequencerEngine.ToMidi(arcade);
            Check("NoorSequencer: MIDI is a type 1 file with a track for each track", midi.Length > 200 && midi[0] == (byte)'M' && midi[9] == 1 && midi[11] == arcade.Tracks.Count + 1);
            // Adaptive layers render at one shared level and length, and OGG encodes (smaller than WAV).
            var adaptive = SongTemplates.Make("adaptive")!;
            var layerRenders = SequencerEngine.RenderLayers(adaptive, 44100);
            var ogg = SoundOgg.Encode(layerRenders[0].Render, 0.5, adaptive.Name, loop: true);
            Check("NoorSequencer: adaptive layers and an OGG loop", layerRenders.Count == 3 && layerRenders.All(l => l.Render.Left.Length == layerRenders[0].Render.Left.Length)
                && ogg.Length > 1000 && ogg[0] == (byte)'O' && ogg[1] == (byte)'g' && ogg.Length < layerRenders[0].Render.Left.Length * 2, $"{ogg.Length} bytes");
        }

        // NoorMaterial: a material renders in the app, its maps are served to the page and load as pictures.
        {
            await Eval(@"window.__tex = null; (async () => {
                try {
                    const r = await NoorBridge.request('texture.preset', { id: 'bricks-red' });
                    const out = await NoorBridge.request('texture.render', { recipe: r, size: 256 });
                    const sizes = await Promise.all(['albedo', 'normal', 'height'].map((m) => new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(-1); i.src = out.maps[m]; })));
                    window.__tex = JSON.stringify({ size: out.size, sizes, layers: r.layers.length });
                } catch (e) { window.__tex = 'error ' + e.message; } })()");
            var tex = "null";
            for (var i = 0; i < 80 && tex == "null"; i++) { await Task.Delay(100); tex = await Eval("window.__tex"); }
            Check("NoorMaterial: a material renders and its maps load in the page", tex.Contains("\\\"sizes\\\":[256,256,256]") && tex.Contains("\\\"size\\\":256"), tex);
            // A full set for Unreal at 512 writes valid PNGs (DirectX normal, ORM).
            var maps = TextureEngine.Render(TexturePresets.Make("metal-rusty"), 512);
            var orm = maps.Packed("ao", "roughness", "metallic");
            Check("NoorMaterial: maps are written as PNG files", orm.Length > 1000 && orm[1] == (byte)'P' && maps.Png("height").Length > 1000 && maps.Png("normal", directX: true).Length > 1000);
            var manifest = JsonSerializer.Serialize(TextureManifest(new TextureRecipe { Name = "Rust", TileMetres = 3, HeightCm = 8 }.Clamped(), maps, ["rust_albedo.png", "rust_height.png"], [("albedo", "albedo"), ("height", "height")], "rust.noortex.json"));
            Check("NoorMaterial: the manifest gives the real-world size, the height's range and the albedo brightness",
                manifest.Contains("\"tileMetres\":3") && manifest.Contains("\"heightRangeCm\":8") && manifest.Contains("\"albedoLuminance\":") && manifest.Contains("\"pixelsPerMetre\":170.6667"), manifest);
            // A photo as a layer: decoded by Windows, read only once picked; an unpicked one (there, readable) is refused.
            var photoPath = Path.Combine(SelfTestDir!, "Texture photo.png");
            var photoNotPicked = Path.Combine(SelfTestDir!, "Texture photo, not picked.png");
            await File.WriteAllBytesAsync(photoPath, maps.Png("albedo"));
            File.Copy(photoPath, photoNotPicked, true);
            _textureImageFiles.Add(Path.GetFullPath(photoPath));
            TextureMaps WithPhoto(string path) => TextureEngine.Render(new TextureRecipe { Layers = [new TextureLayer { Type = "image", Path = path, ImageName = Path.GetFileName(path), SeamBlend = 0.2, Delight = 0.5 }] }.Clamped(), 256, LoadTextureImage);
            var photoUsed = WithPhoto(photoPath);
            var photoRefused = WithPhoto(photoNotPicked);
            Check("NoorMaterial: a picked photo becomes a layer, one nobody picked is refused", photoUsed.Warnings.Count == 0 && photoUsed.Height.Max() - photoUsed.Height.Min() > 0.3 && photoRefused.Warnings.Count == 1,
                $"used: {string.Join("; ", photoUsed.Warnings)} range {photoUsed.Height.Max() - photoUsed.Height.Min():0.00}; refused: {photoRefused.Warnings.Count}");
            // A painting made in NoorSketch (a .noorsketch with transparency) goes on the material only where it is painted.
            var paintingPath = Path.Combine(SelfTestDir!, "Texture painting.noorsketch");
            var art = new byte[64 * 64 * 4];
            for (var y = 0; y < 32; y++) for (var x = 0; x < 32; x++) { var i = (y * 64 + x) * 4; art[i] = 230; art[i + 1] = 20; art[i + 2] = 20; art[i + 3] = 255; }
            NoorMD.Core.Sketch.SketchFile.Save(paintingPath, PngWriter.Rgba(64, 64, art), "transparent");
            _textureImageFiles.Add(paintingPath);
            var painted = TextureEngine.Render(new TextureRecipe
            {
                Layers = [new TextureLayer { Type = "painted", Path = paintingPath, ColorAmount = 1, Opacity = 0 }],
                Surface = new TextureSurface { Ramp = [new() { Pos = 0, Color = "#808080" }, new() { Pos = 1, Color = "#808080" }], ColorVariation = 0, Dirt = 0 },
            }.Clamped(), 128, LoadTextureImage);
            int Red(int x, int y) => painted.Albedo[(y * 128 + x) * 3];
            // Batch PBR from albedo textures: a PNG albedo read the real way comes out as the albedo unchanged.
            var albedoSrc = TextureEngine.Render(TexturePresets.Make("stone-cobbles"), 128);
            var albedoPath = Path.Combine(SelfTestDir!, "Texture albedo.png");
            File.WriteAllBytes(albedoPath, albedoSrc.Png("albedo"));
            _textureImageFiles.Add(albedoPath);
            var fromAlbedo = TextureEngine.Render(new TextureRecipe
            {
                Layers = [new TextureLayer { Type = "image", Path = albedoPath, ScaleX = 1, ScaleY = 1, SeamBlend = 0, Delight = 0, ColorAmount = 1 }],
                Surface = new TextureSurface { Dirt = 0, ColorVariation = 0 },
            }.Clamped(), 128, LoadTextureImage);
            var albedoOff = Enumerable.Range(0, albedoSrc.Albedo.Length).Max(i => Math.Abs(fromAlbedo.Albedo[i] - albedoSrc.Albedo[i]));
            Check("NoorMaterial: batch PBR keeps an albedo texture's colours exactly and adds relief", fromAlbedo.Warnings.Count == 0 && albedoOff <= 2 && fromAlbedo.Height.Max() - fromAlbedo.Height.Min() > 0.2,
                $"largest difference {albedoOff}; {string.Join("; ", fromAlbedo.Warnings)}");
            Check("NoorMaterial: a NoorSketch painting goes on the material where it is painted (transparent elsewhere)", painted.Warnings.Count == 0 && Red(20, 20) > 200 && Red(100, 100) is > 110 and < 145,
                $"{string.Join("; ", painted.Warnings)} painted {Red(20, 20)}, elsewhere {Red(100, 100)}");
        }

        // NoorSprite: drawn on in WebView2 (pointer events on its canvas), the sprite read by the app as a .noorsprite and an .aseprite file.
        {
            await Eval(@"window.__sp = null; (async () => {
                try {
                    await NoorSprite.open();
                    const cv = document.querySelector('#sp-canvas');
                    const at = NoorSprite._screen(3, 4);
                    const ev = (t) => new PointerEvent(t, { clientX: at.x, clientY: at.y, button: 0, buttons: 1, pointerId: 7, bubbles: true });
                    cv.dispatchEvent(ev('pointerdown')); cv.dispatchEvent(ev('pointerup'));
                    window.__sp = JSON.stringify({ px: NoorSprite._pixel(3, 4, 0, 0), wire: NoorSprite._wire() });
                    NoorSprite.close();
                } catch (e) { window.__sp = 'error ' + e.message; } })()");
            var sp = "null";
            for (var i = 0; i < 50 && sp == "null"; i++) { await Task.Delay(100); sp = await Eval("window.__sp"); }
            string drawn = "", files = "";
            var ok = false;
            try
            {
                using var j = JsonDocument.Parse(JsonSerializer.Deserialize<string>(sp) ?? "{}");
                drawn = j.RootElement.GetProperty("px").GetRawText();
                var doc = NoorMD.Core.Sprite.SpriteDoc.FromJson(j.RootElement.GetProperty("wire").GetRawText());
                var again = NoorMD.Core.Sprite.SpriteFile.FromBytes(NoorMD.Core.Sprite.SpriteFile.ToBytes(doc));
                var (ase, _) = NoorMD.Core.Sprite.AsepriteFile.Read(NoorMD.Core.Sprite.AsepriteFile.Write(doc));
                var cel = again.Cels.Single();
                files = $"{doc.Width}x{doc.Height}, cel {cel.X},{cel.Y} {cel.Width}x{cel.Height}, aseprite {ase.Cels.Count} cel";
                ok = drawn == "[0,0,0,255]" && cel is { X: 3, Y: 4, Width: 1, Height: 1 } && ase.Cels.Single().Pixels().SequenceEqual(cel.Pixels());
            }
            catch (Exception ex) { files = ex.Message; }
            Check("NoorSprite: a pixel drawn in WebView2 is kept by the app as a .noorsprite and an .aseprite file", ok, $"{sp[..Math.Min(sp.Length, 120)]} → {drawn} · {files}");
        }

        // Voice notes: the microphone is refused unless Record was just pressed; a recording made in the page is saved and linked.
        await Eval(@"window.__vt = null; (async () => {
            let denied = '?'; try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); denied = 'allowed'; } catch (e) { denied = e.name; }
            const ctx = new AudioContext(); const osc = ctx.createOscillator(); const dest = ctx.createMediaStreamDestination(); osc.connect(dest); osc.start(); await ctx.resume();
            const mr = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' }); const chunks = []; mr.ondataavailable = e => chunks.push(e.data);
            const stopped = new Promise(r => mr.onstop = r); mr.start(200); await new Promise(r => setTimeout(r, 1200)); mr.stop(); await stopped; osc.stop(); ctx.close();
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const b64 = await new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(blob); });
            const t = (await NoorBridge.request('voice.begin', { name: 'NoorMD self-test', ext: '.webm' })).token;
            await NoorBridge.request('voice.chunk', { token: t, data: b64 });
            const r = await NoorBridge.request('voice.finish', { token: t, seconds: 1.2 });
            window.__vt = JSON.stringify({ path: r.path, link: r.link, size: blob.size, denied });
          })().catch(e => window.__vt = JSON.stringify({ error: String(e) }))");
        var vt = "null";
        for (var i = 0; i < 60 && vt == "null"; i++) { await Task.Delay(200); vt = await Eval("window.__vt"); }
        var voice = System.Text.Json.JsonDocument.Parse(JsonSerializer.Deserialize<string>(vt) ?? "{}").RootElement;
        // Without a microphone (CI) Chromium answers "no device" before asking for permission, so either answer means "not used".
        Check("voice notes: the page can't use the microphone unless Record was pressed", voice.TryGetProperty("denied", out var dn) && dn.GetString() is "NotAllowedError" or "NotFoundError", vt);
        var voicePath = voice.TryGetProperty("path", out var vp) ? vp.GetString() : null;
        var head = voicePath != null && File.Exists(voicePath) ? File.ReadAllBytes(voicePath).Take(4).ToArray() : [];
        Check("…a recording is saved as a real WebM file, with a link to it", head.SequenceEqual(new byte[] { 0x1A, 0x45, 0xDF, 0xA3 }) && voice.GetProperty("link").GetString()!.Contains("NoorMD self-test"), vt);
        if (voicePath != null && File.Exists(voicePath)) File.Delete(voicePath);

        var status = await PageRequest("mic.status", "{}");
        Check("the page reads Mic Guard's state (off until switched on)", status.Contains("\"verdict\":\"notsetup\"") && status.Contains("\"windows\":false") && status.Contains("\"devices\":["), status.Length > 300 ? status[..300] : status);
    }

    private async Task RunVideoSelfTestAsync()
    {
        var dir = Path.Combine(SelfTestDir!, "video");
        if (!Directory.Exists(dir) || !Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories).Any()) { Check("video self-test (no fixtures provided — skipped)", true); return; }
        var folder = Videos.AddFolder(dir);
        var scan = await Task.Run(() => Videos.Scan(folder));
        Check("video folder indexed", scan.Found >= 1, $"{scan.Found} found");
        await Eval("NoorVideo.open()");
        await Task.Delay(800);
        foreach (var v in Videos.Series().SelectMany(s => Videos.Episodes(s.Key)))
        {
            await Eval($"NoorVideo.select({v.Id}, {{ autoplay: true }})");
            await Task.Delay(2200);
            var ok = await Eval("(() => { const v = document.querySelector('#vb-video'); const r = v.getBoundingClientRect(); return !v.paused && v.currentTime > 0.3 && v.videoWidth > 0 && r.height > 120 && r.width > 200; })()") == "true";
            Check($"WebView2 plays {Path.GetExtension(v.Path)} video served by NoorMD", ok, await Eval("(() => { const v = document.querySelector('#vb-video'); const r = v.getBoundingClientRect(); return JSON.stringify([v.currentTime, v.videoWidth, v.error && v.error.code, Math.round(r.width), Math.round(r.height)]); })()"));
            var subs = NoorMD.Media.SubtitleConverter.Find(v.Path);
            if (subs.Count > 0)
                Check($"subtitles of {v.FileName} load as WebVTT cues", await Eval("(() => { const t = document.querySelector('#vb-video').textTracks[0]; return !!t && t.mode === 'showing' && !!t.cues && t.cues.length > 0; })()") == "true");
            if (v.FileName.Contains("dual audio", StringComparison.OrdinalIgnoreCase))
            {
                // Needs --enable-blink-features=AudioVideoTracks on the WebView2 environment.
                var audio = await Eval("(() => { const v = document.querySelector('#vb-video'); const s = document.querySelector('#vb-audio'); if (!v.audioTracks || v.audioTracks.length !== 2 || !s) return 'tracks=' + (v.audioTracks ? v.audioTracks.length : 'none'); s.value = '1'; s.dispatchEvent(new Event('change')); return v.audioTracks[1].enabled && !v.audioTracks[0].enabled ? 'ok' : 'switch failed'; })()");
                Check("a video with two audio tracks offers them and switches", audio == "\"ok\"" || audio == "ok", audio);
            }
        }
        // Pop-out player: a separate window that shows the picture right away (no resize needed).
        var first = Videos.Series().SelectMany(se => Videos.Episodes(se.Key)).First();
        _videoWindow = new VideoWindow(this);
        _videoWindow.Show();
        _videoWindow.Play(first.Id, 0.5, false);
        var vw = _videoWindow;
        string pv = "";
        for (var i = 0; i < 30; i++) { await Task.Delay(200); try { pv = await vw.EvalAsync("JSON.stringify([window.innerWidth, window.innerHeight, document.querySelector('#pv').videoWidth, document.querySelector('#pv').currentTime])"); } catch { } if (pv.Contains(",160,")) break; }
        await Task.Delay(800);
        try { pv = await vw.EvalAsync("JSON.stringify([window.innerWidth, window.innerHeight, document.querySelector('#pv').videoWidth, document.querySelector('#pv').currentTime])"); } catch { }
        var parts = JsonSerializer.Deserialize<string>(pv)?.Trim('[', ']').Split(',') ?? [];
        Check("the pop-out video window shows the video at its size and plays", parts.Length == 4 && double.Parse(parts[0], System.Globalization.CultureInfo.InvariantCulture) > 300 && parts[2] == "160" && double.Parse(parts[3], System.Globalization.CultureInfo.InvariantCulture) > 0.5, pv);
        vw.Close();
        await Task.Delay(300);
        await Capture("screenshot-video.png");
        await Eval("NoorVideo.close()");
        var saved = Videos.ContinueWatching().Count + Videos.Series().Sum(s => s.Watched);
        Check("video positions are saved", saved > 0);
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
        // Any bridge request that failed during the run is a bug even if the visible checks passed.
        try
        {
            var logFile = Path.Combine(App.Paths.Logs, "noormd.log");
            var bridgeErrors = File.Exists(logFile)
                ? File.ReadAllLines(logFile).Where(l => l.Contains("[ERROR] Bridge request", StringComparison.Ordinal) || l.Contains("[ERROR] Rejected bridge", StringComparison.Ordinal)).ToList()
                : [];
            Check("no bridge request failed during the self-test", bridgeErrors.Count == 0, string.Join(" | ", bridgeErrors.Take(3)));
        }
        catch (Exception ex) { Check("log readable", false, ex.Message); }

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
        foreach (var s in _tabs.Values) s.Dirty = false;
        Application.Current.Shutdown(passed ? 0 : 1);
    }
}
