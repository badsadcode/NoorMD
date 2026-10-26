using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using NoorMD.Core;
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
