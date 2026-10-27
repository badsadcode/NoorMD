using System.Text;
using System.Text.Json;
using NoorMD.Core.Bridge;
using NoorMD.Core.Documents;
using NoorMD.Core.Export;
using NoorMD.Core.Recovery;
using NoorMD.Core.Security;
using NoorMD.Core.Settings;
using NoorMD.Core.Snapshots;
using Xunit;

namespace NoorMD.Core.Tests;

public sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "noormd-tests-" + Guid.NewGuid().ToString("N"));
    public TempDir() => Directory.CreateDirectory(Path);
    public string File(string name) => System.IO.Path.Combine(Path, name);
    public void Dispose() { try { Directory.Delete(Path, true); } catch { } }
}

public class TextFileCodecTests
{
    [Fact]
    public void Utf8_Polish_RoundTripsByteForByte()
    {
        var original = "# Zażółć gęślą jaźń\n\n```cs\nvar ą = 1;\n```\n";
        var bytes = new UTF8Encoding(false).GetBytes(original);
        var d = TextFileCodec.Decode(bytes);
        Assert.Equal(original, d.Text);
        Assert.Equal(TextFormat.Default, d.Format);
        Assert.Null(d.Warning);
        Assert.Equal(bytes, TextFileCodec.Encode(d.Text, d.Format));
    }

    [Fact]
    public void Crlf_And_Bom_ArePreserved()
    {
        var bytes = new byte[] { 0xEF, 0xBB, 0xBF }.Concat(Encoding.UTF8.GetBytes("a\r\nb\r\n")).ToArray();
        var d = TextFileCodec.Decode(bytes);
        Assert.Equal("a\nb\n", d.Text);
        Assert.True(d.Format.Bom);
        Assert.Equal(LineEnding.CRLF, d.Format.Eol);
        Assert.Equal(bytes, TextFileCodec.Encode("a\nb", d.Format)); // final newline restored too
    }

    [Fact]
    public void MissingFinalNewline_StaysMissing()
    {
        var d = TextFileCodec.Decode(Encoding.UTF8.GetBytes("no newline"));
        Assert.False(d.Format.FinalNewline);
        Assert.Equal("no newline", Encoding.UTF8.GetString(TextFileCodec.Encode("no newline", d.Format)));
    }

    [Fact]
    public void Utf16_IsDetected()
    {
        var bytes = Encoding.Unicode.GetPreamble().Concat(Encoding.Unicode.GetBytes("ż\n")).ToArray();
        var d = TextFileCodec.Decode(bytes);
        Assert.Equal("ż\n", d.Text);
        Assert.Equal("UTF-16 LE", d.Format.EncodingName);
        Assert.Equal(bytes, TextFileCodec.Encode(d.Text, d.Format));
    }

    [Fact]
    public void InvalidUtf8_FallsBackToWindows1252_WithWarning()
    {
        var bytes = new byte[] { (byte)'c', (byte)'a', (byte)'f', 0xE9, (byte)'\n' }; // "café" in Windows-1252
        var d = TextFileCodec.Decode(bytes);
        Assert.Equal("café\n", d.Text);
        Assert.NotNull(d.Warning);
    }

    [Fact]
    public void BinaryFile_IsRejected() =>
        Assert.Throws<InvalidDataException>(() => TextFileCodec.Decode([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00]));

    [Fact]
    public void WordCount() => Assert.Equal(4, TextFileCodec.CountWords("  one two\nthree\tfour "));
}

public class AtomicFileTests
{
    [Fact]
    public void Write_Replaces_And_Backs_Up()
    {
        using var t = new TempDir();
        var f = t.File("doc.md");
        File.WriteAllText(f, "old");
        var backup = t.File("backups/doc.bak");
        AtomicFile.WriteAllBytes(f, Encoding.UTF8.GetBytes("new"), backup);
        Assert.Equal("new", File.ReadAllText(f));
        Assert.Equal("old", File.ReadAllText(backup));
        Assert.Empty(Directory.GetFiles(t.Path, "*.noormd-tmp"));
    }

    [Fact]
    public void Write_CreatesNewFile()
    {
        using var t = new TempDir();
        var f = t.File("sub/new.md");
        AtomicFile.WriteAllBytes(f, Encoding.UTF8.GetBytes("x"));
        Assert.Equal("x", File.ReadAllText(f));
    }

    [Fact]
    public void ReadOnlyTarget_IsNotOverwritten()
    {
        using var t = new TempDir();
        var f = t.File("ro.md");
        File.WriteAllText(f, "keep");
        File.SetAttributes(f, FileAttributes.ReadOnly);
        try
        {
            Assert.Throws<UnauthorizedAccessException>(() => AtomicFile.WriteAllBytes(f, Encoding.UTF8.GetBytes("lost")));
            Assert.Equal("keep", File.ReadAllText(f));
            Assert.Empty(Directory.GetFiles(t.Path, "*.noormd-tmp"));
        }
        finally { File.SetAttributes(f, FileAttributes.Normal); }
    }

    [Fact]
    public void DocumentFile_SaveAndLoad_PreservesFormat()
    {
        using var t = new TempDir();
        var f = t.File("crlf.md");
        File.WriteAllBytes(f, Encoding.UTF8.GetBytes("# T\r\n\r\nżółw\r\n"));
        var doc = DocumentFile.Load(f);
        DocumentFile.Save(f, doc.Markdown + "more\n", doc.Format, null);
        Assert.Equal("# T\r\n\r\nżółw\r\nmore\r\n", Encoding.UTF8.GetString(File.ReadAllBytes(f)));
    }

    [Theory]
    [InlineData("My: notes?", "My- notes-.md")]
    [InlineData("   ", "Untitled document.md")]
    [InlineData("CON", "CON-document.md")]
    public void SafeFileName(string title, string expected) => Assert.Equal(expected, DocumentFile.SafeFileName(title));
}

public class RecoveryStoreTests
{
    private const string TabA = "a1b2c3d4e5f60718";
    private const string TabB = "0f1e2d3c4b5a6978";

    [Fact]
    public void LiveSession_IsNotOrphan_ButEndedSessionIs()
    {
        using var t = new TempDir();
        var a = new RecoveryStore(t.Path);
        a.SaveOwn(TabA, "draft text", "Doc", null, TextFormat.Default);
        using var b = new RecoveryStore(t.Path);
        Assert.Empty(b.ListOrphans()); // a still running

        a.Dispose(); // a "crashed" (lock released, draft left behind)
        var orphans = b.ListOrphans();
        Assert.Single(orphans);
        Assert.Equal(2, orphans[0].Words);
        Assert.Equal("draft text", b.LoadOrphan(orphans[0].Id)!.Markdown);
        Assert.True(b.DiscardOrphan(orphans[0].Id));
        Assert.Empty(b.ListOrphans());
    }

    [Fact]
    public void Each_Tab_Has_Its_Own_Draft_And_Crash_Recovers_Them_Separately()
    {
        using var t = new TempDir();
        var crashed = new RecoveryStore(t.Path);
        crashed.SaveOwn(TabA, "first untitled", "Untitled document", null, TextFormat.Default);
        crashed.SaveOwn(TabB, "second untitled", "Untitled document", null, TextFormat.Default);
        crashed.SaveOwn(TabA, "first untitled, edited", "Untitled document", null, TextFormat.Default); // overwrites only tab A
        Assert.Equal(2, crashed.OwnDraftCount);
        crashed.Dispose();

        using var next = new RecoveryStore(t.Path);
        var orphans = next.ListOrphans();
        Assert.Equal(2, orphans.Count);
        var texts = orphans.Select(o => next.LoadOrphan(o.Id)!.Markdown).OrderBy(x => x).ToList();
        Assert.Equal(["first untitled, edited", "second untitled"], texts);
    }

    [Fact]
    public void Deleting_One_Tab_Draft_Leaves_The_Others()
    {
        using var t = new TempDir();
        using var a = new RecoveryStore(t.Path);
        a.SaveOwn(TabA, "x", null, null, TextFormat.Default);
        a.SaveOwn(TabB, "y", null, null, TextFormat.Default);
        a.DeleteOwn(TabA);
        Assert.False(a.HasOwnDraft(TabA));
        Assert.True(a.HasOwnDraft(TabB));
        Assert.Empty(a.ListOrphans());
        Assert.False(a.DiscardOrphan($"{a.SessionId}-{TabB}")); // own drafts are never discardable as orphans
    }

    [Fact]
    public void Legacy_Single_Draft_From_Older_Versions_Is_Still_Offered()
    {
        using var t = new TempDir();
        var legacyId = Guid.NewGuid().ToString("N");
        File.WriteAllText(Path.Combine(t.Path, legacyId + ".json"), $$"""{"id":"{{legacyId}}","markdown":"old draft","savedUtc":"2026-10-01T10:00:00Z"}""");
        using var s = new RecoveryStore(t.Path);
        Assert.Equal(legacyId, s.ListOrphans().Single().Id);
        Assert.Equal("old draft", s.LoadOrphan(legacyId)!.Markdown);
    }

    [Theory]
    [InlineData("../../etc/passwd")]
    [InlineData("")]
    [InlineData("0123456789abcdef0123456789abcdeZ")]
    [InlineData("0123456789abcdef0123456789abcdef-../x")]
    [InlineData("0123456789abcdef0123456789abcdef-")]
    public void InvalidIds_AreRejected(string id)
    {
        using var t = new TempDir();
        using var a = new RecoveryStore(t.Path);
        Assert.Null(a.LoadOrphan(id));
        Assert.False(a.DiscardOrphan(id));
        Assert.Throws<ArgumentException>(() => a.SaveOwn("../x", "m", null, null, TextFormat.Default));
    }
}

public class SnapshotStoreTests
{
    [Fact]
    public void Create_List_Get_Delete_And_Merge()
    {
        using var t = new TempDir();
        var store = new SnapshotStore(t.Path);
        var untitled = SnapshotStore.KeyForUntitled(Guid.NewGuid().ToString("N"));
        var s1 = store.Create(untitled, "one two", "first", "Doc", null);
        store.Create(untitled, "three", "second", "Doc", null);
        Assert.Equal(["second", "first"], store.List(untitled).Select(s => s.Label));
        Assert.Equal("one two", store.Get(untitled, s1.Id)!.Markdown);

        var key = SnapshotStore.KeyForPath(t.File("doc.md"));
        store.Merge(untitled, key, t.File("doc.md"));
        Assert.Empty(store.List(untitled));
        Assert.Equal(2, store.List(key).Count);
        Assert.True(store.Delete(key, s1.Id));
        Assert.Single(store.List(key));

        var reopened = new SnapshotStore(t.Path); // survives "restart"
        Assert.Single(reopened.List(key));
    }

    [Fact]
    public void Caps_At_Max()
    {
        using var t = new TempDir();
        var store = new SnapshotStore(t.Path);
        for (int i = 0; i < SnapshotStore.MaxPerDocument + 5; i++) store.Create("doc-abc", "x" + i, "s" + i, null, null);
        Assert.Equal(SnapshotStore.MaxPerDocument, store.List("doc-abc").Count);
    }

    [Fact]
    public void Key_Injection_IsRejected() =>
        Assert.Throws<ArgumentException>(() => new SnapshotStore(Path.GetTempPath()).List("../x"));
}

public class AssetResolverTests
{
    [Fact]
    public void Serves_App_And_Document_Images_Only()
    {
        using var web = new TempDir();
        using var doc = new TempDir();
        File.WriteAllText(web.File("index.html"), "<html>");
        Directory.CreateDirectory(web.File("js"));
        File.WriteAllText(web.File("js/app.js"), "");
        Directory.CreateDirectory(doc.File("img"));
        File.WriteAllText(doc.File("img/a b.png"), "png");
        File.WriteAllText(doc.File("secret.txt"), "no");

        Assert.Equal(web.File("index.html"), AssetResolver.Resolve(new Uri("https://noormd.local/"), web.Path, doc.Path));
        Assert.Equal(Path.GetFullPath(web.File("js/app.js")), AssetResolver.Resolve(new Uri("https://noormd.local/_noormd/js/app.js"), web.Path, doc.Path));
        Assert.Equal(Path.GetFullPath(doc.File("img/a b.png")), AssetResolver.Resolve(new Uri("https://noormd.local/img/a%20b.png"), web.Path, doc.Path));
        Assert.Null(AssetResolver.Resolve(new Uri("https://noormd.local/secret.txt"), web.Path, doc.Path));
        Assert.Null(AssetResolver.Resolve(new Uri("https://noormd.local/_noormd/%2e%2e/%2e%2e/etc/passwd"), web.Path, doc.Path));
        Assert.Null(AssetResolver.Resolve(new Uri("https://noormd.local/img/a b.png"), web.Path, null));
        Assert.Null(AssetResolver.Resolve(new Uri("https://evil.example/_noormd/js/app.js"), web.Path, doc.Path));
        Assert.Null(AssetResolver.Resolve(new Uri("http://noormd.local/"), web.Path, doc.Path));
    }

    [Theory]
    [InlineData("../x.png")]
    [InlineData("a/../../x.png")]
    [InlineData("/etc/x.png")]
    [InlineData("C:/x.png")]
    [InlineData("x.png:stream")]
    public void SafeCombine_RejectsEscapes(string rel)
    {
        using var t = new TempDir();
        Assert.Null(AssetResolver.SafeCombine(t.Path, rel));
    }
}

public class LinkPolicyTests
{
    [Theory]
    [InlineData("https://example.com/a?b=1", LinkKind.External)]
    [InlineData("mailto:me@example.com", LinkKind.External)]
    [InlineData("javascript:alert(1)", LinkKind.Blocked)]
    [InlineData("file:///C:/Windows/System32/calc.exe", LinkKind.Blocked)]
    [InlineData("ms-settings:privacy", LinkKind.Blocked)]
    [InlineData("\\\\server\\share\\x.md", LinkKind.Blocked)]
    [InlineData("//server/share/x.md", LinkKind.Blocked)]
    [InlineData("/%3F%3F/UNC/server/share/x.md", LinkKind.Blocked)] // \??\UNC\… would reach a share
    [InlineData("%5C%5C%3F%5CUNC%5Cserver%5Cshare%5Cx.md", LinkKind.Blocked)]
    [InlineData("%5C%5Cserver%5Cshare%5Cx.md", LinkKind.Blocked)]
    [InlineData("run.bat", LinkKind.Blocked)]
    [InlineData("#heading", LinkKind.Blocked)]
    public void Classifies(string href, LinkKind kind)
    {
        using var t = new TempDir();
        File.WriteAllText(t.File("run.bat"), "");
        Assert.Equal(kind, LinkPolicy.Classify(href, t.Path).Kind);
    }

    [Fact]
    public void RelativeMarkdown_OpensInApp()
    {
        using var t = new TempDir();
        Directory.CreateDirectory(t.File("notes"));
        File.WriteAllText(t.File("notes/other doc.md"), "x");
        var d = LinkPolicy.Classify("notes/other%20doc.md#part", t.Path);
        Assert.Equal(LinkKind.LocalDocument, d.Kind);
        Assert.Equal(Path.GetFullPath(t.File("notes/other doc.md")), d.Target);
        Assert.Equal(LinkKind.LocalDocument, LinkPolicy.Classify("https://noormd.local/notes/other%20doc.md", t.Path).Kind);
        Assert.Equal(LinkKind.Blocked, LinkPolicy.Classify("notes/missing.md", t.Path).Kind);
        Assert.Equal(LinkKind.Blocked, LinkPolicy.Classify("notes/other%20doc.md", null).Kind);
    }
}

public class ExportAndProtocolTests
{
    [Fact]
    public void HtmlExport_EscapesTitle_AndForbidsScripts()
    {
        var html = HtmlExport.Build("<script>alert(1)</script>", "<p>ok</p>");
        Assert.Contains("&lt;script&gt;", html);
        Assert.DoesNotContain("<script>", html);
        Assert.Contains("default-src 'none'", html);
        Assert.Contains("<p>ok</p>", html);
    }

    [Fact]
    public void Protocol_ParsesValid_RejectsInvalid()
    {
        Assert.True(BridgeProtocol.TryParse("""{"v":2,"id":7,"type":"doc.save","payload":{"x":"y"}}""", out var r, out _));
        Assert.Equal(7, r!.Id);
        Assert.Equal("doc.save", r.Type);
        Assert.Equal("y", r.GetString("x"));
        Assert.Null(r.GetString("missing"));
        Assert.False(BridgeProtocol.TryParse("""{"v":1,"type":"doc.save"}""", out _, out _));
        Assert.False(BridgeProtocol.TryParse("""{"v":2,"type":"../x"}""", out _, out _));
        Assert.False(BridgeProtocol.TryParse("not json", out _, out _));
        Assert.False(BridgeProtocol.TryParse("[1]", out _, out _));
    }

    [Fact]
    public void Protocol_BuildsReplyAndEvent()
    {
        using var reply = JsonDocument.Parse(BridgeProtocol.Reply(3, new { saved = true }));
        Assert.Equal(3, reply.RootElement.GetProperty("replyTo").GetInt32());
        Assert.True(reply.RootElement.GetProperty("result").GetProperty("saved").GetBoolean());
        using var ev = JsonDocument.Parse(BridgeProtocol.Event("doc.load", new { markdownText = "x" }));
        Assert.Equal("x", ev.RootElement.GetProperty("payload").GetProperty("markdownText").GetString());
    }

    [Fact]
    public void Layouts_Are_Kept_With_Size_Limits()
    {
        var p = new EditorPrefs();
        p.Apply(JsonDocument.Parse("""{"layout":{"sidebar":"right","place":{"music":"left","stream":"window"},"size":{"left":420}},"layouts":[{"name":"Evening","layout":{"sidebar":"hidden"}}],"layoutName":"Evening"}""").RootElement);
        Assert.Equal("right", (string?)p.Layout!["sidebar"]);
        Assert.Equal("window", (string?)p.Layout["place"]!["stream"]);
        Assert.Single(p.Layouts!);
        Assert.Equal("Evening", p.LayoutName);
        // Wrong shapes and oversized values are ignored; the rest of the settings still apply.
        p.Apply(JsonDocument.Parse("""{"layout":"left","layouts":{"x":1},"layoutName":42,"fontSize":20}""").RootElement);
        Assert.NotNull(p.Layout);
        Assert.Single(p.Layouts!);
        Assert.Equal(20, p.FontSize);
        p.Apply(JsonDocument.Parse("{\"layout\":{\"x\":\"" + new string('a', 9000) + "\"}}").RootElement);
        Assert.Equal("right", (string?)p.Layout!["sidebar"]);
        // Round trip through the settings file format.
        var back = JsonSerializer.Deserialize<EditorPrefs>(JsonSerializer.Serialize(p, SettingsStore.Json), SettingsStore.Json)!;
        Assert.Equal("left", (string?)back.Layout!["place"]!["music"]);
    }

    [Fact]
    public void Prefs_Patch_IsValidatedAndClamped()
    {
        var p = new EditorPrefs();
        using var patch = JsonDocument.Parse("""{"theme":"light","fontSize":99,"splitRatio":0.95,"lineWidth":"evil","unknown":1,"restoreSession":false,"spellcheck":false,"compact":true,"compactz":"x","sourceFontSize":3,"lineNumbers":false,"wordWrap":false,"syncScroll":true}""");
        p.Apply(patch.RootElement);
        Assert.Equal("light", p.Theme);
        Assert.Equal(26, p.FontSize);
        Assert.Equal(0.7, p.SplitRatio);
        Assert.Equal("comfortable", p.LineWidth);
        Assert.False(p.RestoreSession);
        Assert.False(p.Spellcheck);
        Assert.True(p.Compact);
        Assert.Equal(11, p.SourceFontSize);
        Assert.False(p.LineNumbers);
        Assert.False(p.WordWrap);
        Assert.True(p.SyncScroll);
    }

    [Fact]
    public void Settings_From_1_0_0_LoadWithNewDefaults_And_NewSettingsStayReadableByOldShape()
    {
        using var t = new TempDir();
        // A settings.json written by 1.0.0 (no spellcheck/compact keys).
        File.WriteAllText(t.File("settings.json"), """{"version":1,"prefs":{"theme":"light","lineWidth":"wide"},"recent":[]}""");
        var s = new SettingsStore(t.File("settings.json")).Load();
        Assert.True(s.Prefs.Spellcheck);
        Assert.False(s.Prefs.Compact);
        Assert.Equal("wide", s.Prefs.LineWidth);
        // Rolling back to 1.0.0 is safe: System.Text.Json ignores the extra keys by default.
        new SettingsStore(t.File("settings.json")).Save(s);
        Assert.Contains("\"compact\"", File.ReadAllText(t.File("settings.json")));
    }

    [Fact]
    public void Prefs_And_Protocol_Tolerate_Nulls_And_Wrong_Types()
    {
        var p = new EditorPrefs { FontSize = 18 };
        using var patch = JsonDocument.Parse("""{"fontSize":null,"splitRatio":"0.4","sidebarWidth":{"x":1},"theme":null,"compact":true}""");
        p.Apply(patch.RootElement); // must not throw
        Assert.Equal(18, p.FontSize);
        Assert.True(p.Compact);
        Assert.False(BridgeProtocol.TryParse("""{"v":"1","type":"doc.save"}""", out _, out _));
        Assert.False(BridgeProtocol.TryParse("""{"v":null,"type":"doc.save"}""", out _, out _));
    }

    [Fact]
    public void Settings_RecentList_DedupesAndPersists()
    {
        using var t = new TempDir();
        var store = new SettingsStore(t.File("settings.json"));
        var s = store.Load();
        s.AddRecent(t.File("a.md"));
        s.AddRecent(t.File("b.md"));
        s.AddRecent(t.File("A.md"));
        store.Save(s);
        var loaded = store.Load();
        Assert.Equal(2, loaded.Recent.Count);
        Assert.Equal("A.md", loaded.Recent[0].Name);
    }

    [Fact]
    public void Settings_CorruptFile_IsMovedAside()
    {
        using var t = new TempDir();
        File.WriteAllText(t.File("settings.json"), "{ not json");
        var s = new SettingsStore(t.File("settings.json")).Load();
        Assert.Equal("dark", s.Prefs.Theme);
        Assert.Single(Directory.GetFiles(t.Path, "settings.json.corrupt-*"));
    }
}

public class WorkspaceSessionTests
{
    private const string TabA = "a1b2c3d4e5f60718";
    private const string TabB = "0f1e2d3c4b5a6978";
    private const string TabC = "1122334455667788";

    [Fact]
    public void Normalize_Drops_Bad_Ids_Duplicates_Relative_Paths_And_Unknown_Modes()
    {
        using var t = new TempDir();
        var s = new WorkspaceSession
        {
            ActiveTabId = "nope",
            Tabs =
            [
                new SessionTab { TabId = TabA, Path = t.File("a.md"), Mode = "split" },
                new SessionTab { TabId = TabA, Path = t.File("dup-id.md") },
                new SessionTab { TabId = TabB, Path = t.File("A.MD") },              // same file, other case
                new SessionTab { TabId = "../../evil", Path = t.File("x.md") },
                new SessionTab { TabId = TabC, Title = "Notes", Text = "hello", Mode = "<script>" },
                new SessionTab { TabId = "99887766", Path = "relative.md" },
            ],
        };
        s.Normalize();
        Assert.Equal([TabA, TabC], s.Tabs.Select(x => x.TabId));
        Assert.Equal("split", s.Tabs[0].Mode);
        Assert.Null(s.Tabs[1].Mode);
        Assert.Null(s.ActiveTabId);
    }

    [Fact]
    public void Session_RoundTrips_Through_Settings_File()
    {
        using var t = new TempDir();
        var store = new SettingsStore(t.File("settings.json"));
        var settings = new AppSettings
        {
            Session = new WorkspaceSession
            {
                ActiveTabId = TabB,
                Tabs = [new SessionTab { TabId = TabA, Path = t.File("a.md"), Pinned = true }, new SessionTab { TabId = TabB, Title = "Ideas", Text = "# Ideas\n" }],
            },
        };
        store.Save(settings);
        var back = store.Load().Session!;
        Assert.Equal(TabB, back.ActiveTabId);
        Assert.True(back.Tabs[0].Pinned);
        Assert.Equal("# Ideas\n", back.Tabs[1].Text);
    }

    [Fact]
    public void Plan_Gives_Each_Tab_Its_Own_Draft_Reopens_Files_And_Reports_Missing_Ones()
    {
        using var t = new TempDir();
        var crashed = new RecoveryStore(t.File("rec"));
        crashed.SaveOwn(TabA, "unsaved A", "Untitled document", null, TextFormat.Default);
        crashed.SaveOwn(TabB, "unsaved B", "Untitled document", null, TextFormat.Default);
        crashed.Dispose();
        using var store = new RecoveryStore(t.File("rec"));

        var exists = t.File("exists.md");
        File.WriteAllText(exists, "x");
        var session = new WorkspaceSession
        {
            Tabs =
            [
                new SessionTab { TabId = TabA, Title = "Untitled document" },
                new SessionTab { TabId = "aaaabbbbccccdddd", Path = exists },
                new SessionTab { TabId = TabB, Title = "Untitled document" },
                new SessionTab { TabId = TabC, Path = t.File("gone.md") },
            ],
        };
        var plan = SessionRestore.Plan(session, store.ListOrphans(), File.Exists);
        Assert.Equal(4, plan.Count);
        Assert.Equal("unsaved A", store.LoadOrphan(plan[0].DraftId!)!.Markdown);
        Assert.Equal("unsaved B", store.LoadOrphan(plan[2].DraftId!)!.Markdown);
        Assert.NotEqual(plan[0].DraftId, plan[2].DraftId);
        Assert.Null(plan[1].DraftId);
        Assert.False(plan[1].FileMissing);
        Assert.True(plan[3].FileMissing);
    }

    [Fact]
    public void TabIdOf_Reads_Tab_Part_And_Ignores_Legacy_Ids()
    {
        var session = Guid.NewGuid().ToString("N");
        Assert.Equal(TabA, RecoveryStore.TabIdOf(session + "-" + TabA));
        Assert.Null(RecoveryStore.TabIdOf(session));
        Assert.Null(RecoveryStore.TabIdOf("garbage-" + TabA));
    }
}
