using System.Text;
using NoorMD.Core.Security;
using NoorMD.Core.Settings;
using NoorMD.Core.Vaults;
using Xunit;

namespace NoorMD.Core.Tests;

public class VaultTests
{
    private static string Write(TempDir t, string rel, string text)
    {
        var full = Path.Combine(t.Path, rel.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, text, new UTF8Encoding(false));
        return full;
    }

    [Fact]
    public void Scan_Lists_Nested_Notes_Naturally_And_Skips_Other_Tools_Folders()
    {
        using var t = new TempDir();
        Write(t, "World/Rivers.md", "# Rivers");
        Write(t, "Note 10.md", "x");
        Write(t, "Note 2.md", "x");
        Write(t, ".obsidian/app.json", "{}");
        Write(t, ".git/HEAD", "ref");
        Write(t, "node_modules/x/index.js", "");
        Write(t, "Drafts/old.md", "x");
        var entries = VaultScanner.Scan(t.Path, ["Drafts"]);
        var paths = entries.Select(e => e.Path).ToList();
        Assert.Equal(["Note 2.md", "Note 10.md", "World", "World/Rivers.md"], paths);
        Assert.True(entries.Single(e => e.Path == "World").IsFolder);
        Assert.False(File.Exists(Path.Combine(t.Path, ".noormd"))); // scanning writes nothing
    }

    [Fact]
    public void Resolve_Rejects_Traversal_And_Rooted_Paths()
    {
        using var t = new TempDir();
        Assert.NotNull(VaultPaths.Resolve(t.Path, "a/b.md"));
        Assert.Null(VaultPaths.Resolve(t.Path, "../outside.md"));
        Assert.Null(VaultPaths.Resolve(t.Path, "a/../../x.md"));
        Assert.Null(VaultPaths.Resolve(t.Path, "C:/Windows/win.ini"));
        Assert.Null(VaultPaths.Resolve(t.Path, "a\0b"));
        Assert.Equal("a/b.md", VaultPaths.ToRelative(t.Path, Path.Combine(t.Path, "a", "b.md")));
        Assert.Null(VaultPaths.ToRelative(t.Path, Path.GetTempPath()));
    }

    [Theory]
    [InlineData("Plan.md", true)]
    [InlineData("CON", false)]
    [InlineData("con.md", false)]
    [InlineData("a:b", false)]
    [InlineData("trailing.", false)]
    [InlineData("Zażółć.md", true)]
    public void Names_Are_Checked_Like_Windows_Does(string name, bool ok) => Assert.Equal(ok, VaultPaths.NameProblem(name) == null);

    [Fact]
    public void Move_Checks_Everything_First_And_Takes_A_Folders_Contents_Along()
    {
        using var t = new TempDir();
        var ops = new VaultFileOps(t.Path);
        ops.CreateFolder("", "X");
        ops.CreateFolder("", "A");
        File.WriteAllText(Path.Combine(t.Path, "a.md"), "a");
        File.WriteAllText(Path.Combine(t.Path, "b.md"), "b");
        File.WriteAllText(Path.Combine(t.Path, "X", "b.md"), "other b");
        File.WriteAllText(Path.Combine(t.Path, "A", "x.md"), "x");
        // b.md is taken in X: nothing moves, not even a.md.
        Assert.Throws<VaultOperationException>(() => ops.Move(["a.md", "b.md"], "X"));
        Assert.True(File.Exists(Path.Combine(t.Path, "a.md")));
        // A folder and a file inside it, selected together (Shift+click over an open folder): the folder moves once.
        var moved = ops.Move(["A", "A/x.md", "a.md"], "X");
        Assert.Equal(2, moved.Count);
        Assert.True(File.Exists(Path.Combine(t.Path, "X", "A", "x.md")));
        Assert.True(File.Exists(Path.Combine(t.Path, "X", "a.md")));
    }

    [Fact]
    public void FileOps_Create_Rename_Move_Duplicate_Never_Overwrite()
    {
        using var t = new TempDir();
        var ops = new VaultFileOps(t.Path);
        var a = ops.CreateNote("");
        var b = ops.CreateNote("");
        Assert.Equal("Untitled.md", a);
        Assert.Equal("Untitled 2.md", b);
        File.WriteAllText(Path.Combine(t.Path, a), "keep me");
        Assert.Throws<VaultOperationException>(() => ops.Rename(b, "Untitled.md"));
        Assert.Equal("keep me", File.ReadAllText(Path.Combine(t.Path, a)));

        var folder = ops.CreateFolder("", "World");
        var moved = ops.Move([a], folder);
        Assert.Single(moved);
        Assert.True(File.Exists(Path.Combine(t.Path, "World", "Untitled.md")));
        Assert.Throws<VaultOperationException>(() => ops.Move([folder], folder)); // into itself
        Assert.Throws<VaultOperationException>(() => ops.CreateFolder("", "../escape"));

        var renamed = ops.Rename("World/Untitled.md", "Rivers.md");
        Assert.EndsWith(Path.Combine("World", "Rivers.md"), renamed.NewFull);
        var caseOnly = ops.Rename("World/Rivers.md", "RIVERS.md");
        Assert.Equal("RIVERS.md", Path.GetFileName(Directory.GetFiles(Path.Combine(t.Path, "World")).Single()));

        var dup = ops.Duplicate("World/RIVERS.md");
        Assert.Equal("World/RIVERS copy.md", dup);
        Assert.Equal("keep me", File.ReadAllText(Path.Combine(t.Path, "World", "RIVERS copy.md")));
        var dupFolder = ops.Duplicate("World");
        Assert.Equal("World copy", dupFolder);
        Assert.Equal(2, Directory.GetFiles(Path.Combine(t.Path, "World copy")).Length);
    }

    [Fact]
    public void Search_Finds_Names_And_Content_Ignoring_Case_And_Diacritics()
    {
        using var t = new TempDir();
        Write(t, "World/Żółw.md", "# Turtle\n\nThe turtle swims in the river.\n");
        Write(t, "Rivers.md", "# Rivers\n\nWide RIVER with fish.\nNothing here.\n");
        Write(t, "image.png", "not text");
        var index = new VaultIndex(t.Path);
        Assert.Equal(2, index.Update(VaultScanner.Scan(t.Path, [])));
        var hits = index.Search("zolw");
        Assert.True(hits[0].NameMatch && hits[0].Path == "World/Żółw.md");
        var river = index.Search("river");
        Assert.Contains(river, h => h.NameMatch && h.Path == "Rivers.md");
        Assert.Contains(river, h => !h.NameMatch && h.Path == "World/Żółw.md" && h.Line == 3);
        Assert.Contains(river, h => !h.NameMatch && h.Path == "Rivers.md" && h.Snippet == "Wide RIVER with fish.");
        Assert.Empty(index.Search("river fish nowhere"));

        // Incremental: unchanged notes are not re-read; edits are picked up.
        Assert.Equal(0, index.Update(VaultScanner.Scan(t.Path, [])));
        File.WriteAllText(Path.Combine(t.Path, "Rivers.md"), "Lakes only, a much longer text now");
        File.SetLastWriteTimeUtc(Path.Combine(t.Path, "Rivers.md"), DateTime.UtcNow.AddMinutes(1));
        Assert.Equal(1, index.Update(VaultScanner.Scan(t.Path, [])));
        Assert.Contains(index.Search("lakes"), h => h.Path == "Rivers.md");
    }

    [Fact]
    public void Links_Resolve_Relative_And_Wiki_Links_And_Backlinks_Find_Both()
    {
        var notes = new[] { "World/Rivers.md", "World/Seas.md", "Notes/Rivers.md", "Index.md", "Notes/Plan.md" };
        Assert.Equal("World/Rivers.md", VaultLinks.Resolve("Notes/Plan.md", new VaultLink("../World/Rivers.md", false), notes));
        Assert.Equal("World/Seas.md", VaultLinks.Resolve("Index.md", new VaultLink("World/Seas.md#deep", false), notes));
        Assert.Null(VaultLinks.Resolve("Index.md", new VaultLink("https://example.com/a.md", false), notes));
        Assert.Null(VaultLinks.Resolve("Index.md", new VaultLink("../../etc/x.md", false), notes));
        // Two "Rivers": the one next to the linking note wins.
        Assert.Equal("Notes/Rivers.md", VaultLinks.Resolve("Notes/Plan.md", new VaultLink("Rivers", true), notes));
        Assert.Equal("World/Rivers.md", VaultLinks.Resolve("Notes/Plan.md", new VaultLink("World/Rivers", true), notes));
        Assert.Equal("World/Seas.md", VaultLinks.Resolve("Notes/Plan.md", new VaultLink("Seas", true), notes));
        Assert.Equal(["My%20note.md", "Rivers"], VaultLinks.Extract("See [x](My%20note.md) and [[Rivers|the rivers]] and ![img](a.png)").Select(l => l.Target));

        using var t = new TempDir();
        Write(t, "World/Rivers.md", "# Rivers");
        Write(t, "Index.md", "Start: [Rivers](World/Rivers.md)\n");
        Write(t, "Notes/Plan.md", "Plan\n\nMention [[Rivers]] here.\n");
        Write(t, "Notes/Other.md", "No links.");
        var index = new VaultIndex(t.Path);
        index.Update(VaultScanner.Scan(t.Path, []));
        var back = index.Backlinks("World/Rivers.md");
        Assert.Equal(["Index.md", "Notes/Plan.md"], back.Select(b => b.Source));
        Assert.Equal(3, back[1].Line);
    }

    [Fact]
    public void Relative_Image_Links_Stay_Inside_The_Vault()
    {
        using var t = new TempDir();
        var img = Write(t, "Images/forest.png", "png");
        var note = Write(t, "Notes/Deep/x.md", "x");
        Assert.True(LinkPaths.TryRelative(Path.GetDirectoryName(note)!, img, t.Path, out var link));
        Assert.Equal("../../Images/forest.png", link);
        Assert.False(LinkPaths.TryRelative(Path.GetDirectoryName(note)!, img, Path.Combine(t.Path, "Notes"), out _));

        // The browser drops "../", so the request is /Images/forest.png; the resolver walks up to the Vault root only.
        var web = Path.Combine(t.Path, "web");
        Directory.CreateDirectory(web);
        var found = AssetResolver.Resolve(new Uri("https://noormd.local/Images/forest.png"), web, Path.GetDirectoryName(note), t.Path);
        Assert.Equal(img, found);
        Assert.Null(AssetResolver.Resolve(new Uri("https://noormd.local/Images/forest.png"), web, Path.GetDirectoryName(note), null));
        Assert.Null(AssetResolver.Resolve(new Uri("https://noormd.local/Images/forest.png"), web, Path.GetDirectoryName(note), Path.Combine(t.Path, "Notes")));
    }

    [Fact]
    public void Vault_List_Is_Remembered_Most_Recent_First_With_Options_Normalized()
    {
        using var t = new TempDir();
        var s = new AppSettings();
        var a = s.TouchVault(Path.Combine(t.Path, "A"));
        a.Excluded = ["Drafts", "bad/name", "Drafts"];
        a.Attachments = "../escape";
        s.TouchVault(Path.Combine(t.Path, "B"));
        s.TouchVault(Path.Combine(t.Path, "A") + Path.DirectorySeparatorChar);
        Assert.Equal(["A", "B"], s.Vaults.Select(v => v.Name));
        Assert.Equal(["Drafts"], s.Vaults[0].Excluded);
        Assert.Equal("attachments", s.Vaults[0].Attachments);
    }
}
