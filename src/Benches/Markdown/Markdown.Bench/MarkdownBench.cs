using System.Text.Json;
using System.Text.Json.Nodes;
using Markdown.Core;
using Noor.Contracts;

namespace Markdown.Bench;

/// <summary>The writing bench: Markdown documents as tabs, Visual / Markdown / side-by-side editing (NoorMD 2.0's
/// editor), an outline. Its C# side owns the files: opening (only what the user picked), saving back in the file's own
/// encoding and line endings, noticing other programs' changes, drafts of unsaved work, recent files.</summary>
public sealed class MarkdownBench : BenchBase
{
    public static readonly IReadOnlyList<FileFilter> Filters =
        [new("Markdown", [".md", ".markdown", ".mdown", ".mkd"]), new("Text", [".txt"]), new("Markdown and text", [".md", ".markdown", ".mdown", ".mkd", ".txt"])];

    public override BenchManifest Manifest { get; } = new()
    {
        Id = "noor.markdown",
        Name = "Markdown",
        Icon = "✎",
        Description = "Write: Markdown documents in Visual, Markdown or side-by-side view, with an outline.",
        Version = "3.0.7",
        Density = "roomy",
        Menus =
        [
            // "File", "Edit" and "View" join the shell's menus of the same name (the bench's items come first).
            new MenuSpec("File", [
                new MenuItemSpec("New document", "md.new", "Ctrl+N"),
                new MenuItemSpec("Open…", "md.open", "Ctrl+O"),
                new MenuItemSpec("Open recent…", "md.recent", "Ctrl+Shift+O"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Save", "md.save", "Ctrl+S"),
                new MenuItemSpec("Save as…", "md.saveAs", "Ctrl+Shift+S"),
                new MenuItemSpec("Save all", "md.saveAll"),
                new MenuItemSpec("Take a snapshot", "md.snap"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Export HTML…", "md.exportHtml"),
                new MenuItemSpec("Export PDF…", "md.exportPdf"),
                new MenuItemSpec("Print…", "md.print"),
                new MenuItemSpec("Copy the Markdown", "md.copy"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Name the document…", "md.name"),
                new MenuItemSpec("Reload from disk", "md.reload"),
                new MenuItemSpec("Show in Explorer", "md.reveal"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Close the document", "md.close", "Ctrl+W"),
                new MenuItemSpec("Unsaved work from before…", "md.drafts"),
            ]),
            new MenuSpec("Edit", [
                new MenuItemSpec("Find…", "md.find", "Ctrl+F"),
                new MenuItemSpec("Replace…", "md.replace", "Ctrl+H"),
            ]),
            new MenuSpec("View", [
                new MenuItemSpec("Visual", "md.mode.visual"),
                new MenuItemSpec("Markdown", "md.mode.markdown"),
                new MenuItemSpec("Side by side", "md.mode.split"),
                new MenuItemSpec("Next view", "md.mode.next", "Ctrl+E"),
                new MenuItemSpec("Formatting bar", "md.toolbar"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Bigger text", "md.zoom.in", "Ctrl+="),
                new MenuItemSpec("Smaller text", "md.zoom.out", "Ctrl+-"),
                new MenuItemSpec("Normal text size", "md.zoom.reset", "Ctrl+0"),
                new MenuItemSpec("Line width: comfortable", "md.width.comfortable"),
                new MenuItemSpec("Line width: wide", "md.width.wide"),
                new MenuItemSpec("Line width: full", "md.width.full"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Line numbers (Markdown view)", "md.lines"),
                new MenuItemSpec("Word wrap (Markdown view)", "md.wrap"),
                new MenuItemSpec("Scroll together (side by side)", "md.sync"),
                new MenuItemSpec("Spellcheck", "md.spell"),
            ]),
            new MenuSpec("Tools", [
                new MenuItemSpec("Writing goal…", "md.goal"),
                new MenuItemSpec("Markdown settings…", "md.settings"),
            ]),
            new MenuSpec("Help", [
                new MenuItemSpec("The Markdown welcome document", "md.welcome"),
            ]),
            new MenuSpec("Format", [
                new MenuItemSpec("Bold", "md.fmt.bold", "Ctrl+B"),
                new MenuItemSpec("Italic", "md.fmt.italic", "Ctrl+I"),
                new MenuItemSpec("Strikethrough", "md.fmt.strike"),
                new MenuItemSpec("Inline code", "md.fmt.code"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Heading 1", "md.fmt.h1"),
                new MenuItemSpec("Heading 2", "md.fmt.h2"),
                new MenuItemSpec("Heading 3", "md.fmt.h3"),
                new MenuItemSpec("Paragraph (plain text)", "md.fmt.p"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Bulleted list", "md.fmt.ul"),
                new MenuItemSpec("Numbered list", "md.fmt.ol"),
                new MenuItemSpec("Task list", "md.fmt.task"),
                new MenuItemSpec("Quote", "md.fmt.quote"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Indent (Tab)", "md.fmt.indent"),
                new MenuItemSpec("Outdent (Shift+Tab)", "md.fmt.outdent"),
            ]),
            new MenuSpec("Insert", [
                new MenuItemSpec("Link…", "md.ins.link"),
                new MenuItemSpec("Table", "md.ins.table"),
                new MenuItemSpec("Image…", "md.ins.image"),
                new MenuItemSpec("Code block", "md.ins.codeblock"),
                new MenuItemSpec("Horizontal line", "md.ins.hr"),
                new MenuItemSpec("Today's date", "md.ins.date"),
            ]),
        ],
        Panels = [new PanelSpec("outline", "Outline", "☰", "left"), new PanelSpec("stats", "Statistics", "∑", "right"), new PanelSpec("history", "History", "⟲", "right")],
        FileTypes = DocumentFile.OpenableExtensions,
    };

    Documents? _docs;
    Documents Docs(IBenchHost host) => _docs ??= new Documents(host.DataFolder);

    public MarkdownBench()
    {
        Command("md.pick", async (a, host, _) =>
        {
            var paths = await host.PickFilesAsync("Open Markdown", Filters, multiple: true);
            Docs(host).Picked(paths);
            return new JsonArray(paths.Select(p => (JsonNode?)p).ToArray());
        });
        // The shell hands over files the user dropped or opened NoorMD with: they count as picked.
        Command(Contract.OpenCommand, (a, host, _) =>
        {
            var paths = a.TryGetProperty("paths", out var p) && p.ValueKind == JsonValueKind.Array ? p.EnumerateArray().Select(x => x.GetString() ?? "").Where(DocumentFile.IsOpenable).ToList() : [];
            Docs(host).Picked(paths);
            return Task.FromResult<JsonNode?>(null);
        });
        // The shell says files moved (the Vault renamed a note): documents on them follow.
        Command(Contract.MovedCommand, (a, host, _) =>
        {
            var moves = a.TryGetProperty("moves", out var m) && m.ValueKind == JsonValueKind.Array
                ? m.EnumerateArray().Select(x => (Str(x, "from"), Str(x, "to"))).Where(x => x.Item1.Length > 0 && x.Item2.Length > 0).ToList() : [];
            var moved = Docs(host).Moved(moves);
            return Task.FromResult<JsonNode?>(new JsonArray(moved.Select(x => (JsonNode?)new JsonObject { ["doc"] = x.Id, ["path"] = x.Path }).ToArray()));
        });
        // Show in Explorer: the folder of a file the user has open, with the file selected.
        Command("md.reveal", (a, host, _) => Run(() =>
        {
            var path = Docs(host).PathOf(Str(a, "doc"));
            if (path == null || !File.Exists(path)) throw new BenchException("It isn't saved as a file yet.");
            if (OperatingSystem.IsWindows()) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = false });
            return null;
        }));
        Command("md.load", (a, host, _) => Run(() =>
        {
            var doc = Docs(host).Open(Str(a, "doc"), Str(a, "path"));
            return new JsonObject
            {
                ["path"] = doc.Path, ["name"] = Path.GetFileName(doc.Path), ["markdown"] = doc.Markdown,
                ["format"] = doc.Format.Describe(), ["warning"] = doc.Warning,
            };
        }));
        Command("md.write", (a, host, _) => Run(() =>
        {
            var d = Docs(host); var id = Str(a, "doc");
            var outcome = d.Save(id, Str(a, "markdown"), a.TryGetProperty("overwrite", out var o) && o.ValueKind == JsonValueKind.True);
            return outcome switch
            {
                Documents.SaveOutcome.Saved => Saved(d, id),
                Documents.SaveOutcome.Conflict => new JsonObject { ["conflict"] = true },
                _ => new JsonObject { ["needsPath"] = true },
            };
        }));
        Command("md.writeAs", async (a, host, _) =>
        {
            var d = Docs(host); var id = Str(a, "doc");
            var current = d.PathOf(id);
            var suggested = current != null ? Path.GetFileName(current) : DocumentFile.SafeFileName(a.TryGetProperty("title", out var t) ? t.GetString() ?? "" : "");
            var path = await host.PickSaveFileAsync("Save Markdown", suggested, Filters);
            if (path == null) return null;
            return await Run(() => { d.SaveAs(id, path, Str(a, "markdown")); return Saved(d, id); });
        });
        Command("md.draft", (a, host, _) => Run(() =>
        {
            Docs(host).WriteDraft(Str(a, "doc"), Str(a, "markdown"), a.TryGetProperty("title", out var t) ? t.GetString() : null);
            return null;
        }));
        Command("md.dropDraft", (a, host, _) => Run(() => { var id = Str(a, "doc"); if (DraftStore.IsValidId(id)) Docs(host).Drafts.Delete(id); return null; }));
        // A document from last time: its draft if it has one (it then carries on from the draft), else nothing.
        Command("md.resume", (a, host, _) => Run(() =>
        {
            var d = Docs(host); var draft = d.Drafts.Load(Str(a, "doc"));
            if (draft == null) return null;
            d.Resume(draft);
            return new JsonObject
            {
                ["path"] = draft.Path, ["name"] = draft.Path != null ? Path.GetFileName(draft.Path) : null, ["title"] = draft.Title,
                ["markdown"] = draft.Markdown, ["format"] = draft.Format.Describe(), ["savedUtc"] = draft.SavedUtc,
            };
        }));
        Command("md.closeDoc", (a, host, _) => Run(() => { Docs(host).Close(Str(a, "doc")); return null; }));
        Command("md.changed", (a, host, _) => Run(() => (JsonNode)Docs(host).ChangedOnDisk(Str(a, "doc"))));
        // Drafts no open document owns (left by a crash between a draft and the session being kept).
        Command("md.drafts", (a, host, _) =>
        {
            var except = a.ValueKind == JsonValueKind.Object && a.TryGetProperty("except", out var e) && e.ValueKind == JsonValueKind.Array
                ? e.EnumerateArray().Select(x => x.GetString()).ToHashSet() : [];
            return Task.FromResult<JsonNode?>(new JsonArray(Docs(host).Drafts.List().Where(s => !except.Contains(s.Id)).Select(s => (JsonNode?)new JsonObject
            {
                ["id"] = s.Id, ["path"] = s.Path, ["title"] = s.Title, ["savedUtc"] = s.SavedUtc, ["words"] = s.Words,
            }).ToArray()));
        });
        // A picture for the document: written relative to the document's folder when it's beside or below it.
        Command("md.pickImage", async (a, host, _) =>
        {
            var picked = await host.PickFilesAsync("Insert an image", ImageFilters);
            if (picked.Count == 0) return null;
            var docPath = Docs(host).PathOf(Str(a, "doc"));
            return new JsonObject { ["url"] = ImageUrl(picked[0], docPath), ["name"] = Path.GetFileNameWithoutExtension(picked[0]) };
        });
        // Snapshots: the document's version history.
        Command("md.snapList", (a, host, _) => Run(() =>
        {
            var d = Docs(host);
            return new JsonArray(d.Snapshots.List(d.SnapshotKey(Str(a, "doc"))).Select(s => (JsonNode?)new JsonObject
            {
                ["id"] = s.Id, ["createdUtc"] = s.CreatedUtc, ["label"] = s.Label, ["words"] = s.Words,
            }).ToArray());
        }));
        Command("md.snapTake", (a, host, _) => Run(() =>
        {
            var d = Docs(host); var id = Str(a, "doc");
            var s = d.Snapshots.Create(d.SnapshotKey(id), Str(a, "markdown"), Str(a, "label"), Str(a, "title"), d.PathOf(id));
            return new JsonObject { ["id"] = s.Id, ["createdUtc"] = s.CreatedUtc, ["label"] = s.Label, ["words"] = s.Words };
        }));
        Command("md.snapGet", (a, host, _) => Run(() =>
        {
            var d = Docs(host);
            var s = d.Snapshots.Get(d.SnapshotKey(Str(a, "doc")), Str(a, "id")) ?? throw new BenchException("That snapshot isn't there any more.");
            return new JsonObject { ["id"] = s.Id, ["createdUtc"] = s.CreatedUtc, ["label"] = s.Label, ["words"] = s.Words, ["markdown"] = s.Markdown };
        }));
        Command("md.snapDelete", (a, host, _) => Run(() => { var d = Docs(host); d.Snapshots.Delete(d.SnapshotKey(Str(a, "doc")), Str(a, "id")); return null; }));
        // Export: a web page (the body arrives sanitised; the file forbids scripts as well), a PDF, a Markdown copy.
        Command("md.exportHtml", async (a, host, _) =>
        {
            var title = Str(a, "title");
            var path = await host.PickSaveFileAsync("Export HTML", DocumentFile.SafeFileName(title, ".html"), [new("Web page", [".html"])]);
            if (path == null) return null;
            return await Run(() => { AtomicFile.WriteAllText(path, HtmlExport.Build(title, Str(a, "bodyHtml"))); return new JsonObject { ["path"] = path }; });
        });
        Command("md.exportPdf", async (a, host, _) =>
        {
            var path = await host.SavePageAsPdfAsync(DocumentFile.SafeFileName(Str(a, "title"), ".pdf"));
            return path == null ? null : new JsonObject { ["path"] = path };
        });
        Command("md.recentList", (a, host, _) => Task.FromResult<JsonNode?>(new JsonArray(Docs(host).Recent.Paths.Select(p => (JsonNode?)new JsonObject
        {
            ["path"] = p, ["name"] = Path.GetFileName(p), ["folder"] = Path.GetDirectoryName(p), ["exists"] = File.Exists(p),
        }).ToArray())));
        Command("md.recentForget", (a, host, _) => Run(() => { var p = Str(a, "path"); if (p.Length == 0) Docs(host).Recent.Clear(); else Docs(host).Recent.Remove(p); return null; }));
    }

    public static readonly IReadOnlyList<FileFilter> ImageFilters = [new("Pictures", [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"])];

    /// <summary>How a picture is written in the document: "images/a.png" beside it, else a file:/// address.</summary>
    public static string ImageUrl(string image, string? docPath)
    {
        var full = Path.GetFullPath(image);
        if (docPath != null)
        {
            var folder = Path.GetDirectoryName(Path.GetFullPath(docPath))!;
            var rel = Path.GetRelativePath(folder, full);
            if (!rel.StartsWith("..", StringComparison.Ordinal) && !Path.IsPathRooted(rel))
                return string.Join('/', rel.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Select(Uri.EscapeDataString));
        }
        return new Uri(full).AbsoluteUri;
    }

    static JsonNode Saved(Documents d, string id)
    {
        var p = d.PathOf(id)!;
        return new JsonObject { ["path"] = p, ["name"] = Path.GetFileName(p), ["format"] = d.FormatOf(id).Describe() };
    }

    static string Str(JsonElement a, string name) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";

    /// <summary>File troubles become messages the user can read.</summary>
    static Task<JsonNode?> Run(Func<JsonNode?> fn)
    {
        try { return Task.FromResult(fn()); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or InvalidDataException)
        { throw new BenchException(ex.Message); }
    }
}
