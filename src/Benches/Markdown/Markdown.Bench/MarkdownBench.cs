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
        Version = "3.0.5",
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
                MenuItemSpec.Separator,
                new MenuItemSpec("Close the document", "md.close", "Ctrl+W"),
                new MenuItemSpec("Unsaved work from before…", "md.drafts"),
            ]),
            new MenuSpec("View", [
                new MenuItemSpec("Visual", "md.mode.visual"),
                new MenuItemSpec("Markdown", "md.mode.markdown"),
                new MenuItemSpec("Side by side", "md.mode.split"),
                new MenuItemSpec("Next view", "md.mode.next", "Ctrl+E"),
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
                new MenuItemSpec("Paragraph", "md.fmt.p"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Bulleted list", "md.fmt.ul"),
                new MenuItemSpec("Numbered list", "md.fmt.ol"),
                new MenuItemSpec("Task list", "md.fmt.task"),
                new MenuItemSpec("Quote", "md.fmt.quote"),
            ]),
            new MenuSpec("Insert", [
                new MenuItemSpec("Link…", "md.ins.link"),
                new MenuItemSpec("Table", "md.ins.table"),
                new MenuItemSpec("Code block", "md.ins.codeblock"),
                new MenuItemSpec("Horizontal line", "md.ins.hr"),
                new MenuItemSpec("Today's date", "md.ins.date"),
            ]),
        ],
        Panels = [new PanelSpec("outline", "Outline", "☰", "left")],
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
        Command("md.recentList", (a, host, _) => Task.FromResult<JsonNode?>(new JsonArray(Docs(host).Recent.Paths.Select(p => (JsonNode?)new JsonObject
        {
            ["path"] = p, ["name"] = Path.GetFileName(p), ["folder"] = Path.GetDirectoryName(p), ["exists"] = File.Exists(p),
        }).ToArray())));
        Command("md.recentForget", (a, host, _) => Run(() => { var p = Str(a, "path"); if (p.Length == 0) Docs(host).Recent.Clear(); else Docs(host).Recent.Remove(p); return null; }));
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
