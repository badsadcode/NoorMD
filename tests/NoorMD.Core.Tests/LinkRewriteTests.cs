using NoorMD.Core.Vaults;
using Xunit;

namespace NoorMD.Core.Tests;

public class LinkRewriteTests
{
    private static readonly string[] Files =
    [
        "Index.md", "World/Rivers.md", "World/Lakes.md", "World/Deep/Caves.md", "Images/map.png", "Images/my photo.jpg",
        "Notes/Rivers.md", "Journal/v1.2 notes.md", "Trips/Day one.md",
    ];

    private static Dictionary<string, string> Map(params (string, string)[] moves) => moves.ToDictionary(m => m.Item1, m => m.Item2, StringComparer.OrdinalIgnoreCase);

    [Fact]
    public void Renaming_A_Note_Updates_Markdown_And_Wiki_Links_To_It()
    {
        var text = "See [rivers](World/Rivers.md#delta), [[World/Rivers]] and [[Caves|the caves]].\n";
        var r = VaultLinkRewriter.Rewrite(text, "Index.md", Map(("World/Rivers.md", "World/Streams.md"), ("World/Deep/Caves.md", "World/Deep/Grottoes.md")), Files);
        Assert.Equal("See [rivers](World/Streams.md#delta), [[World/Streams]] and [[Grottoes|the caves]].\n", r.Text);
        Assert.Equal(3, r.Changed);
    }

    [Fact]
    public void Wiki_Links_With_Escaped_Brackets_Are_Found_And_Rewritten_As_Plain_Wiki_Links()
    {
        // What a [[link]] typed in Visual mode used to be saved as.
        var text = "See \\[\\[Day one\\]\\], \\[\\[Trips/Day one|the first day\\]\\] and \\[\\[Nowhere\\]\\].\n";
        var r = VaultLinkRewriter.Rewrite(text, "Index.md", Map(("Trips/Day one.md", "Trips/Day_1.md")), Files);
        Assert.Equal("See [[Day_1]], [[Trips/Day_1|the first day]] and \\[\\[Nowhere\\]\\].\n", r.Text);
        Assert.Equal(2, r.Changed);
        Assert.Equal(["Day one", "Trips/Day one", "Nowhere"], VaultLinks.Extract(text).Select(l => l.Target));
        Assert.Equal(["My_Note"], VaultLinks.Extract("\\[\\[My\\_Note\\]\\] \\\\[\\[not\\]\\]").Select(l => l.Target));
    }

    [Fact]
    public void A_Moved_Note_Keeps_Its_Own_Relative_Links_And_Images_Working()
    {
        var text = "![map](../Images/map.png)\n[lakes](Lakes.md) and [home](../Index.md)\n![p](<../Images/my photo.jpg>) ![p2](../Images/my%20photo.jpg)\n";
        var r = VaultLinkRewriter.Rewrite(text, "World/Rivers.md", Map(("World/Rivers.md", "Archive/2026/Rivers.md")), Files);
        Assert.Equal("![map](../../Images/map.png)\n[lakes](../../World/Lakes.md) and [home](../../Index.md)\n![p](<../../Images/my photo.jpg>) ![p2](../../Images/my%20photo.jpg)\n", r.Text);
        Assert.Equal(5, r.Changed);
    }

    [Fact]
    public void Moving_A_Folder_Moves_Every_File_In_It()
    {
        var moves = VaultLinkRewriter.ExpandMoves([("World", "Places/World", true)], Files);
        Assert.Equal("Places/World/Deep/Caves.md", moves["World/Deep/Caves.md"]);
        Assert.Equal(3, moves.Count);
        var r = VaultLinkRewriter.Rewrite("[c](World/Deep/Caves.md) [[World/Lakes]] [[Caves]]", "Index.md", moves, Files);
        Assert.Equal("[c](Places/World/Deep/Caves.md) [[Places/World/Lakes]] [[Caves]]", r.Text); // a unique name still finds it
        // Inside the moved folder, links between its notes don't change.
        var inside = VaultLinkRewriter.Rewrite("[l](Lakes.md) [d](Deep/Caves.md)", "World/Rivers.md", moves, Files);
        Assert.Equal(0, inside.Changed);
    }

    [Fact]
    public void A_Name_That_Becomes_Ambiguous_Is_Written_As_A_Path()
    {
        // Two notes called "Rivers": the short name is only safe while it still finds the right one.
        var r = VaultLinkRewriter.Rewrite("[[Lakes]]", "World/Rivers.md", Map(("World/Lakes.md", "Notes/Lakes.md")), [.. Files, "World/Lakes.md"]);
        Assert.Equal("[[Lakes]]", r.Text); // nearest-folder rule: still unique by name
        var clash = VaultLinkRewriter.Rewrite("[[Caves]]", "Index.md", Map(("World/Deep/Caves.md", "Notes/Rivers.md")), Files.Where(f => f != "Notes/Rivers.md").ToList());
        Assert.Equal("[[Notes/Rivers]]", clash.Text); // "Rivers" would now also match World/Rivers.md
        var rename = VaultLinkRewriter.Rewrite("[[World/Rivers]] [[Rivers]]", "Index.md", Map(("Notes/Rivers.md", "Notes/Lakes.md")), Files);
        Assert.Equal("[[World/Rivers]] [[Rivers]]", rename.Text); // these pointed at World/Rivers.md (nearest, shortest), which didn't move
    }

    [Fact]
    public void Links_In_Code_External_Links_And_Unknown_Targets_Are_Left_Alone()
    {
        var text = "```\n[x](World/Rivers.md)\n```\n`[[World/Rivers]]` [web](https://example.com/World/Rivers.md) [gone](Nope.md) [top](#intro)\n[ok](World/Rivers.md)\n";
        var r = VaultLinkRewriter.Rewrite(text, "Index.md", Map(("World/Rivers.md", "World/Streams.md")), Files);
        Assert.Equal(text.Replace("[ok](World/Rivers.md)", "[ok](World/Streams.md)"), r.Text);
        Assert.Equal(1, r.Changed);
    }

    [Fact]
    public void Embeds_Notes_With_Dots_And_Spaces_And_Titles_Keep_Their_Form()
    {
        var text = "![[map.png]] [[v1.2 notes]] [d](<Trips/Day one.md> \"Day\") [d2](Trips/Day%20one.md)\n";
        var r = VaultLinkRewriter.Rewrite(text, "Index.md",
            Map(("Images/map.png", "Assets/world map.png"), ("Journal/v1.2 notes.md", "Journal/v1.3 notes.md"), ("Trips/Day one.md", "Trips/Day 1.md")), Files);
        Assert.Equal("![[world map.png]] [[v1.3 notes]] [d](<Trips/Day 1.md> \"Day\") [d2](Trips/Day%201.md)\n", r.Text);
    }

    [Fact]
    public void Nothing_Moved_Means_The_Text_Is_Returned_As_Is()
    {
        const string text = "[a](World/Rivers.md) [[Caves]]\r\n";
        var r = VaultLinkRewriter.Rewrite(text, "Index.md", Map(), Files);
        Assert.Same(text, r.Text);
        Assert.Equal(0, r.Changed);
        Assert.Equal("../Images/a.png", VaultLinkRewriter.Relative("World/x.md", "Images/a.png"));
        Assert.Equal("b.md", VaultLinkRewriter.Relative("World/x.md", "World/b.md"));
    }
}
