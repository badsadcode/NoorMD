using System.IO.Compression;
using System.Text;
using NoorMD.Core.Vaults;
using Xunit;

namespace NoorMD.Core.Tests;

public class PackagingTests
{
    private static TempDir MakeVault()
    {
        var t = new TempDir();
        void W(string rel, string text)
        {
            var full = Path.Combine(t.Path, rel.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllText(full, text, new UTF8Encoding(false));
        }
        W("World/Rivers.md", "# Rivers\n\n![forest](../Images/forest.png)\n\nSee [[Seas]] and [gone](Missing.md) and [web](https://example.com).\n");
        W("World/Deep/Lakes.md", "# Lakes\n");
        W("World/notes.txt", "plain");
        W("World/.env", "SECRET=1");
        W("World/cache/x.tmp", "tmp");
        W("Images/forest.png", "PNGDATA");
        W("Images/unused.png", "PNG2");
        W("Seas.md", "# Seas\n");
        W("README.md", "# My own readme");
        W(".obsidian/app.json", "{}");
        W(".git/HEAD", "ref");
        return t;
    }

    private static List<string> Entries(string zip)
    {
        using var z = ZipFile.OpenRead(zip);
        return z.Entries.Select(e => e.FullName).OrderBy(x => x, StringComparer.Ordinal).ToList();
    }

    [Fact]
    public void Folder_Export_Keeps_Vault_Relative_Paths_And_Applies_Visible_Exclusions()
    {
        using var t = MakeVault();
        var plan = PackagePlanner.Build(t.Path, new PackageOptions { Selection = ["World"] });
        Assert.Equal(["World/Deep/Lakes.md", "World/Rivers.md", "World/notes.txt"], plan.Files.Select(f => f.Entry).OrderBy(x => x, StringComparer.Ordinal));
        Assert.Contains(plan.Excluded, e => e.Path == "World/.env" && e.Rule == ".env");
        Assert.Contains(plan.Excluded, e => e.Path == "World/cache/x.tmp" && e.Rule == "*.tmp");
        // Links: the image and [[Seas]] are outside the selection → dependencies; Missing.md is reported.
        Assert.Equal(["Images/forest.png", "Seas.md"], plan.Dependencies.Select(d => d.Path).OrderBy(x => x, StringComparer.Ordinal));
        Assert.All(plan.Dependencies, d => Assert.False(d.Included));
        Assert.Contains(plan.Unresolved, u => u.Target == "Missing.md" && u.Problem == "file not found");
        Assert.DoesNotContain(plan.Unresolved, u => u.Target.StartsWith("https"));

        var zip = Path.Combine(t.Path, "out.zip");
        var result = ZipPackager.Create(plan, zip, null, CancellationToken.None);
        Assert.Empty(result.Failures);
        Assert.Equal(["World/Deep/Lakes.md", "World/Rivers.md", "World/notes.txt"], Entries(zip));
    }

    [Fact]
    public void Dependencies_Can_Be_Included_Or_Skipped_One_By_One()
    {
        using var t = MakeVault();
        var plan = PackagePlanner.Build(t.Path, new PackageOptions { Selection = ["World/Rivers.md"], IncludeDependencies = true, SkipDependencies = ["Seas.md"] });
        Assert.Equal(["Images/forest.png", "World/Rivers.md"], plan.Files.Select(f => f.Entry).OrderBy(x => x, StringComparer.Ordinal));
        Assert.Equal(PackReason.Dependency, plan.Files.Single(f => f.Entry == "Images/forest.png").Reason);
        Assert.False(plan.Dependencies.Single(d => d.Path == "Seas.md").Included);

        // Unpacked, the relative image link from World/Rivers.md still points at the packed picture.
        var zip = Path.Combine(t.Path, "deps.zip");
        ZipPackager.Create(plan, zip, null, CancellationToken.None);
        var outDir = Path.Combine(t.Path, "unpacked");
        ZipFile.ExtractToDirectory(zip, outDir);
        Assert.True(File.Exists(Path.GetFullPath(Path.Combine(outDir, "World", "../Images/forest.png"))));
    }

    [Fact]
    public void Whole_Vault_Skips_Other_Tools_Folders_Unless_The_Rule_Is_Removed()
    {
        using var t = MakeVault();
        var plan = PackagePlanner.Build(t.Path, new PackageOptions());
        Assert.DoesNotContain(plan.Files, f => f.Entry.StartsWith(".obsidian") || f.Entry.StartsWith(".git"));
        Assert.Contains(plan.Excluded, e => e.Path == ".obsidian/" && e.Rule == ".obsidian/");
        var opts = new PackageOptions();
        opts.Exclusions.Remove(".obsidian/");
        Assert.Contains(PackagePlanner.Build(t.Path, opts).Files, f => f.Entry == ".obsidian/app.json");
    }

    [Fact]
    public void Several_Unrelated_Items_Keep_Their_Folders_And_Flatten_Makes_Names_Unique()
    {
        using var t = MakeVault();
        var plan = PackagePlanner.Build(t.Path, new PackageOptions { Selection = ["Seas.md", "World/Deep", "Images/unused.png"] });
        Assert.Equal(["Images/unused.png", "Seas.md", "World/Deep/Lakes.md"], plan.Files.Select(f => f.Entry).OrderBy(x => x, StringComparer.Ordinal));
        File.WriteAllText(Path.Combine(t.Path, "World", "Deep", "Seas.md"), "other seas");
        var flat = PackagePlanner.Build(t.Path, new PackageOptions { Selection = ["Seas.md", "World/Deep"], PreserveStructure = false });
        Assert.Equal(["Lakes.md", "Seas (2).md", "Seas.md"], flat.Files.Select(f => f.Entry).OrderBy(x => x, StringComparer.Ordinal));
        Assert.Contains(flat.Warnings, w => w.Contains("flattened"));
    }

    [Fact]
    public void Handoff_Writes_Generated_Files_In_Their_Own_Folder_And_Never_Overwrites_A_Readme()
    {
        using var t = MakeVault();
        var plan = PackagePlanner.Build(t.Path, new PackageOptions { Handoff = true, HandoffNote = "Please review the river chapter.\nKeep names." });
        var readme = plan.Generated.Single(g => g.Entry == "_noormd_handoff/README.md").Text;
        Assert.Contains("> Please review the river chapter.", readme);
        Assert.Contains("Missing.md", readme); // unresolved link reported
        Assert.DoesNotContain("summar", readme.Replace("does not summarize", ""), StringComparison.OrdinalIgnoreCase);
        var manifest = plan.Generated.Single(g => g.Entry == "_noormd_handoff/MANIFEST.md").Text;
        Assert.Contains("| World/Rivers.md | md |", manifest);

        var zip = Path.Combine(t.Path, "handoff.zip");
        ZipPackager.Create(plan, zip, null, CancellationToken.None);
        using var z = ZipFile.OpenRead(zip);
        using var r = new StreamReader(z.GetEntry("README.md")!.Open());
        Assert.Equal("# My own readme", r.ReadToEnd()); // the user's README is untouched
        Assert.NotNull(z.GetEntry("_noormd_handoff/README.md"));

        // Without the note, nothing is invented.
        var plain = PackagePlanner.Build(t.Path, new PackageOptions { Handoff = true });
        Assert.DoesNotContain("Instructions from the sender", plain.Generated.Single(g => g.Entry.EndsWith("README.md")).Text);
    }

    [Fact]
    public void Output_Inside_The_Selection_Is_Never_Packed_And_Cancel_Leaves_Nothing()
    {
        using var t = MakeVault();
        var zip = Path.Combine(t.Path, "World", "World.zip");
        File.WriteAllText(zip, "old archive");
        var plan = PackagePlanner.Build(t.Path, new PackageOptions { Selection = ["World"], OutputPath = zip });
        Assert.DoesNotContain(plan.Files, f => f.Entry == "World/World.zip");
        Assert.Contains(plan.Excluded, e => e.Rule == "the archive being created");

        using var cts = new CancellationTokenSource();
        cts.Cancel();
        var before = Directory.GetFiles(Path.Combine(t.Path, "World")).Length;
        Assert.ThrowsAny<OperationCanceledException>(() => ZipPackager.Create(plan, zip, null, cts.Token));
        Assert.Equal("old archive", File.ReadAllText(zip)); // the earlier file is untouched
        Assert.Equal(before, Directory.GetFiles(Path.Combine(t.Path, "World")).Length); // no temporary left behind
        Assert.Equal("# Rivers", File.ReadAllLines(Path.Combine(t.Path, "World", "Rivers.md"))[0]); // sources unchanged
    }

    [Theory]
    [InlineData("a/b.md", true)]
    [InlineData("../x.md", false)]
    [InlineData("/abs.md", false)]
    [InlineData("C:/x.md", false)]
    [InlineData("a//b.md", false)]
    [InlineData("a\\b.md", false)]
    public void Entry_Paths_Are_Safe_To_Extract(string entry, bool ok) => Assert.Equal(ok, PackagePlanner.SafeEntry(entry));

    [Fact]
    public void Exclusion_Rules_Match_Folders_Anywhere_And_File_Globs()
    {
        string[] rules = ["node_modules/", "*.pem", "id_rsa*"];
        Assert.Equal("node_modules/", PackagePlanner.Rule("app/node_modules/x/index.js", rules));
        Assert.Equal("*.pem", PackagePlanner.Rule("keys/server.PEM", rules));
        Assert.Equal("id_rsa*", PackagePlanner.Rule("id_rsa.pub", rules));
        Assert.Null(PackagePlanner.Rule("notes/node_modules.md", rules));
    }

    [Fact]
    public void A_Locked_File_Is_Reported_And_The_Rest_Is_Packed()
    {
        using var t = MakeVault();
        var plan = PackagePlanner.Build(t.Path, new PackageOptions { Selection = ["World"] });
        File.Delete(Path.Combine(t.Path, "World", "notes.txt")); // changed between preview and export
        var result = ZipPackager.Create(plan, Path.Combine(t.Path, "partial.zip"), null, CancellationToken.None);
        Assert.Single(result.Failures);
        Assert.Equal("World/notes.txt", result.Failures[0].Entry);
        Assert.Equal(2, Entries(result.Path).Count);
    }
}
