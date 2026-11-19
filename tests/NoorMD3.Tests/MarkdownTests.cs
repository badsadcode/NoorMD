using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Markdown.Bench;
using Markdown.Core;
using Noor.Contracts;
using Xunit;

namespace NoorMD3.Tests;

public sealed class MarkdownTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "noormd3-md-" + Guid.NewGuid().ToString("N"));
    public MarkdownTests() => Directory.CreateDirectory(_dir);
    public void Dispose() { try { Directory.Delete(_dir, true); } catch (IOException) { } }

    /// <summary>The shell, with the user's answers to its dialogs lined up in advance.</summary>
    sealed class Host(string data) : IBenchHost
    {
        public readonly Queue<string[]> Picks = new();
        public readonly Queue<string?> Saves = new();
        public void Post(string name, object? payload = null) { }
        public string DataFolder => data;
        public void Log(string message) { }
        public Task<IReadOnlyList<string>> PickFilesAsync(string title, IReadOnlyList<FileFilter> filters, bool multiple = false) => Task.FromResult<IReadOnlyList<string>>(Picks.Count > 0 ? Picks.Dequeue() : []);
        public Task<string?> PickSaveFileAsync(string title, string suggestedName, IReadOnlyList<FileFilter> filters) => Task.FromResult(Saves.Count > 0 ? Saves.Dequeue() : null);
    }

    static JsonElement J(object o) => JsonSerializer.SerializeToElement(o);
    const string A = "0123abcd", B = "4567cdef";

    [Fact]
    public async Task A_file_opens_only_once_the_user_has_picked_it_and_saves_back_in_its_own_encoding()
    {
        var file = Path.Combine(_dir, "notes.md");
        File.WriteAllBytes(file, [0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes("# Zażółć\r\n\r\ngęślą jaźń\r\n")]);
        var host = new Host(Path.Combine(_dir, "data"));
        var bench = new MarkdownBench();

        var denied = await Assert.ThrowsAsync<BenchException>(() => bench.HandleAsync("md.load", J(new { doc = A, path = file }), host, default));
        Assert.Contains("Open", denied.Message);

        host.Picks.Enqueue([file]);
        var picked = await bench.HandleAsync("md.pick", J(new { }), host, default);
        Assert.Equal(file, (string)picked!.AsArray()[0]!);
        var doc = await bench.HandleAsync("md.load", J(new { doc = A, path = file }), host, default);
        Assert.Equal("# Zażółć\n\ngęślą jaźń\n", (string)doc!["markdown"]!);
        Assert.Equal("UTF-8 BOM · CRLF", (string)doc["format"]!);

        var saved = await bench.HandleAsync("md.write", J(new { doc = A, markdown = "# Zażółć\n\nnowy tekst\n" }), host, default);
        Assert.Equal("notes.md", (string)saved!["name"]!);
        var bytes = File.ReadAllBytes(file);
        Assert.Equal([0xEF, 0xBB, 0xBF], bytes[..3]);
        Assert.Equal("# Zażółć\r\n\r\nnowy tekst\r\n", Encoding.UTF8.GetString(bytes[3..]));

        // Another day, another run: the recent list remembers the user picked it.
        var again = new MarkdownBench();
        var reopened = await again.HandleAsync("md.load", J(new { doc = B, path = file }), host, default);
        Assert.Contains("nowy tekst", (string)reopened!["markdown"]!);
        var recent = await again.HandleAsync("md.recentList", J(new { }), host, default);
        Assert.Equal(file, (string)recent!.AsArray()[0]!["path"]!);
    }

    [Fact]
    public async Task Another_programs_changes_are_not_overwritten_without_asking()
    {
        var file = Path.Combine(_dir, "shared.md");
        File.WriteAllText(file, "one\n");
        var host = new Host(Path.Combine(_dir, "data"));
        var bench = new MarkdownBench();
        host.Picks.Enqueue([file]);
        await bench.HandleAsync("md.pick", J(new { }), host, default);
        await bench.HandleAsync("md.load", J(new { doc = A, path = file }), host, default);

        File.WriteAllText(file, "changed elsewhere, and longer\n");
        Assert.True((bool)(await bench.HandleAsync("md.changed", J(new { doc = A }), host, default))!);
        var r = await bench.HandleAsync("md.write", J(new { doc = A, markdown = "mine\n" }), host, default);
        Assert.True((bool)r!["conflict"]!);
        Assert.Equal("changed elsewhere, and longer\n", File.ReadAllText(file));

        await bench.HandleAsync("md.write", J(new { doc = A, markdown = "mine\n", overwrite = true }), host, default);
        Assert.Equal("mine\n", File.ReadAllText(file));
        Assert.False((bool)(await bench.HandleAsync("md.changed", J(new { doc = A }), host, default))!);
    }

    [Fact]
    public async Task A_new_document_asks_where_to_go_and_unsaved_work_survives_closing_the_app()
    {
        var host = new Host(Path.Combine(_dir, "data"));
        var bench = new MarkdownBench();
        var r = await bench.HandleAsync("md.write", J(new { doc = A, markdown = "hello" }), host, default);
        Assert.True((bool)r!["needsPath"]!);

        // Typed, not saved: a draft. The app closes; next time the document comes back with its words.
        await bench.HandleAsync("md.draft", J(new { doc = A, markdown = "hello, draft", title = "Plans" }), host, default);
        var next = new MarkdownBench();
        var back = await next.HandleAsync("md.resume", J(new { doc = A }), host, default);
        Assert.Equal("hello, draft", (string)back!["markdown"]!);
        Assert.Equal("Plans", (string)back["title"]!);
        var orphans = await next.HandleAsync("md.drafts", J(new { except = new[] { B } }), host, default);
        Assert.Single(orphans!.AsArray());
        Assert.Empty((await next.HandleAsync("md.drafts", J(new { except = new[] { A } }), host, default))!.AsArray());

        // Cancelled Save As: nothing happens. Then a place: saved, and the draft is gone.
        Assert.Null(await next.HandleAsync("md.writeAs", J(new { doc = A, markdown = "hello, saved", title = "Plans" }), host, default));
        var target = Path.Combine(_dir, "Plans.md");
        host.Saves.Enqueue(target);
        var saved = await next.HandleAsync("md.writeAs", J(new { doc = A, markdown = "hello, saved", title = "Plans" }), host, default);
        Assert.Equal(target, (string)saved!["path"]!);
        Assert.Equal("hello, saved\n", File.ReadAllText(target));
        Assert.Null(await next.HandleAsync("md.resume", J(new { doc = A }), host, default));

        // A document closed without saving leaves no draft behind.
        await next.HandleAsync("md.draft", J(new { doc = B, markdown = "scrap" }), host, default);
        await next.HandleAsync("md.closeDoc", J(new { doc = B }), host, default);
        Assert.Empty((await next.HandleAsync("md.drafts", J(new { }), host, default))!.AsArray());
    }

    [Fact]
    public async Task A_draft_of_a_saved_file_still_notices_changes_made_while_the_app_was_closed()
    {
        var file = Path.Combine(_dir, "a.md");
        File.WriteAllText(file, "v1\n");
        var host = new Host(Path.Combine(_dir, "data"));
        var bench = new MarkdownBench();
        host.Picks.Enqueue([file]);
        await bench.HandleAsync("md.pick", J(new { }), host, default);
        await bench.HandleAsync("md.load", J(new { doc = A, path = file }), host, default);
        await bench.HandleAsync("md.draft", J(new { doc = A, markdown = "v1 and more" }), host, default);

        File.WriteAllText(file, "v2 from elsewhere\n");
        var next = new MarkdownBench();
        var back = await next.HandleAsync("md.resume", J(new { doc = A }), host, default);
        Assert.Equal(file, (string)back!["path"]!);
        var r = await next.HandleAsync("md.write", J(new { doc = A, markdown = "v1 and more" }), host, default);
        Assert.True((bool)r!["conflict"]!);
    }

    [Theory]
    [InlineData("../evil")]
    [InlineData("ABCDEF12")]
    [InlineData("12")]
    public async Task Document_ids_are_checked(string id)
    {
        var host = new Host(Path.Combine(_dir, "data"));
        await Assert.ThrowsAsync<BenchException>(() => new MarkdownBench().HandleAsync("md.draft", J(new { doc = id, markdown = "x" }), host, default));
    }

    [Theory]
    [InlineData("bench.js")]
    [InlineData("mdtools.js")]
    [InlineData("bench.css")]
    [InlineData("vendor/toastui/toastui-editor-all.min.js")]
    [InlineData("vendor/toastui/toastui-editor.css")]
    [InlineData("vendor/toastui/toastui-editor-dark.css")]
    public void The_editor_ships_inside_the_DLL(string asset)
    {
        using var s = new MarkdownBench().OpenAsset(asset);
        Assert.NotNull(s);
        Assert.True(s!.Length > 100);
    }

    [Fact]
    public void Pictures_are_written_relative_to_the_document_when_they_sit_beside_or_below_it()
    {
        var doc = Path.Combine(_dir, "notes", "plan.md");
        Assert.Equal("images/cat%20photo.png", MarkdownBench.ImageUrl(Path.Combine(_dir, "notes", "images", "cat photo.png"), doc));
        Assert.Equal("a.png", MarkdownBench.ImageUrl(Path.Combine(_dir, "notes", "a.png"), doc));
        Assert.StartsWith("file:///", MarkdownBench.ImageUrl(Path.Combine(_dir, "elsewhere", "b.png"), doc));
        Assert.StartsWith("file:///", MarkdownBench.ImageUrl(Path.Combine(_dir, "c.png"), null));
    }

    [Fact]
    public void Only_markdown_and_text_files_open()
    {
        var docs = new Documents(Path.Combine(_dir, "data"));
        var exe = Path.Combine(_dir, "x.exe");
        File.WriteAllText(exe, "MZ");
        docs.Picked([exe]);
        Assert.Throws<IOException>(() => docs.Open(A, exe));
    }
}
