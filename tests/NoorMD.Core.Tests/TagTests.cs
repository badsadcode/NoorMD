using NoorMD.Core.Vaults;
using Xunit;

namespace NoorMD.Core.Tests;

public class TagTests
{
    [Fact]
    public void Inline_Tags_Are_Found_Like_Obsidian()
    {
        var text = "# Heading\n## Not a tag\nIdea for #worldbuilding and #project/alpha, also #Żółw-2.\nSee [part](#anchor) and page#section, issue #123, color #fff?\n";
        Assert.Equal(["worldbuilding", "project/alpha", "Żółw-2", "fff"], VaultTags.Extract(text));
    }

    [Fact]
    public void Front_Matter_Tags_In_Every_Common_Form()
    {
        Assert.Equal(["stream", "suno-music"], VaultTags.Extract("---\ntitle: x\ntags: [stream, \"suno-music\", \"has space\"]\n---\nBody #stream\n")); // like Obsidian: no spaces in tags
        Assert.Equal(["a", "b"], VaultTags.Extract("---\ntags: a, b\n---\n"));
        Assert.Equal(["lore", "map"], VaultTags.Extract("---\ntags:\n  - lore\n  - \"#map\"\ntitle: y\n---\n"));
        Assert.Equal(["single"], VaultTags.Extract("---\ntag: single\n---\n"));
    }

    [Fact]
    public void Code_Is_Not_Searched_And_Duplicates_Count_Once()
    {
        var text = "```\n#notatag\n```\nInline `#nope` here #yes #YES\n    #indented code\n";
        Assert.Equal(["yes"], VaultTags.Extract(text));
        Assert.True(VaultTags.Matches("project/alpha", "project"));
        Assert.True(VaultTags.Matches("Project", "project"));
        Assert.False(VaultTags.Matches("projects", "project"));
    }

    [Fact]
    public void The_Index_Counts_Tags_And_Finds_Tagged_Notes()
    {
        var root = Path.Combine(Path.GetTempPath(), "noormd-tags-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "World"));
        try
        {
            File.WriteAllText(Path.Combine(root, "A.md"), "#lore #project/alpha");
            File.WriteAllText(Path.Combine(root, "World", "B.md"), "---\ntags: [Lore]\n---\n#project");
            File.WriteAllText(Path.Combine(root, "C.md"), "nothing");
            var index = new VaultIndex(root);
            index.Update(VaultScanner.Scan(root, []));
            var tags = index.Tags();
            Assert.Equal(["lore", "project", "project/alpha"], tags.Select(t => t.Tag.ToLowerInvariant()));
            Assert.Equal(2, tags.First(t => t.Tag.Equals("lore", StringComparison.OrdinalIgnoreCase)).Count);
            Assert.Equal(["A.md", "World/B.md"], index.Tagged("project"));
            Assert.Equal(["A.md"], index.Tagged("project/alpha"));
            Assert.Equal(["lore", "project/alpha"], index.TagsOf("A.md"));
        }
        finally { Directory.Delete(root, true); }
    }
}

public class VaultPresetTests
{
    [Fact]
    public void Every_Preset_Creates_Its_Folders_Notes_And_A_Home_Whose_Links_Work()
    {
        foreach (var preset in VaultPresets.All)
        {
            var root = Path.Combine(Path.GetTempPath(), "noormd-preset-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            try
            {
                var home = VaultPresets.Apply(root, preset.Id, "Atlas Żółw");
                Assert.Equal(Path.Combine(root, "Home.md"), home);
                foreach (var f in preset.Folders) Assert.True(Directory.Exists(Path.Combine(root, f)), $"{preset.Id}: {f}");
                foreach (var n in preset.Notes.Keys) Assert.True(File.Exists(Path.Combine(root, n)), $"{preset.Id}: {n}");
                var text = File.ReadAllText(home);
                Assert.StartsWith("# Atlas Żółw\n", text);
                Assert.Empty(VaultTags.Extract(text)); // the tips show tags as code, so Home adds no tag
                var notes = VaultScanner.Scan(root, []).Where(e => !e.IsFolder && VaultPaths.IsNote(e.Path)).Select(e => e.Path).ToList();
                foreach (var link in VaultLinks.Extract(System.Text.RegularExpressions.Regex.Replace(text, "`[^`]*`", "")).Where(l => l.Wiki))
                    Assert.True(VaultLinks.Resolve("Home.md", link, notes) != null, $"{preset.Id}: [[{link.Target}]] leads nowhere");
                // Starter notes only link to notes that exist, too.
                foreach (var n in preset.Notes)
                    foreach (var link in VaultLinks.Extract(n.Value).Where(l => l.Wiki))
                        Assert.True(VaultLinks.Resolve(n.Key, link, notes) != null, $"{preset.Id}/{n.Key}: [[{link.Target}]] leads nowhere");
            }
            finally { Directory.Delete(root, true); }
        }
    }

    [Fact]
    public void Applying_A_Preset_Never_Overwrites_And_Unknown_Ids_Fall_Back_To_Empty()
    {
        var root = Path.Combine(Path.GetTempPath(), "noormd-preset-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "Projects"));
        try
        {
            File.WriteAllText(Path.Combine(root, "Home.md"), "mine");
            File.WriteAllText(Path.Combine(root, "Projects", "Example project.md"), "also mine");
            VaultPresets.Apply(root, "notes", "X");
            Assert.Equal("mine", File.ReadAllText(Path.Combine(root, "Home.md")));
            Assert.Equal("also mine", File.ReadAllText(Path.Combine(root, "Projects", "Example project.md")));
            Assert.True(File.Exists(Path.Combine(root, "Inbox", "Read me first.md")));
            Assert.Equal("blank", VaultPresets.Get("nope").Id);
            Assert.Equal(VaultPresets.All.Count, VaultPresets.All.Select(p => p.Id).Distinct().Count());
        }
        finally { Directory.Delete(root, true); }
    }
}
