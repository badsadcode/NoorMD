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
    [Fact]
    public void LiveSession_IsNotOrphan_ButEndedSessionIs()
    {
        using var t = new TempDir();
        var a = new RecoveryStore(t.Path);
        a.SaveOwn("draft text", "Doc", null, TextFormat.Default);
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
    public void OwnDraft_IsNeverListedOrDiscardable()
    {
        using var t = new TempDir();
        using var a = new RecoveryStore(t.Path);
        a.SaveOwn("x", null, null, TextFormat.Default);
        Assert.Empty(a.ListOrphans());
        Assert.False(a.DiscardOrphan(a.SessionId));
        Assert.True(a.HasOwnDraft);
        a.DeleteOwn();
        Assert.False(a.HasOwnDraft);
    }

    [Theory]
    [InlineData("../../etc/passwd")]
    [InlineData("")]
    [InlineData("0123456789abcdef0123456789abcdeZ")]
    public void InvalidIds_AreRejected(string id)
    {
        using var t = new TempDir();
        using var a = new RecoveryStore(t.Path);
        Assert.Null(a.LoadOrphan(id));
        Assert.False(a.DiscardOrphan(id));
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
        Assert.True(BridgeProtocol.TryParse("""{"v":1,"id":7,"type":"doc.save","payload":{"x":"y"}}""", out var r, out _));
        Assert.Equal(7, r!.Id);
        Assert.Equal("doc.save", r.Type);
        Assert.Equal("y", r.GetString("x"));
        Assert.Null(r.GetString("missing"));
        Assert.False(BridgeProtocol.TryParse("""{"v":2,"type":"doc.save"}""", out _, out _));
        Assert.False(BridgeProtocol.TryParse("""{"v":1,"type":"../x"}""", out _, out _));
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
    public void Prefs_Patch_IsValidatedAndClamped()
    {
        var p = new EditorPrefs();
        using var patch = JsonDocument.Parse("""{"theme":"light","fontSize":99,"splitRatio":0.95,"lineWidth":"evil","unknown":1,"restoreSession":false}""");
        p.Apply(patch.RootElement);
        Assert.Equal("light", p.Theme);
        Assert.Equal(26, p.FontSize);
        Assert.Equal(0.7, p.SplitRatio);
        Assert.Equal("comfortable", p.LineWidth);
        Assert.False(p.RestoreSession);
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
