using System.Text;

namespace NoorMD.Core.Vaults;

public sealed record VaultPreset(string Id, string Name, string Icon, string Description, IReadOnlyList<string> Folders, IReadOnlyDictionary<string, string> Notes);

/// <summary>
/// Starting points for a new Vault: folders and a few short notes that show how links and tags work. Applying a
/// preset only adds what is missing; it never overwrites a file. Every Vault gets a Home note and an attachments folder.
/// </summary>
public static class VaultPresets
{
    public const string Home = "Home.md";

    public static readonly IReadOnlyList<VaultPreset> All =
    [
        new("blank", "Empty", "▫", "Just a Home note and an attachments folder. Build your own structure.",
            ["attachments"],
            new Dictionary<string, string>()),

        new("notes", "Personal notes", "🗂", "Inbox for quick capture, notes, a journal, projects and an archive.",
            ["Inbox", "Notes", "Journal", "Projects", "Archive", "attachments"],
            new Dictionary<string, string>
            {
                ["Inbox/Read me first.md"] = "# Inbox\n\nDrop quick notes here and sort them later into the Notes folder or a project. #inbox\n",
                ["Projects/Example project.md"] = "---\ntags: [project]\n---\n# Example project\n\n## Goal\n\n## Next steps\n- [ ] First step\n\n## Notes\n",
            }),

        new("writer", "Writer", "✒", "A manuscript in chapters, characters, places, research and drafts.",
            ["Manuscript", "Characters", "Places", "Research", "Drafts", "Archive", "attachments"],
            new Dictionary<string, string>
            {
                ["Manuscript/01 Chapter one.md"] = "# Chapter one\n\n#chapter #draft\n\n",
                ["Characters/_Character template.md"] = "---\ntags: [character]\n---\n# Name\n\n- **Role:**\n- **Wants:**\n- **Fears:**\n- **First appears:** [[01 Chapter one]]\n\n## Notes\n",
                ["Places/_Place template.md"] = "---\ntags: [place]\n---\n# Place\n\n- **Where:**\n- **Mood:**\n\n## Notes\n",
            }),

        new("world", "Worldbuilding", "🗺", "Regions, characters, factions, history, lore, maps and game sessions.",
            ["World/Regions", "World/Cities", "Characters", "Factions", "History", "Lore", "Maps", "Sessions", "attachments"],
            new Dictionary<string, string>
            {
                ["History/Timeline.md"] = "# Timeline\n\n| Year | Event |\n|---|---|\n|  |  |\n\n#history\n",
                ["Factions/_Faction template.md"] = "---\ntags: [faction]\n---\n# Faction\n\n- **Leader:**\n- **Seat:**\n- **Goals:**\n\n## Relations\n",
                ["Sessions/Session 1.md"] = "---\ntags: [session]\n---\n# Session 1\n\n## Recap\n\n## Loot & hooks\n",
            }),

        new("creator", "Streamer / creator", "📡", "Streams, supporters, video ideas, thumbnails and music notes. Matches NoorStream.",
            ["Streams", "Stream", "Videos/Ideas", "Videos/Published", "Thumbnails", "Music", "attachments"],
            new Dictionary<string, string>
            {
                ["Videos/Ideas/Video idea template.md"] = "---\ntags: [idea, video]\n---\n# Working title\n\n- **Hook:**\n- **Length:**\n- **Thumbnail idea:**\n\n## Outline\n",
                ["Music/Tracks used in videos.md"] = "# Tracks used in videos\n\n| Track | Video | Date |\n|---|---|---|\n|  |  |  |\n\n#music #licensing\n",
                ["Stream/README.md"] = "# Stream\n\nThe NoorStream keeps the supporters list here (Supporters.md); stream notes go to the Streams folder. #stream\n",
            }),

        new("gamedev", "Game development", "🎮", "Design docs, a devlog, tasks, playtests, assets and a changelog.",
            ["Design", "Devlog", "Tasks", "Playtests", "Assets", "attachments"],
            new Dictionary<string, string>
            {
                ["Design/Game overview.md"] = "---\ntags: [design]\n---\n# Game overview\n\n- **Pitch:**\n- **Core loop:**\n- **Platforms:**\n\n## Pillars\n",
                ["Changelog.md"] = "# Changelog\n\n## Unreleased\n- \n\n#release\n",
                ["Playtests/Playtest template.md"] = "---\ntags: [playtest]\n---\n# Playtest — date\n\n## What we tested\n\n## What players did\n\n## Fixes\n- [ ] \n",
            }),
    ];

    public static VaultPreset Get(string? id) => All.FirstOrDefault(p => p.Id == id) ?? All[0];

    /// <summary>Creates the preset's folders and notes in an existing folder. Existing files are kept. Returns the Home note path.</summary>
    public static string Apply(string root, string? presetId, string vaultName)
    {
        var p = Get(presetId);
        var utf8 = new UTF8Encoding(false);
        foreach (var f in p.Folders) Directory.CreateDirectory(Path.Combine(root, f.Replace('/', Path.DirectorySeparatorChar)));
        foreach (var (rel, text) in p.Notes)
        {
            var full = Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            if (!File.Exists(full)) File.WriteAllText(full, text, utf8);
        }
        var home = Path.Combine(root, Home);
        if (!File.Exists(home)) File.WriteAllText(home, HomeNote(p, vaultName), utf8);
        return home;
    }

    private static string HomeNote(VaultPreset p, string name)
    {
        var sb = new StringBuilder($"# {name}\n\n");
        sb.Append("This Vault is an ordinary folder: every note is a plain Markdown file you can open anywhere.\n\n");
        var top = p.Folders.Where(f => f != "attachments").Select(f => f.Split('/')[0]).Distinct().ToList();
        if (top.Count > 0)
        {
            sb.Append("## Folders\n\n");
            foreach (var f in top) sb.Append("- **").Append(f).Append("**\n");
            sb.Append('\n');
        }
        if (p.Notes.Count > 0)
        {
            sb.Append("## Start here\n\n");
            foreach (var rel in p.Notes.Keys) sb.Append("- [[").Append(Path.GetFileNameWithoutExtension(rel)).Append("]]\n");
            sb.Append('\n');
        }
        sb.Append("## Tips\n\n");
        sb.Append("- Link notes with `[[Note name]]` or `[text](Folder/Note.md)`; renaming a note in NoorMD updates its links.\n");
        sb.Append("- Tag notes with `#idea` (or `tags: [idea]` at the top) and browse them in the sidebar under **Tags**.\n");
        sb.Append("- Ctrl+Shift+F searches every note; Ctrl+E jumps to one.\n");
        sb.Append("- Pictures and other files go to *attachments*.\n");
        return sb.ToString();
    }
}
