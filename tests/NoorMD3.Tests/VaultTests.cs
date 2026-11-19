using System.Text.Json;
using System.Text.Json.Nodes;
using Noor.Contracts;
using Vault.Bench;
using Vault.Core;
using Xunit;

namespace NoorMD3.Tests;

public sealed class VaultTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "noormd3-vault-" + Guid.NewGuid().ToString("N"));
    public VaultTests() => Directory.CreateDirectory(_dir);
    public void Dispose() { try { Directory.Delete(_dir, true); } catch (IOException) { } }

    /// <summary>The shell: folder dialogs answered in advance; files handed to other benches and moves announced are kept.</summary>
    sealed class Host(string data) : IBenchHost
    {
        public readonly Queue<string?> Folders = new();
        public readonly List<string> Opened = [];
        public readonly List<FileMove> Moves = [];
        public readonly List<string> Posted = [];
        public void Post(string name, object? payload = null) { lock (Posted) Posted.Add(name); }
        public string DataFolder => data;
        public void Log(string message) { }
        public Task<string?> PickFolderAsync(string title) => Task.FromResult(Folders.Count > 0 ? Folders.Dequeue() : null);
        public Task OpenFilesAsync(IReadOnlyList<string> paths) { Opened.AddRange(paths); return Task.CompletedTask; }
        public Task FilesMovedAsync(IReadOnlyList<FileMove> moves) { Moves.AddRange(moves); return Task.CompletedTask; }
    }

    static JsonElement J(object o) => JsonSerializer.SerializeToElement(o);

    async Task<(VaultBench Bench, Host Host, string Root)> NewVault(string preset = "zettelkasten")
    {
        var host = new Host(Path.Combine(_dir, "data"));
        var bench = new VaultBench();
        host.Folders.Enqueue(_dir);
        var made = await bench.HandleAsync("vault.create", J(new { name = "Ideas", preset }), host, default);
        return (bench, host, (string)made!["root"]!);
    }

    [Fact]
    public async Task The_wizard_makes_a_vault_from_a_structure_and_opens_its_home_note()
    {
        var (bench, host, root) = await NewVault();
        Assert.Equal(Path.Combine(_dir, "Ideas"), root);
        Assert.True(Directory.Exists(Path.Combine(root, "Permanent")));
        Assert.True(File.Exists(Path.Combine(root, "Templates", "Literature note.md")));
        Assert.Contains("{{title}}", File.ReadAllText(Path.Combine(root, "Templates", "Literature note.md")));   // templates keep their blanks
        Assert.Equal([Path.Combine(root, "Home.md")], host.Opened);
        var state = await bench.HandleAsync("vault.state", J(new { }), host, default);
        Assert.True((bool)state!["open"]!);
        Assert.Equal("Ideas", (string)state["name"]!);
        Assert.Equal(5, (int)state["notes"]!);   // Home, two starter notes, two templates

        // Cancelled folder dialog: nothing happens. Same name again: refused.
        Assert.Null(await bench.HandleAsync("vault.create", J(new { name = "Other", preset = "para" }), host, default));
        host.Folders.Enqueue(_dir);
        await Assert.ThrowsAsync<BenchException>(() => bench.HandleAsync("vault.create", J(new { name = "Ideas", preset = "para" }), host, default));

        // Next run: the vault comes back by itself.
        var again = new VaultBench();
        var back = await again.HandleAsync("vault.state", J(new { }), host, default);
        Assert.Equal(root, (string)back!["root"]!);
    }

    [Fact]
    public async Task Every_preset_applies_cleanly()
    {
        foreach (var p in VaultPresets.All)
        {
            var root = Path.Combine(_dir, "p-" + p.Id);
            Directory.CreateDirectory(root);
            var home = VaultPresets.Apply(root, p.Id, p.Name);
            Assert.True(File.Exists(home));
            Assert.All(p.Folders, f => Assert.True(Directory.Exists(Path.Combine(root, f.Replace('/', Path.DirectorySeparatorChar))), f));
            Assert.False(string.IsNullOrWhiteSpace(p.GoodFor), p.Id);
        }
        Assert.Contains(VaultPresets.All, p => p.Id == "para");
        Assert.Contains(VaultPresets.All, p => p.Id == "johnny");
        await Task.CompletedTask;
    }

    [Fact]
    public async Task Wiki_links_open_their_note_or_say_where_a_new_one_goes()
    {
        var (bench, host, root) = await NewVault();
        var from = Path.Combine(root, "Index", "Start here.md");
        host.Opened.Clear();
        var r = await bench.HandleAsync("vault.openLink", J(new { from, target = "One idea per note" }), host, default);
        Assert.Equal("Permanent/One idea per note.md", (string)r!["opened"]!);
        Assert.Equal([Path.Combine(root, "Permanent", "One idea per note.md")], host.Opened);

        var missing = await bench.HandleAsync("vault.openLink", J(new { from, target = "Brand new" }), host, default);
        Assert.True((bool)missing!["missing"]!);
        Assert.Equal("Index", (string)missing["folder"]!);
        await bench.HandleAsync("vault.createLink", J(new { from, target = "Brand new" }), host, default);
        Assert.True(File.Exists(Path.Combine(root, "Index", "Brand new.md")));
        Assert.Equal("# Brand new\n\n", File.ReadAllText(Path.Combine(root, "Index", "Brand new.md")));

        // A file outside the vault doesn't follow links in it.
        var outside = await bench.HandleAsync("vault.openLink", J(new { from = Path.Combine(_dir, "elsewhere.md"), target = "Home" }), host, default);
        Assert.True((bool)outside!["outside"]!);
    }

    [Fact]
    public async Task Renaming_a_note_rewrites_the_links_to_it_and_tells_the_other_benches()
    {
        var (bench, host, root) = await NewVault();
        var plan = await bench.HandleAsync("vault.renamePlan", J(new { path = "Permanent/One idea per note.md", name = "Atomic notes" }), host, default);
        Assert.Equal(2, (int)plan!["links"]!);   // from the index note, and from Home's "Start here" list
        Assert.Contains("Index/Start here.md", plan["notes"]!.AsArray().Select(n => (string)n!));

        var done = await bench.HandleAsync("vault.rename", J(new { path = "Permanent/One idea per note.md", name = "Atomic notes", updateLinks = true }), host, default);
        Assert.Equal(2, (int)done!["links"]!);
        Assert.True(File.Exists(Path.Combine(root, "Permanent", "Atomic notes.md")));
        Assert.Contains("[[Atomic notes]]", File.ReadAllText(Path.Combine(root, "Index", "Start here.md")));
        var move = Assert.Single(host.Moves);
        Assert.Equal(Path.Combine(root, "Permanent", "One idea per note.md"), move.From);
        Assert.Contains(Path.Combine(root, "Index", "Start here.md"), done["updated"]!.AsArray().Select(x => (string)x!));

        // The index follows at once: backlinks of the renamed note.
        var bl = await bench.HandleAsync("vault.backlinks", J(new { path = Path.Combine(root, "Permanent", "Atomic notes.md") }), host, default);
        Assert.Contains("Index/Start here.md", bl!["refs"]!.AsArray().Select(r => (string)r!["source"]!));
        Assert.Contains("permanent", bl["tags"]!.AsArray().Select(t => (string)t!));

        // A note open with unsaved changes keeps its old links (it's left alone, and reported).
        var start = Path.Combine(root, "Index", "Start here.md");
        var kept = await bench.HandleAsync("vault.rename", J(new { path = "Permanent/Atomic notes.md", name = "Atoms", updateLinks = true, skip = new[] { start } }), host, default);
        Assert.Equal(1, (int)kept!["links"]!);   // Home's, not the open one's
        Assert.Equal("Index/Start here.md", (string)kept["skipped"]!.AsArray()[0]!);
        Assert.Contains("[[Atomic notes]]", File.ReadAllText(start));
    }

    [Fact]
    public async Task Explorer_operations_search_tags_and_the_recycle_bin()
    {
        var (bench, host, root) = await NewVault("para");
        await bench.HandleAsync("vault.newFolder", J(new { parent = "", name = "Ideas box" }), host, default);
        await bench.HandleAsync("vault.newNote", J(new { folder = "Ideas box", name = "Flying cats" }), host, default);
        var tree = await bench.HandleAsync("vault.tree", J(new { }), host, default);
        var paths = tree!["entries"]!.AsArray().Select(e => (string)e!["path"]!).ToList();
        Assert.Contains("Ideas box/Flying cats.md", paths);
        Assert.DoesNotContain(paths, p => p.StartsWith(".noormd", StringComparison.Ordinal));

        var hits = await bench.HandleAsync("vault.search", J(new { q = "flying" }), host, default);
        Assert.Equal("Ideas box/Flying cats.md", (string)hits!.AsArray()[0]!["path"]!);
        var tags = await bench.HandleAsync("vault.tags", J(new { }), host, default);
        Assert.Contains(tags!.AsArray(), t => (string)t!["tag"]! == "project");
        var tagged = await bench.HandleAsync("vault.tagged", J(new { tag = "project" }), host, default);
        Assert.Contains(tagged!.AsArray(), t => (string)t!["path"]! == "1 Projects/Example project.md");

        await bench.HandleAsync("vault.move", J(new { paths = new[] { "Ideas box/Flying cats.md" }, folder = "3 Resources", updateLinks = true }), host, default);
        Assert.True(File.Exists(Path.Combine(root, "3 Resources", "Flying cats.md")));
        var del = await bench.HandleAsync("vault.delete", J(new { paths = new[] { "3 Resources/Flying cats.md", "Ideas box" } }), host, default);
        Assert.Equal(2, (int)del!["deleted"]!);
        Assert.Equal(2, del["paths"]!.AsArray().Count);
        Assert.False(File.Exists(Path.Combine(root, "3 Resources", "Flying cats.md")));

        await Assert.ThrowsAsync<BenchException>(() => bench.HandleAsync("vault.openNote", J(new { path = "../outside.md" }), host, default));
        await Assert.ThrowsAsync<BenchException>(() => bench.HandleAsync("vault.newNote", J(new { folder = "", name = "bad:name" }), host, default));
    }

    [Fact]
    public async Task A_page_cant_open_a_vault_the_user_never_picked()
    {
        var host = new Host(Path.Combine(_dir, "data"));
        await Assert.ThrowsAsync<BenchException>(() => new VaultBench().HandleAsync("vault.openRecent", J(new { path = _dir }), host, default));
        Assert.Throws<VaultOperationException>(() => VaultSession.CheckRoot(Path.GetPathRoot(_dir)!));
    }

    [Fact]
    public async Task Documents_open_on_a_renamed_file_follow_it()
    {
        var file = Path.Combine(_dir, "a.md"); File.WriteAllText(file, "# A\n");
        var md = new Markdown.Bench.MarkdownBench();
        var host = new Host(Path.Combine(_dir, "data"));
        await md.HandleAsync(Contract.OpenCommand, J(new { paths = new[] { file } }), host, default);
        await md.HandleAsync("md.load", J(new { doc = "0123abcd", path = file }), host, default);
        var to = Path.Combine(_dir, "b.md"); File.Move(file, to);
        var moved = await md.HandleAsync(Contract.MovedCommand, J(new { moves = new[] { new { from = file, to } } }), host, default);
        Assert.Equal(to, (string)moved!.AsArray()[0]!["path"]!);
        await md.HandleAsync("md.write", J(new { doc = "0123abcd", markdown = "# A, renamed\n" }), host, default);
        Assert.Equal("# A, renamed\n", File.ReadAllText(to));
    }
}
