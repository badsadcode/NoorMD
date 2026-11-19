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
        public string? SaveAs;
        public Task<string?> PickSaveFileAsync(string title, string suggestedName, IReadOnlyList<FileFilter> filters) => Task.FromResult(SaveAs);
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
    public async Task The_map_aliases_headings_previews_daily_notes_and_templates()
    {
        var (bench, host, root) = await NewVault();
        File.WriteAllText(Path.Combine(root, "Permanent", "Ada Lovelace.md"), "---\naliases: [Ada, \"The Countess\"]\n---\n# Ada Lovelace\n\n## Engines\n\nAnalytical.\n\n## Poetry\n\nScience.\n");
        File.WriteAllText(Path.Combine(root, "Index", "People.md"), "# People\n\n- [[Ada]] wrote the first program.\n- [[Ada Lovelace#Engines]]\n- [[Somebody new]]\n");
        await bench.HandleAsync("vault.newFolder", J(new { parent = "", name = "x" }), host, default);   // (a rescan)

        // The map: notes, links (an alias counts), and a note still to make.
        var g = await bench.HandleAsync("vault.graph", J(new { }), host, default);
        var edges = g!["edges"]!.AsArray().Select(e => ((string)e![0]!, (string)e[1]!)).ToList();
        Assert.Contains(edges, e => e == ("Index/People.md", "Permanent/Ada Lovelace.md"));
        var missing = g["nodes"]!.AsArray().Where(n => (bool)n!["missing"]!).Select(n => (string)n!["name"]!).ToList();
        Assert.Equal(["Somebody new"], missing);
        Assert.Equal("Permanent", (string)g["nodes"]!.AsArray().Single(n => (string)n!["path"]! == "Permanent/Ada Lovelace.md")!["folder"]!);
        // The local map: Ada and her neighbours only.
        var local = await bench.HandleAsync("vault.graph", J(new { center = Path.Combine(root, "Permanent", "Ada Lovelace.md"), depth = 1 }), host, default);
        var names = local!["nodes"]!.AsArray().Select(n => (string)n!["path"]!).ToList();
        Assert.Contains("Index/People.md", names);
        Assert.DoesNotContain("Templates/Literature note.md", names);

        // Aliases: [[Ada]] opens Ada Lovelace; suggestions know them.
        var r = await bench.HandleAsync("vault.openLink", J(new { from = Path.Combine(root, "Index", "People.md"), target = "The Countess" }), host, default);
        Assert.Equal("Permanent/Ada Lovelace.md", (string)r!["opened"]!);
        var notes = await bench.HandleAsync("vault.notes", J(new { }), host, default);
        Assert.Contains("Ada", notes!.AsArray().Single(n => (string)n!["name"]! == "Ada Lovelace")!["aliases"]!.AsArray().Select(x => (string)x!));
        // Headings: for [[Ada Lovelace#…]]; following one says which heading.
        var hs = await bench.HandleAsync("vault.headings", J(new { from = "", target = "Ada Lovelace" }), host, default);
        Assert.Equal(["Ada Lovelace", "Engines", "Poetry"], hs!.AsArray().Select(h => (string)h!["text"]!));
        var withHeading = await bench.HandleAsync("vault.openLink", J(new { from = "", target = "Ada Lovelace#Engines" }), host, default);
        Assert.Equal("Engines", (string)withHeading!["heading"]!);
        // A hover preview: the section after the heading, not the whole note.
        var pv = await bench.HandleAsync("vault.preview", J(new { from = "", target = "Ada#Engines" }), host, default);
        Assert.StartsWith("## Engines", (string)pv!["markdown"]!);
        Assert.DoesNotContain("Poetry", (string)pv["markdown"]!);
        Assert.True((bool)(await bench.HandleAsync("vault.preview", J(new { from = "", target = "Nobody" }), host, default))!["missing"]!);

        // Today's note: no Journal folder in a Zettelkasten vault, so Daily/.
        var today = DateTime.Now.ToString("yyyy-MM-dd");
        var daily = await bench.HandleAsync("vault.daily", J(new { }), host, default);
        Assert.Equal($"Daily/{today}.md", (string)daily!["path"]!);
        Assert.True((bool)daily["made"]!);
        Assert.False((bool)(await bench.HandleAsync("vault.daily", J(new { }), host, default))!["made"]!);   // the second time it's just opened

        // A note from a template: its blanks filled.
        var t = await bench.HandleAsync("vault.templates", J(new { }), host, default);
        Assert.Contains("Templates/Literature note.md", t!.AsArray().Select(x => (string)x!["path"]!));
        await bench.HandleAsync("vault.newFromTemplate", J(new { template = "Templates/Literature note.md", folder = "Literature", name = "How to take notes" }), host, default);
        var made = File.ReadAllText(Path.Combine(root, "Literature", "How to take notes.md"));
        Assert.Contains("# How to take notes", made);
        Assert.DoesNotContain("{{", made);
        Assert.Equal("2026-01-02 09:05 Fri", VaultNotes.FillTemplate("{{date}} {{time}} {{date:ddd}}", "x", new DateTime(2026, 1, 2, 9, 5, 0)));
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

    // ------------------------------------------------------------------ 3.0.10

    async Task<(VaultBench Bench, Host Host, string Root)> HandMadeVault()
    {
        var root = Path.Combine(_dir, "Hand made");
        Directory.CreateDirectory(Path.Combine(root, "Notes"));
        File.WriteAllText(Path.Combine(root, "Ada Lovelace.md"), "---\naliases: [Ada]\nstatus: draft\n---\n# Ada Lovelace\n\nShe wrote about the Engine. #people\n");
        File.WriteAllText(Path.Combine(root, "Engine.md"), "# Engine\n\nAda Lovelace saw it first.\nSee [[Notes/Plan]] and `Ada Lovelace` in code.\n");
        File.WriteAllText(Path.Combine(root, "Notes", "Plan.md"), "# Plan\n\nTalk to Ada about [[Engine]].\n[[Missing one]]\n");
        File.WriteAllText(Path.Combine(root, ".netrc"), "machine example password hunter2\n");
        var host = new Host(Path.Combine(_dir, "data"));
        var bench = new VaultBench();
        host.Folders.Enqueue(root);
        await bench.HandleAsync("vault.openFolder", J(new { }), host, default);
        return (bench, host, root);
    }

    static List<string> Paths(JsonNode? hits) => hits!.AsArray().Select(h => (string)h!["path"]!).Distinct().ToList();

    [Fact]
    public async Task Search_operators_find_by_tag_property_path_phrase_and_leave_out()
    {
        var (bench, host, _) = await HandMadeVault();
        async Task<List<string>> Q(string q) => Paths(await bench.HandleAsync("vault.search", J(new { q }), host, default));
        Assert.Equal(["Ada Lovelace.md"], await Q("tag:people"));
        Assert.Equal(["Ada Lovelace.md"], await Q("#people"));
        Assert.Equal(["Ada Lovelace.md"], await Q("status:draft"));
        Assert.Equal(["Notes/Plan.md"], await Q("path:notes"));
        Assert.Equal(["Engine.md"], await Q("\"saw it first\""));
        var engine = await Q("engine -tag:people");
        Assert.Contains("Engine.md", engine);
        Assert.Contains("Notes/Plan.md", engine);
        Assert.DoesNotContain("Ada Lovelace.md", engine);
        Assert.Equal(["Engine.md"], await Q("file:engine"));
    }

    [Fact]
    public async Task Unlinked_mentions_become_links_and_outgoing_links_are_listed()
    {
        var (bench, host, root) = await HandMadeVault();
        var bl = await bench.HandleAsync("vault.backlinks", J(new { path = Path.Combine(root, "Ada Lovelace.md") }), host, default);
        var mentions = bl!["mentions"]!.AsArray();
        Assert.Equal(2, mentions.Count);   // the one in `code` doesn't count
        var inEngine = mentions.Single(m => (string)m!["source"]! == "Engine.md")!;
        Assert.Equal(3, (int)inEngine["line"]!);
        Assert.Equal("draft", (string)bl["properties"]!["status"]![0]!);

        await bench.HandleAsync("vault.linkMention", J(new { source = "Engine.md", target = "Ada Lovelace.md", line = 3, column = (int)inEngine["column"]!, text = (string)inEngine["text"]! }), host, default);
        Assert.Contains("[[Ada Lovelace]] saw it first.", File.ReadAllText(Path.Combine(root, "Engine.md")));
        var inPlan = (await bench.HandleAsync("vault.backlinks", J(new { path = Path.Combine(root, "Ada Lovelace.md") }), host, default))!["mentions"]!.AsArray().Single()!;
        await bench.HandleAsync("vault.linkMention", J(new { source = "Notes/Plan.md", target = "Ada Lovelace.md", line = (int)inPlan["line"]!, column = (int)inPlan["column"]!, text = "Ada" }), host, default);
        Assert.Contains("Talk to [[Ada Lovelace|Ada]] about", File.ReadAllText(Path.Combine(root, "Notes", "Plan.md")));
        // A stale mention (the text moved) is refused; so is a file open with unsaved changes.
        await Assert.ThrowsAsync<BenchException>(() => bench.HandleAsync("vault.linkMention", J(new { source = "Engine.md", target = "Ada Lovelace.md", line = 3, column = 0, text = "Ada Lovelace" }), host, default));

        var now = await bench.HandleAsync("vault.backlinks", J(new { path = Path.Combine(root, "Ada Lovelace.md") }), host, default);
        Assert.Equal(2, now!["refs"]!.AsArray().Count);
        Assert.Empty(now["mentions"]!.AsArray());
        var outgoing = (await bench.HandleAsync("vault.backlinks", J(new { path = Path.Combine(root, "Notes", "Plan.md") }), host, default))!["outgoing"]!.AsArray();
        Assert.Contains(outgoing, o => (string?)o!["path"] == "Engine.md");
        Assert.Contains(outgoing, o => o!["path"] == null && (string)o["name"]! == "Missing one");
    }

    [Fact]
    public async Task Bookmarks_follow_renames_random_note_extract_and_pack()
    {
        var (bench, host, root) = await HandMadeVault();
        await bench.HandleAsync("vault.bookmark", J(new { path = "Engine.md", on = true }), host, default);
        await bench.HandleAsync("vault.rename", J(new { path = "Engine.md", name = "Motor", updateLinks = true }), host, default);
        var marks = await bench.HandleAsync("vault.bookmarks", J(new { }), host, default);
        Assert.Equal("Motor.md", (string)marks!.AsArray().Single()!["path"]!);
        Assert.True((bool)(await bench.HandleAsync("vault.backlinks", J(new { path = Path.Combine(root, "Motor.md") }), host, default))!["bookmarked"]!);
        await bench.HandleAsync("vault.bookmark", J(new { path = "Motor.md", on = false }), host, default);
        Assert.Empty((await bench.HandleAsync("vault.bookmarks", J(new { }), host, default))!.AsArray());

        var random = await bench.HandleAsync("vault.random", J(new { }), host, default);
        Assert.StartsWith(root, Assert.Single(host.Opened));
        Assert.NotNull((string?)random!["path"]);

        var made = await bench.HandleAsync("vault.extract", J(new { from = Path.Combine(root, "Notes", "Plan.md"), name = "Big idea", markdown = "Cut out.\n" }), host, default);
        Assert.Equal("Notes/Big idea.md", (string)made!["path"]!);
        Assert.Equal("Cut out.\n", File.ReadAllText(Path.Combine(root, "Notes", "Big idea.md")));

        var plan = await bench.HandleAsync("vault.packPlan", J(new { selection = new[] { "Notes/Plan.md" }, dependencies = true }), host, default);
        Assert.Contains(plan!["dependencies"]!.AsArray(), d => (string)d!["path"]! == "Motor.md");
        var whole = await bench.HandleAsync("vault.packPlan", J(new { }), host, default);
        Assert.DoesNotContain(whole!["files"]!.AsArray(), f => ((string)f!["entry"]!).Contains(".netrc"));
        host.SaveAs = Path.Combine(_dir, "out.zip");
        var zip = await bench.HandleAsync("vault.packCreate", J(new { selection = new[] { "Notes" } }), host, default);
        Assert.True(File.Exists(host.SaveAs));
        Assert.Equal(2, (int)zip!["entries"]!);
    }

    [Fact]
    public void Review_fixes_in_the_vault_core()
    {
        var root = Path.Combine(_dir, "core"); Directory.CreateDirectory(root);
        // A note that isn't text doesn't stop the index.
        File.WriteAllBytes(Path.Combine(root, "A.md"), [0x61, 0, 0x62, 0]);
        File.WriteAllText(Path.Combine(root, "B.md"), "# B\n[[Doc]]\n");
        File.WriteAllText(Path.Combine(root, "Doc.markdown"), "# C#\n## Learn F# ##\n");
        var index = new VaultIndex(root);
        index.Update(VaultScanner.Scan(root, []));
        Assert.Equal("# B\n[[Doc]]\n", index.TextOf("B.md"));
        // [[Doc]] finds Doc.markdown; "# C#" keeps its #.
        Assert.Equal("Doc.markdown", VaultLinks.Resolve("B.md", new VaultLink("Doc", true), index.NotePaths()));
        Assert.Equal(["C#", "Learn F#"], VaultNotes.Headings(index.TextOf("Doc.markdown")!).Select(h => h.Text));
        // Colours and anchors aren't tags; a --- rule isn't front matter.
        Assert.Equal(["real"], VaultTags.Extract("Red is #a1b2c3, see <a href=\"#top\">up</a> #real"));
        Assert.Empty(VaultNotes.FrontMatter("---\naliases: x\nbody text\n"));

        // Moving one note leaves the other links alone (no case changes, table \| kept); 'titles' are understood.
        var text = "see [[note]]\n| [[Note\\|alias]] | x |\n[o](Other.md 'T')\n";
        var r = VaultLinkRewriter.Rewrite(text, "A.md", new Dictionary<string, string> { ["Other.md"] = "Other2.md" }, ["A.md", "Note.md", "Other.md"]);
        Assert.Equal("see [[note]]\n| [[Note\\|alias]] | x |\n[o](Other2.md 'T')\n", r.Text);
        Assert.Equal(1, r.Changed);
        var hash = VaultLinkRewriter.Rewrite("[x](Other.md)", "A.md", new Dictionary<string, string> { ["Other.md"] = "a)b.md" }, ["A.md", "Other.md"]);
        Assert.Equal("[x](a%29b.md)", hash.Text);

        // Folder links inside the vault don't lead out of it.
        var outside = Path.Combine(_dir, "outside"); Directory.CreateDirectory(outside);
        try { Directory.CreateSymbolicLink(Path.Combine(root, "link"), outside); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return; }   // no right to make links here
        Assert.Null(VaultPaths.Resolve(root, "link/x.md"));
        var ops = new VaultFileOps(root);
        Assert.ThrowsAny<Exception>(() => ops.CreateNote("link", "x.md", ""));
        Assert.False(File.Exists(Path.Combine(outside, "x.md")));
        Assert.Throws<VaultOperationException>(() => ops.Rename("B.md", "C#.md"));
    }
}
