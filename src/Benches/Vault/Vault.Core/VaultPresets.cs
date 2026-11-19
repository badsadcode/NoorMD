using System.Text;

namespace Vault.Core;

public sealed record VaultPreset(string Id, string Name, string Icon, string Description, IReadOnlyList<string> Folders, IReadOnlyDictionary<string, string> Notes)
{
    /// <summary>A short "good for" line the wizard shows under the name.</summary>
    public string GoodFor { get; init; } = "";
    /// <summary>Notes under <c>Templates/</c> become the vault's templates.</summary>
    public string Group { get; init; } = "Start simple";
}

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
            new Dictionary<string, string>()) { GoodFor = "You already know how you like to organise things." },

        // The popular structures (the ideas behind them, written for NoorMD).
        new("para", "PARA", "📂", "Projects (with a deadline), Areas (ongoing responsibilities), Resources (topics of interest) and an Archive.",
            ["1 Projects", "2 Areas", "3 Resources", "4 Archive", "Inbox", "Templates", "attachments"],
            new Dictionary<string, string>
            {
                ["Inbox/Read me first.md"] = "# Inbox\n\nCapture first, sort later: once a week, move each note to a project, an area, a resource or the archive. #inbox\n",
                ["1 Projects/Example project.md"] = "---\ntags: [project]\ndeadline: \nstatus: active\n---\n# Example project\n\n## Outcome\n\n## Next actions\n- [ ] \n\n## Notes\n",
                ["2 Areas/Health.md"] = "---\ntags: [area]\n---\n# Health\n\nAn area has no finish line: it's something you keep up. Link projects that serve it here.\n",
                ["Templates/Project.md"] = "---\ntags: [project]\ndeadline: \nstatus: active\n---\n# {{title}}\n\n## Outcome\n\n## Next actions\n- [ ] \n",
                ["Templates/Weekly review.md"] = "# Weekly review {{date}}\n\n- [ ] Empty the Inbox\n- [ ] Look at every active project\n- [ ] Archive what's done\n",
            }) { GoodFor = "Work and life admin: keeping projects moving.", Group = "Popular structures" },

        new("zettelkasten", "Zettelkasten", "🗃", "Small, linked notes in your own words: fleeting notes, literature notes and permanent notes, joined by links and index notes.",
            ["Fleeting", "Literature", "Permanent", "Index", "Templates", "attachments"],
            new Dictionary<string, string>
            {
                ["Index/Start here.md"] = "# Start here\n\nAn index note: a door into a topic. Link the permanent notes that belong to it.\n\n- [[One idea per note]]\n",
                ["Permanent/One idea per note.md"] = "---\ntags: [permanent]\n---\n# One idea per note\n\nEach permanent note holds one idea, written so you'd understand it in a year. Link it to the notes it builds on.\n\nRelated: [[Start here]]\n",
                ["Templates/Literature note.md"] = "---\ntags: [literature]\nsource: \n---\n# {{title}}\n\n> Quote or summary\n\n## In my own words\n",
                ["Templates/Permanent note.md"] = "---\ntags: [permanent]\n---\n# {{title}}\n\n\n\nRelated: \n",
            }) { GoodFor = "Research, learning and slowly growing ideas.", Group = "Popular structures" },

        new("johnny", "Johnny.Decimal", "🔢", "Everything in numbered areas (10–19) and categories (11, 12…), so every note has an address you can say out loud.",
            ["10-19 Life admin/11 Finances", "10-19 Life admin/12 Home", "20-29 Work/21 Projects", "20-29 Work/22 Meetings", "30-39 Hobbies/31 Reading", "Templates", "attachments"],
            new Dictionary<string, string>
            {
                ["00.00 Index.md"] = "# Index\n\n| Number | Area / category |\n| --- | --- |\n| 10-19 | Life admin |\n| 11 | Finances |\n| 12 | Home |\n| 20-29 | Work |\n| 21 | Projects |\n| 22 | Meetings |\n| 30-39 | Hobbies |\n| 31 | Reading |\n\nNew notes get the next number in their category: 11.01, 11.02…\n",
                ["20-29 Work/22 Meetings/22.01 Example meeting.md"] = "---\ntags: [meeting]\n---\n# 22.01 Example meeting\n\n## Notes\n\n## Actions\n- [ ] \n",
            }) { GoodFor = "People who like to find things in two clicks.", Group = "Popular structures" },

        new("journal", "Journal", "📔", "A note for every day, filed by year and month, with a weekly look back.",
            ["Journal", "Weekly", "Templates", "attachments"],
            new Dictionary<string, string>
            {
                ["Templates/Daily note.md"] = "# {{date}}\n\n## Today\n- \n\n## Grateful for\n- \n\n## Notes\n",
                ["Templates/Weekly look back.md"] = "# Week of {{date}}\n\n## What went well\n\n## What I'd change\n\n## Next week\n",
            }) { GoodFor = "Daily writing, habits and memories.", Group = "Popular structures" },

        new("notes", "Personal notes", "🗂", "Inbox for quick capture, notes, a journal, projects and an archive.",
            ["Inbox", "Notes", "Journal", "Projects", "Archive", "attachments"],
            new Dictionary<string, string>
            {
                ["Inbox/Read me first.md"] = "# Inbox\n\nDrop quick notes here and sort them later into the Notes folder or a project. #inbox\n",
                ["Projects/Example project.md"] = "---\ntags: [project]\n---\n# Example project\n\n## Goal\n\n## Next steps\n- [ ] First step\n\n## Notes\n",
            }) { GoodFor = "Everyday notes, without a system to learn." },

        new("writer", "Writer", "✒", "A manuscript in chapters, characters, places, research and drafts.",
            ["Manuscript", "Characters", "Places", "Research", "Drafts", "Archive", "attachments"],
            new Dictionary<string, string>
            {
                ["Manuscript/01 Chapter one.md"] = "# Chapter one\n\n#chapter #draft\n\n",
                ["Characters/_Character template.md"] = "---\ntags: [character]\n---\n# Name\n\n- **Role:**\n- **Wants:**\n- **Fears:**\n- **First appears:** [[01 Chapter one]]\n\n## Notes\n",
                ["Places/_Place template.md"] = "---\ntags: [place]\n---\n# Place\n\n- **Where:**\n- **Mood:**\n\n## Notes\n",
            }) { GoodFor = "A novel or a long story.", Group = "For creators" },

        new("world", "Worldbuilding", "🗺", "Regions, characters, factions, history, lore, maps and game sessions.",
            ["World/Regions", "World/Cities", "Characters", "Factions", "History", "Lore", "Maps", "Sessions", "attachments"],
            new Dictionary<string, string>
            {
                ["History/Timeline.md"] = "# Timeline\n\n| Year | Event |\n|---|---|\n|  |  |\n\n#history\n",
                ["Factions/_Faction template.md"] = "---\ntags: [faction]\n---\n# Faction\n\n- **Leader:**\n- **Seat:**\n- **Goals:**\n\n## Relations\n",
                ["Sessions/Session 1.md"] = "---\ntags: [session]\n---\n# Session 1\n\n## Recap\n\n## Loot & hooks\n",
            }) { GoodFor = "Tabletop campaigns and fictional worlds.", Group = "For creators" },

        new("creator", "Streamer / creator", "📡", "Streams, supporters, video ideas, thumbnails and music notes. Matches NoorStream.",
            ["Streams", "Stream", "Videos/Ideas", "Videos/Published", "Thumbnails", "Music", "attachments"],
            new Dictionary<string, string>
            {
                ["Videos/Ideas/Video idea template.md"] = "---\ntags: [idea, video]\n---\n# Working title\n\n- **Hook:**\n- **Length:**\n- **Thumbnail idea:**\n\n## Outline\n",
                ["Music/Tracks used in videos.md"] = "# Tracks used in videos\n\n| Track | Video | Date |\n|---|---|---|\n|  |  |  |\n\n#music #licensing\n",
                ["Stream/README.md"] = "# Stream\n\nThe NoorStream keeps the supporters list here (Supporters.md); stream notes go to the Streams folder. #stream\n",
            }) { GoodFor = "Streams, videos and the people who support them.", Group = "For creators" },

        new("gamedev", "Game development", "🎮", "Design docs, a devlog, tasks, playtests, assets and a changelog.",
            ["Design", "Devlog", "Tasks", "Playtests", "Assets", "attachments"],
            new Dictionary<string, string>
            {
                ["Design/Game overview.md"] = "---\ntags: [design]\n---\n# Game overview\n\n- **Pitch:**\n- **Core loop:**\n- **Platforms:**\n\n## Pillars\n",
                ["Changelog.md"] = "# Changelog\n\n## Unreleased\n- \n\n#release\n",
                ["Playtests/Playtest template.md"] = "---\ntags: [playtest]\n---\n# Playtest — date\n\n## What we tested\n\n## What players did\n\n## Fixes\n- [ ] \n",
            }) { GoodFor = "Making a game: design, devlog, playtests.", Group = "For creators" },
    ];

    public static VaultPreset Get(string? id) => All.FirstOrDefault(p => p.Id == id) ?? All[0];

    /// <summary>Creates the preset's folders and notes in an existing folder. Existing files are kept. Returns the Home note path.</summary>
    public static string Apply(string root, string? presetId, string vaultName)
    {
        var p = Get(presetId);
        var today = DateTime.Now.ToString("yyyy-MM-dd");
        var utf8 = new UTF8Encoding(false);
        foreach (var f in p.Folders) Directory.CreateDirectory(Path.Combine(root, f.Replace('/', Path.DirectorySeparatorChar)));
        foreach (var (rel, text) in p.Notes)
        {
            var full = Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            // Templates keep their {{title}} / {{date}} for later; starter notes get them filled in now.
            var body = rel.StartsWith("Templates/", StringComparison.Ordinal) ? text : text.Replace("{{date}}", today).Replace("{{title}}", Path.GetFileNameWithoutExtension(rel));
            if (!File.Exists(full)) File.WriteAllText(full, body, utf8);
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
        sb.Append("- Tag notes with `#idea` (or `tags: [idea]` at the top) and browse them in the **Tags** panel.\n");
        sb.Append("- The Vault tab searches every note; the Explorer, Backlinks, Tags and Search panels dock beside your writing.\n");
        sb.Append("- Pictures and other files go to *attachments*.\n");
        return sb.ToString();
    }
}
