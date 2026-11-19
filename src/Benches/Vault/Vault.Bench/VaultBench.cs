using System.Text.Json;
using System.Text.Json.Nodes;
using Markdown.Core;
using Noor.Contracts;
using Vault.Core;

namespace Vault.Bench;

/// <summary>The Vault: a folder of notes, linked together. Its tab is the vault's home (search, recent notes, tags);
/// its panels (Explorer, Backlinks, Tags, Search) dock beside your writing; notes open in the Markdown bench. A vault
/// is a folder the user picked (or made with the wizard); nothing outside it is read.</summary>
public sealed class VaultBench : BenchBase
{
    public override BenchManifest Manifest { get; } = new()
    {
        Id = "noor.vault",
        Name = "Vault",
        Icon = "🗄",
        Description = "A folder of linked notes: explorer, search, backlinks, tags, and a wizard to start one.",
        Version = "3.0.10",
        Density = "roomy",
        Menus =
        [
            new MenuSpec("File", [
                new MenuItemSpec("New vault (wizard)…", "vault.wizard"),
                new MenuItemSpec("Open a folder as a vault…", "vault.openFolder"),
                new MenuItemSpec("Recent vaults…", "vault.recentDialog"),
                MenuItemSpec.Separator,
                new MenuItemSpec("New note", "vault.newNote"),
                new MenuItemSpec("New note from a template…", "vault.fromTemplate"),
                new MenuItemSpec("Today's note", "vault.today"),
                new MenuItemSpec("A random note", "vault.random"),
                new MenuItemSpec("New folder", "vault.newFolder"),
                MenuItemSpec.Separator,
                new MenuItemSpec("Pack & Share…", "vault.pack"),
                new MenuItemSpec("Show the vault in Explorer", "vault.reveal"),
                new MenuItemSpec("Close the vault", "vault.close"),
            ]),
            new MenuSpec("Edit", [
                new MenuItemSpec("Search the vault", "vault.focusSearch", "Ctrl+Shift+F"),
                new MenuItemSpec("Go to a note…", "vault.switcher", "Ctrl+P"),
            ]),
            new MenuSpec("View", [
                new MenuItemSpec("The vault's home", "vault.showHome"),
                new MenuItemSpec("The map", "vault.showMap"),
            ]),
        ],
        Panels =
        [
            new PanelSpec("explorer", "Explorer", "🗂", "left"),
            new PanelSpec("backlinks", "Backlinks", "↩", "right"),
            new PanelSpec("tags", "Tags", "#", "right"),
            new PanelSpec("search", "Search", "⌕", "right"),
            new PanelSpec("localmap", "Local map", "✳", "right"),
        ],
    };

    VaultSession? _vault;
    VaultList? _list;
    IBenchHost? _host;
    VaultList List(IBenchHost host) => _list ??= new VaultList(Path.Combine(host.DataFolder, "vaults.json"));

    /// <summary>The open vault; the one open last time comes back on first use.</summary>
    VaultSession? Session(IBenchHost host)
    {
        _host = host;
        if (_vault != null) return _vault;
        var last = List(host).Last;
        if (last != null && Directory.Exists(last)) { try { Open(host, last); } catch (VaultOperationException) { } }
        return _vault;
    }
    VaultSession V(IBenchHost host) => Session(host) ?? throw new BenchException("No vault is open. Make one with the wizard, or open a folder as a vault.");

    void Open(IBenchHost host, string path)
    {
        var root = VaultSession.CheckRoot(path);
        if (_vault != null && string.Equals(_vault.Root, root, StringComparison.OrdinalIgnoreCase)) return;
        _vault?.Dispose();
        _vault = new VaultSession(root);
        _vault.Changed += () => host.Post("changed", new { root });
        List(host).Opened(root);
        host.Post("opened", new { root });
    }

    public VaultBench()
    {
        Command("vault.state", async (a, host, _) =>
        {
            var v = Session(host);
            if (v != null) await v.Ready;
            return new JsonObject
            {
                ["open"] = v != null, ["root"] = v?.Root, ["name"] = v?.Name, ["notes"] = v?.Index.Count ?? 0,
                ["recent"] = new JsonArray(List(host).Recent.Select(p => (JsonNode?)new JsonObject { ["path"] = p, ["name"] = Path.GetFileName(p), ["exists"] = Directory.Exists(p) }).ToArray()),
            };
        });
        Command("vault.presets", a => new JsonArray(VaultPresets.All.Select(p => (JsonNode?)new JsonObject
        {
            ["id"] = p.Id, ["name"] = p.Name, ["icon"] = p.Icon, ["description"] = p.Description, ["goodFor"] = p.GoodFor, ["group"] = p.Group,
            ["folders"] = new JsonArray(p.Folders.Where(f => f != "attachments").Select(f => (JsonNode?)f).ToArray()),
            ["notes"] = new JsonArray(p.Notes.Keys.Select(n => (JsonNode?)n).ToArray()),
        }).ToArray()));
        // The wizard's last step: where the new vault goes (the user picks the folder it's made in).
        Command("vault.create", async (a, host, _) =>
        {
            var name = Str(a, "name").Trim();
            if (VaultPaths.NameProblem(name) is { } problem) throw new BenchException(problem);
            var parent = await host.PickFolderAsync($"Where should the vault “{name}” go?");
            if (parent == null) return null;
            var root = Path.Combine(parent, name);
            if (File.Exists(root) || (Directory.Exists(root) && Directory.EnumerateFileSystemEntries(root).Any()))
                throw new BenchException($"“{name}” is already in that folder. Choose another name, or open it as a vault.");
            Directory.CreateDirectory(root);
            var home = VaultPresets.Apply(root, Str(a, "preset"), name);
            Open(host, root);
            await _vault!.Ready;
            await host.OpenFilesAsync([home]);
            return new JsonObject { ["root"] = root };
        });
        Command("vault.openFolder", async (a, host, _) =>
        {
            var path = await host.PickFolderAsync("Open a folder as a vault");
            if (path == null) return null;
            return Run(() => { Open(host, path); return new JsonObject { ["root"] = _vault!.Root }; });
        });
        // A vault from the recent list (the user picked it before).
        Command("vault.openRecent", (a, host, _) => Task.FromResult(Run(() =>
        {
            var path = Str(a, "path");
            if (!List(host).Recent.Contains(path, StringComparer.OrdinalIgnoreCase)) throw new BenchException("Open that folder with File › Open a folder as a vault first.");
            Open(host, path);
            return (JsonNode?)new JsonObject { ["root"] = _vault!.Root };
        })));
        Command("vault.forget", a => { if (_host != null) List(_host).Forget(Str(a, "path")); return null; });
        Command("vault.close", (a, host, _) =>
        {
            _vault?.Dispose(); _vault = null;
            List(host).Closed();
            host.Post("opened", new { root = (string?)null });
            return Task.FromResult<JsonNode?>(null);
        });
        Command("vault.tree", async (a, host, _) =>
        {
            var v = V(host); await v.Ready;
            return new JsonObject
            {
                ["root"] = v.Root, ["name"] = v.Name,
                ["entries"] = new JsonArray(v.Entries.Take(20_000).Select(e => (JsonNode?)new JsonObject
                {
                    ["path"] = e.Path, ["folder"] = e.IsFolder, ["note"] = !e.IsFolder && VaultPaths.IsNote(e.Path), ["modified"] = e.ModifiedUtc,
                }).ToArray()),
            };
        });
        Command("vault.notes", async (a, host, _) =>
        {
            var v = Session(host);
            if (v == null) return new JsonArray();
            await v.Ready;
            return new JsonArray(v.Index.NotePaths().OrderBy(p => p, StringComparer.OrdinalIgnoreCase).Select(p => (JsonNode?)new JsonObject
            {
                ["path"] = p, ["name"] = Path.GetFileNameWithoutExtension(p),
                ["aliases"] = new JsonArray(VaultNotes.Aliases(v.Index.TextOf(p) ?? "").Select(x => (JsonNode?)x).ToArray()),
            }).ToArray());
        });
        // The map: every note and the links between them; or just the notes around one (the local map).
        Command("vault.graph", async (a, host, _) =>
        {
            var v = V(host); await v.Ready;
            var g = VaultNotes.Graph(v.Index);
            var center = Str(a, "center");
            if (center.Length > 0)
            {
                var rel = Path.IsPathFullyQualified(center) ? v.Rel(center) : center;
                if (string.IsNullOrEmpty(rel) || v.Index.TextOf(rel) == null) return new JsonObject { ["inVault"] = false };
                g = VaultNotes.Around(g, rel, a.TryGetProperty("depth", out var dep) && dep.ValueKind == JsonValueKind.Number ? dep.GetInt32() : 1);
                return GraphJson(g, rel);
            }
            return GraphJson(g, null);
        });
        // A [[link]]'s note, for a hover preview (the start of it, or the section after a #heading).
        Command("vault.preview", async (a, host, _) =>
        {
            var v = Session(host);
            if (v == null) return null;
            await v.Ready;
            var from = Str(a, "from"); var fromRel = from.Length > 0 ? v.Rel(from) ?? "" : "";
            var target = Str(a, "target");
            var rel = v.ResolveWiki(fromRel, target);
            if (rel == null) return new JsonObject { ["missing"] = true, ["name"] = VaultLinks.SplitWiki(target).Target };
            var text = v.Index.TextOf(rel) ?? "";
            var tail = VaultLinks.SplitWiki(target).Tail;
            var heading = tail.StartsWith('#') ? tail[1..].Split('|')[0].Trim() : "";
            if (heading.Length > 0)
            {
                var hs = VaultNotes.Headings(text);
                var h = hs.FirstOrDefault(x => string.Equals(x.Text, heading, StringComparison.OrdinalIgnoreCase));
                if (h != null)
                {
                    var lines = text.Split('\n');
                    var next = hs.FirstOrDefault(x => x.Line > h.Line && x.Level <= h.Level);
                    text = string.Join('\n', lines[(h.Line - 1)..(next != null ? next.Line - 1 : lines.Length)]);
                }
            }
            if (text.Length > 6000) text = text[..6000] + "\n\n…";
            return new JsonObject { ["path"] = rel, ["name"] = Path.GetFileNameWithoutExtension(rel), ["markdown"] = text, ["heading"] = heading };
        });
        // A note's headings, for [[Note#…]] suggestions.
        Command("vault.headings", async (a, host, _) =>
        {
            var v = Session(host);
            if (v == null) return new JsonArray();
            await v.Ready;
            var from = Str(a, "from"); var fromRel = from.Length > 0 ? v.Rel(from) ?? "" : "";
            var rel = v.ResolveWiki(fromRel, Str(a, "target"));
            if (rel == null) return new JsonArray();
            return new JsonArray(VaultNotes.Headings(v.Index.TextOf(rel) ?? "").Select(h => (JsonNode?)new JsonObject { ["level"] = h.Level, ["text"] = h.Text, ["line"] = h.Line }).ToArray());
        });
        Command("vault.templates", async (a, host, _) =>
        {
            var v = V(host); await v.Ready;
            return new JsonArray(v.Templates().Select(t => (JsonNode?)new JsonObject { ["path"] = t, ["name"] = Path.GetFileNameWithoutExtension(t) }).ToArray());
        });
        Command("vault.newFromTemplate", async (a, host, _) =>
        {
            var v = V(host);
            var name = Str(a, "name");
            var rel = Run(() => v.NewFromTemplate(Str(a, "template"), Str(a, "folder"), VaultPaths.IsNote(name) ? name : name + ".md"));
            await v.RescanAsync();
            await host.OpenFilesAsync([v.Full(rel)!]);
            return new JsonObject { ["path"] = rel };
        });
        // Today's note (or another day's): opened, made first if need be.
        Command("vault.daily", async (a, host, _) =>
        {
            var v = V(host); await v.Ready;
            var day = DateTime.TryParse(Str(a, "date"), System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d) ? d : DateTime.Now;
            var (rel, made) = Run(() => v.DailyNote(day));
            if (made) await v.RescanAsync();
            await host.OpenFilesAsync([v.Full(rel)!]);
            return new JsonObject { ["path"] = rel, ["made"] = made };
        });
        Command("vault.recentNotes", async (a, host, _) =>
        {
            var v = V(host); await v.Ready;
            return new JsonArray(v.Entries.Where(e => !e.IsFolder && VaultPaths.IsNote(e.Path)).OrderByDescending(e => e.ModifiedUtc).Take(12)
                .Select(e => (JsonNode?)new JsonObject { ["path"] = e.Path, ["name"] = Path.GetFileNameWithoutExtension(e.Path), ["modified"] = e.ModifiedUtc }).ToArray());
        });
        Command("vault.search", async (a, host, _) =>
        {
            var v = V(host); await v.Ready;
            return new JsonArray(VaultQuery.Search(v.Index, Str(a, "q"), 200).Select(h => (JsonNode?)new JsonObject
            {
                ["path"] = h.Path, ["name"] = h.Name, ["line"] = h.Line, ["snippet"] = h.Snippet, ["nameMatch"] = h.NameMatch,
            }).ToArray());
        });
        // Notes linking to a file (given by its full path, as the Markdown bench knows it).
        Command("vault.backlinks", async (a, host, _) =>
        {
            var v = Session(host);
            if (v == null) return new JsonObject { ["inVault"] = false };
            await v.Ready;
            var rel = v.Rel(Str(a, "path"));
            if (string.IsNullOrEmpty(rel)) return new JsonObject { ["inVault"] = false };
            return new JsonObject
            {
                ["inVault"] = true, ["path"] = rel,
                ["refs"] = new JsonArray(VaultQuery.Backlinks(v.Index, rel).Select(r => (JsonNode?)new JsonObject { ["source"] = r.Source, ["name"] = Path.GetFileNameWithoutExtension(r.Source), ["line"] = r.Line, ["snippet"] = r.Snippet }).ToArray()),
                ["mentions"] = new JsonArray(VaultQuery.UnlinkedMentions(v.Index, rel).Select(m => (JsonNode?)new JsonObject
                {
                    ["source"] = m.Source, ["name"] = Path.GetFileNameWithoutExtension(m.Source), ["line"] = m.Line, ["column"] = m.Column, ["text"] = m.Text, ["snippet"] = m.Snippet,
                }).ToArray()),
                ["outgoing"] = new JsonArray(VaultQuery.Outgoing(v.Index, rel).Select(o => (JsonNode?)new JsonObject
                {
                    ["target"] = o.Target, ["path"] = o.Resolved, ["name"] = o.Resolved != null ? Path.GetFileNameWithoutExtension(o.Resolved) : VaultLinks.SplitWiki(o.Target).Target, ["line"] = o.Line,
                }).ToArray()),
                ["tags"] = new JsonArray(v.Index.TagsOf(rel).Select(t => (JsonNode?)t).ToArray()),
                ["properties"] = Props(v.Index.TextOf(rel) ?? ""),
                ["bookmarked"] = List(host).IsBookmarked(v.Root, rel),
            };
        });
        // "Link it": an unlinked mention becomes a link, in that note's file (not in one open with unsaved changes).
        Command("vault.linkMention", async (a, host, _) =>
        {
            var v = V(host);
            var source = Str(a, "source"); var target = Str(a, "target");
            var full = v.Full(source);
            if (full == null || !File.Exists(full) || v.Index.TextOf(target) == null) throw new BenchException("That note isn't there any more.");
            if (Skip(a).Contains(full)) throw new BenchException($"“{Path.GetFileNameWithoutExtension(source)}” is open with unsaved changes: save it first.");
            var line = a.TryGetProperty("line", out var l) && l.ValueKind == JsonValueKind.Number ? l.GetInt32() : 0;
            var col = a.TryGetProperty("column", out var c) && c.ValueKind == JsonValueKind.Number ? c.GetInt32() : -1;
            var doc = Run(() => DocumentFile.Load(full));
            var linked = VaultQuery.LinkMention(doc.Markdown, line, col, Str(a, "text"), Path.GetFileNameWithoutExtension(target))
                ?? throw new BenchException("That note changed since: look again.");
            Run(() => DocumentFile.Save(full, linked, doc.Format, null));
            await v.RescanAsync();
            return new JsonObject { ["updated"] = full };
        });
        Command("vault.random", async (a, host, _) =>
        {
            var v = V(host); await v.Ready;
            var notes = v.Index.NotePaths().Where(p => !p.StartsWith("Templates/", StringComparison.OrdinalIgnoreCase)).ToList();
            if (notes.Count == 0) throw new BenchException("This vault has no notes yet.");
            var pick = notes[Random.Shared.Next(notes.Count)];
            await host.OpenFilesAsync([v.Full(pick)!]);
            return new JsonObject { ["path"] = pick };
        });
        // Bookmarks: notes (and folders) you keep coming back to, kept per vault.
        Command("vault.bookmarks", async (a, host, _) =>
        {
            var v = V(host); await v.Ready;
            return new JsonArray(List(host).Bookmarks(v.Root).Select(p => (JsonNode?)new JsonObject
            {
                ["path"] = p, ["name"] = VaultPaths.IsNote(p) ? Path.GetFileNameWithoutExtension(p) : p.Split('/').Last(),
                ["folder"] = !VaultPaths.IsNote(p), ["exists"] = v.Full(p) is { } f && (File.Exists(f) || Directory.Exists(f)),
            }).ToArray());
        });
        Command("vault.bookmark", (a, host, _) =>
        {
            var v = V(host);
            var path = Str(a, "path");
            if (path.Length > 0 && Path.IsPathFullyQualified(path)) path = v.Rel(path) ?? throw new BenchException("That file isn't in the open vault.");
            if (v.Full(path) == null) throw new BenchException("That isn't in the open vault.");
            List(host).SetBookmark(v.Root, path, Bool(a, "on"));
            host.Post("bookmarks");
            return Task.FromResult<JsonNode?>(null);
        });
        // A note cut out of another (Extract to a new note): made next to it, with the text.
        Command("vault.extract", async (a, host, _) =>
        {
            var v = V(host);
            var fromRel = Str(a, "from").Length > 0 ? v.Rel(Str(a, "from")) : "";
            if (fromRel == null) throw new BenchException("That document isn't in the open vault.");
            var folder = fromRel.Contains('/') ? fromRel[..fromRel.LastIndexOf('/')] : "";
            var name = Str(a, "name").Trim();
            var rel = Run(() => v.Ops.CreateNote(folder, VaultPaths.IsNote(name) ? name : name + ".md", Str(a, "markdown")));
            await v.RescanAsync();
            return new JsonObject { ["path"] = rel, ["name"] = Path.GetFileNameWithoutExtension(rel) };
        });
        // Pack & Share: the plan (what goes in), then the ZIP.
        Command("vault.packPlan", async (a, host, _) =>
        {
            var v = V(host); await v.Ready;
            var o = PackOptions(a);
            var plan = await Task.Run(() => PackagePlanner.Build(v.Root, o));
            return new JsonObject
            {
                ["files"] = new JsonArray(plan.Files.Take(3000).Select(f => (JsonNode?)new JsonObject { ["entry"] = f.Entry, ["size"] = f.Size, ["dependency"] = f.Reason == PackReason.Dependency }).ToArray()),
                ["fileCount"] = plan.Files.Count, ["bytes"] = plan.TotalBytes,
                ["excludedCount"] = plan.Excluded.Count,
                ["dependencies"] = new JsonArray(plan.Dependencies.Select(d => (JsonNode?)new JsonObject { ["path"] = d.Path, ["from"] = d.LinkedFrom, ["included"] = d.Included }).ToArray()),
                ["unresolved"] = new JsonArray(plan.Unresolved.Take(300).Select(u => (JsonNode?)new JsonObject { ["from"] = u.From, ["target"] = u.Target, ["problem"] = u.Problem }).ToArray()),
                ["warnings"] = new JsonArray(plan.Warnings.Select(w => (JsonNode?)w).ToArray()),
                ["suggestedName"] = SuggestedZip(v, o),
            };
        });
        Command("vault.packCreate", async (a, host, cancel) =>
        {
            var v = V(host); await v.Ready;
            var o = PackOptions(a);
            var output = await host.PickSaveFileAsync(o.Handoff ? "Save the AI handoff package" : "Save the ZIP package", SuggestedZip(v, o), [new("ZIP archive", [".zip"])]);
            if (output == null) return null;
            var result = await Task.Run(() => ZipPackager.Create(PackagePlanner.Build(v.Root, o, cancel), output, null, cancel), cancel);
            return new JsonObject
            {
                ["path"] = result.Path, ["entries"] = result.Entries, ["bytes"] = result.Bytes,
                ["failures"] = new JsonArray(result.Failures.Select(f => (JsonNode?)new JsonObject { ["entry"] = f.Entry, ["problem"] = f.Problem }).ToArray()),
            };
        });
        Command("vault.tags", async (a, host, _) =>
        {
            var v = V(host); await v.Ready;
            return new JsonArray(v.Index.Tags().Select(t => (JsonNode?)new JsonObject { ["tag"] = t.Tag, ["count"] = t.Count }).ToArray());
        });
        Command("vault.tagged", async (a, host, _) =>
        {
            var v = V(host); await v.Ready;
            return new JsonArray(v.Index.Tagged(Str(a, "tag")).Select(p => (JsonNode?)new JsonObject { ["path"] = p, ["name"] = Path.GetFileNameWithoutExtension(p) }).ToArray());
        });
        // Opening a note: the Markdown bench (whichever bench opens .md) gets it.
        Command("vault.openNote", async (a, host, _) =>
        {
            var v = V(host);
            var full = v.Full(Str(a, "path"));
            if (full == null || !File.Exists(full)) throw new BenchException("That note isn't there any more.");
            await host.OpenFilesAsync([full]);
            return null;
        });
        // A [[link]] followed from a note (its full path): opens the note it leads to, or says where a new one would go.
        Command("vault.openLink", async (a, host, _) =>
        {
            var v = Session(host);
            if (v == null) return new JsonObject { ["noVault"] = true };
            await v.Ready;
            var fromFull = Str(a, "from");
            var fromRel = fromFull.Length > 0 ? v.Rel(fromFull) : "";
            if (fromRel == null) return new JsonObject { ["outside"] = true };
            var target = Str(a, "target");
            var rel = v.ResolveWiki(fromRel, target);
            var tail = VaultLinks.SplitWiki(target).Tail;
            var heading = tail.StartsWith('#') ? tail[1..].Split('|')[0].Trim() : "";
            if (rel != null) { await host.OpenFilesAsync([v.Full(rel)!]); return new JsonObject { ["opened"] = rel, ["full"] = v.Full(rel), ["heading"] = heading }; }
            target = VaultLinks.SplitWiki(target).Target;
            return Run(() => { var (folder, name) = v.PlaceForNewLink(fromRel, target); return new JsonObject { ["missing"] = true, ["folder"] = folder, ["name"] = name }; });
        });
        Command("vault.createLink", async (a, host, _) =>
        {
            var v = V(host);
            var fromRel = Str(a, "from").Length > 0 ? v.Rel(Str(a, "from")) ?? "" : "";
            var rel = Run(() => v.CreateNoteForLink(fromRel, Str(a, "target")));
            await v.RescanAsync();
            await host.OpenFilesAsync([v.Full(rel)!]);
            return new JsonObject { ["path"] = rel };
        });
        Command("vault.newNote", async (a, host, _) =>
        {
            var v = V(host);
            var name = Str(a, "name");
            var rel = Run(() => v.Ops.CreateNote(Str(a, "folder"), name.Length > 0 ? name : null, name.Length > 0 ? $"# {Path.GetFileNameWithoutExtension(name)}\n\n" : ""));
            await v.RescanAsync();
            await host.OpenFilesAsync([v.Full(rel)!]);
            return new JsonObject { ["path"] = rel };
        });
        Command("vault.newFolder", async (a, host, _) =>
        {
            var v = V(host);
            var rel = Run(() => v.Ops.CreateFolder(Str(a, "parent"), Str(a, "name")));
            await v.RescanAsync();
            return new JsonObject { ["path"] = rel };
        });
        Command("vault.renamePlan", (a, host, _) => Task.FromResult(Run(() =>
        {
            var v = V(host); var rel = Str(a, "path"); var name = Str(a, "name");
            var parent = rel.Contains('/') ? rel[..rel.LastIndexOf('/')] + "/" : "";
            var ext = VaultPaths.IsNote(rel) && !Path.HasExtension(name) ? Path.GetExtension(rel) : "";
            var plan = v.PlanLinks([(rel, parent + name + ext)]);
            return (JsonNode?)new JsonObject { ["links"] = plan.Links, ["notes"] = new JsonArray(plan.Notes.Select(n => (JsonNode?)n).ToArray()) };
        })));
        Command("vault.rename", async (a, host, _) =>
        {
            var v = V(host);
            var (moves, links) = Run(() => v.Rename(Str(a, "path"), Str(a, "name"), Bool(a, "updateLinks"), Skip(a)));
            return await Moved(host, v, moves, links);
        });
        Command("vault.movePlan", (a, host, _) => Task.FromResult(Run(() =>
        {
            var v = V(host); var folder = Str(a, "folder");
            var plan = v.PlanLinks(Strs(a, "paths").Select(p => (p, (folder.Length > 0 ? folder + "/" : "") + p[(p.LastIndexOf('/') + 1)..])).ToList());
            return (JsonNode?)new JsonObject { ["links"] = plan.Links, ["notes"] = new JsonArray(plan.Notes.Select(n => (JsonNode?)n).ToArray()) };
        })));
        Command("vault.move", async (a, host, _) =>
        {
            var v = V(host);
            var (moves, links) = Run(() => v.Move(Strs(a, "paths"), Str(a, "folder"), Bool(a, "updateLinks"), Skip(a)));
            return await Moved(host, v, moves, links);
        });
        Command("vault.delete", async (a, host, _) =>
        {
            var v = V(host);
            var gone = Run(() => v.Delete(Strs(a, "paths")));
            await v.RescanAsync();
            return new JsonObject { ["deleted"] = gone.Count, ["paths"] = new JsonArray(gone.Select(p => (JsonNode?)p).ToArray()) };
        });
        Command("vault.reveal", (a, host, _) => Task.FromResult(Run(() =>
        {
            var v = V(host);
            var full = Str(a, "path").Length > 0 ? v.Full(Str(a, "path")) : v.Root;
            if (full != null && OperatingSystem.IsWindows())
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", File.Exists(full) ? $"/select,\"{full}\"" : $"\"{full}\"") { UseShellExecute = false });
            return (JsonNode?)null;
        })));
        Command("vault.fullPath", (a, host, _) => Task.FromResult<JsonNode?>(V(host).Full(Str(a, "path"))));
    }

    /// <summary>After a rename or move: every bench hears about it (open documents follow), and the page learns which
    /// notes had their links rewritten.</summary>
    async Task<JsonNode?> Moved(IBenchHost host, VaultSession v, IReadOnlyList<VaultMove> moves, LinkResult links)
    {
        await v.RescanAsync();
        List(host).Moved(v.Root, moves.Select(m => (v.Rel(m.OldFull) ?? "", v.Rel(m.NewFull) ?? "")).Where(m => m.Item1.Length > 0));
        await host.FilesMovedAsync(moves.Select(m => new FileMove(m.OldFull, m.NewFull)).ToList());
        return new JsonObject
        {
            ["moves"] = new JsonArray(moves.Select(m => (JsonNode?)new JsonObject { ["from"] = v.Rel(m.OldFull), ["to"] = v.Rel(m.NewFull), ["fromFull"] = m.OldFull, ["toFull"] = m.NewFull }).ToArray()),
            ["links"] = links.Links, ["notes"] = links.Notes,
            ["skipped"] = new JsonArray(links.Skipped.Select(s => (JsonNode?)s).ToArray()),
            ["updated"] = new JsonArray(links.Updated.Select(s => (JsonNode?)s).ToArray()),
        };
    }

    static JsonObject Props(string text)
    {
        var o = new JsonObject();
        foreach (var (k, vals) in VaultNotes.FrontMatter(text)) o[k] = new JsonArray(vals.Select(x => (JsonNode?)x).ToArray());
        return o;
    }

    static PackageOptions PackOptions(JsonElement a)
    {
        var o = new PackageOptions
        {
            Selection = Strs(a, "selection"),
            IncludeAttachments = !a.TryGetProperty("attachments", out var at) || at.ValueKind != JsonValueKind.False,
            IncludeDependencies = Bool(a, "dependencies"),
            SkipDependencies = Strs(a, "skipDependencies"),
            PreserveStructure = !a.TryGetProperty("preserve", out var pr) || pr.ValueKind != JsonValueKind.False,
            Manifest = Bool(a, "manifest"),
            Handoff = Bool(a, "handoff"),
            HandoffNote = Str(a, "note") is { Length: > 0 and < 20_000 } n ? n : null,
        };
        return o;
    }

    static string SuggestedZip(VaultSession v, PackageOptions o)
    {
        var baseName = o.Selection.Count == 1 && o.Selection[0].Length > 0 ? Path.GetFileNameWithoutExtension(o.Selection[0].TrimEnd('/')) : v.Name;
        if (o.Handoff) baseName += " (handoff)";
        return DocumentFile.SafeFileName(baseName, ".zip");
    }

    static JsonNode GraphJson(VaultGraph g, string? center) => new JsonObject
    {
        ["inVault"] = true, ["center"] = center,
        ["nodes"] = new JsonArray(g.Nodes.Select(n => (JsonNode?)new JsonObject
        {
            ["path"] = n.Path, ["name"] = n.Name, ["links"] = n.Links, ["missing"] = n.Missing,
            ["folder"] = n.Missing || !n.Path.Contains('/') ? "" : n.Path[..n.Path.IndexOf('/')],
            ["tags"] = new JsonArray(n.Tags.Select(t => (JsonNode?)t).ToArray()),
        }).ToArray()),
        ["edges"] = new JsonArray(g.Edges.Select(e => (JsonNode?)new JsonArray(e.From, e.To)).ToArray()),
    };

    static string Str(JsonElement a, string name) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
    static bool Bool(JsonElement a, string name) => a.ValueKind == JsonValueKind.Object && a.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
    static List<string> Strs(JsonElement a, string name) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array ? v.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList() : [];
    /// <summary>Files the Markdown bench has open with unsaved changes: their links aren't rewritten under them.</summary>
    static HashSet<string> Skip(JsonElement a) => Strs(a, "skip").Where(Path.IsPathFullyQualified).Select(Path.GetFullPath).ToHashSet(StringComparer.OrdinalIgnoreCase);

    static T Run<T>(Func<T> fn)
    {
        try { return fn(); }
        catch (Exception ex) when (ex is VaultOperationException or VaultPartialMoveException or IOException or UnauthorizedAccessException or ArgumentException)
        { throw new BenchException(ex.Message); }
    }
}

/// <summary>The vaults opened lately (newest first), and the one open when NoorMD closed.</summary>
sealed class VaultList(string file)
{
    sealed class Data
    {
        public string? Last { get; set; }
        public List<string> Recent { get; set; } = [];
        public Dictionary<string, List<string>> Bookmarks { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    }
    readonly Data _d = Load(file);

    public string? Last => _d.Last;
    public IReadOnlyList<string> Recent => _d.Recent;

    public void Opened(string root)
    {
        _d.Recent.RemoveAll(p => string.Equals(p, root, StringComparison.OrdinalIgnoreCase));
        _d.Recent.Insert(0, root);
        if (_d.Recent.Count > 12) _d.Recent.RemoveRange(12, _d.Recent.Count - 12);
        _d.Last = root; Save();
    }
    public void Closed() { _d.Last = null; Save(); }

    public IReadOnlyList<string> Bookmarks(string root) => _d.Bookmarks.TryGetValue(root, out var l) ? l : [];
    public bool IsBookmarked(string root, string rel) => Bookmarks(root).Contains(rel, StringComparer.OrdinalIgnoreCase);
    public void SetBookmark(string root, string rel, bool on)
    {
        if (!_d.Bookmarks.TryGetValue(root, out var l)) _d.Bookmarks[root] = l = [];
        l.RemoveAll(x => string.Equals(x, rel, StringComparison.OrdinalIgnoreCase));
        if (on) l.Insert(0, rel);
        Save();
    }
    /// <summary>Bookmarks follow renames and moves.</summary>
    public void Moved(string root, IEnumerable<(string From, string To)> moves)
    {
        if (!_d.Bookmarks.TryGetValue(root, out var l)) return;
        bool changed = false;
        foreach (var (from, to) in moves)
            for (int i = 0; i < l.Count; i++)
            {
                if (string.Equals(l[i], from, StringComparison.OrdinalIgnoreCase)) { l[i] = to; changed = true; }
                else if (l[i].StartsWith(from + "/", StringComparison.OrdinalIgnoreCase)) { l[i] = to + l[i][from.Length..]; changed = true; }
            }
        if (changed) Save();
    }
    public void Forget(string root) { _d.Recent.RemoveAll(p => string.Equals(p, root, StringComparison.OrdinalIgnoreCase)); if (string.Equals(_d.Last, root, StringComparison.OrdinalIgnoreCase)) _d.Last = null; Save(); }

    static Data Load(string file)
    {
        try { return JsonSerializer.Deserialize<Data>(File.ReadAllText(file)) ?? new Data(); }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { return new Data(); }
    }
    void Save()
    {
        try { AtomicFile.WriteAllText(file, JsonSerializer.Serialize(_d)); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}
