using System.Diagnostics;
using System.IO;
using System.Text.Json;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Vaults;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>
/// Vault Pack &amp; Share: preview a selection, then write it to a ZIP in the background. Source files are only read;
/// the archive appears under its real name only when it is complete (see ZipPackager).
/// </summary>
public partial class MainWindow
{
    private CancellationTokenSource? _packCts;
    private string? _lastPack;

    private PackageOptions PackOptionsFrom(BridgeRequest req)
    {
        var p = req.Payload;
        bool Flag(string name, bool fallback) => p.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False ? v.GetBoolean() : fallback;
        var o = new PackageOptions
        {
            Selection = StringList(req, "paths"),
            IncludeAttachments = Flag("attachments", true),
            IncludeDependencies = Flag("dependencies", false),
            SkipDependencies = StringList(req, "skipDependencies"),
            PreserveStructure = Flag("preserve", true),
            Manifest = Flag("manifest", false),
            Handoff = Flag("handoff", false),
            HandoffNote = req.GetString("note", 20_000),
        };
        if (p.TryGetProperty("exclusions", out var ex) && ex.ValueKind == JsonValueKind.Array)
            o.Exclusions = ex.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!.Trim()).Where(x => x.Length is > 0 and < 200).Take(500).ToList();
        return o;
    }

    private async Task<object?> DispatchPackAsync(BridgeRequest req)
    {
        switch (req.Type)
        {
            case "vault.pack.plan":
                {
                    var v = V();
                    var o = PackOptionsFrom(req);
                    var plan = await Task.Run(() => PackagePlanner.Build(v.Root, o));
                    return new
                    {
                        defaults = PackagePlanner.DefaultExclusions,
                        files = plan.Files.Take(5000).Select(f => new { entry = f.Entry, size = f.Size, dependency = f.Reason == PackReason.Dependency }),
                        fileCount = plan.Files.Count,
                        bytes = plan.TotalBytes,
                        excluded = plan.Excluded.Take(2000).Select(e => new { path = e.Path, rule = e.Rule }),
                        excludedCount = plan.Excluded.Count,
                        dependencies = plan.Dependencies.Select(d => new { path = d.Path, from = d.LinkedFrom, included = d.Included }),
                        unresolved = plan.Unresolved.Take(500).Select(u => new { from = u.From, target = u.Target, problem = u.Problem }),
                        generated = plan.Generated.Select(g => g.Entry),
                        warnings = plan.Warnings,
                        unsaved = await UnsavedInPlanAsync(plan),
                        suggestedName = SuggestedZipName(v, o),
                    };
                }
            case "vault.pack.create": return await CreatePackageAsync(req);
            case "vault.pack.cancel": _packCts?.Cancel(); return null;
            case "vault.pack.reveal":
                if (_lastPack == null || !File.Exists(_lastPack)) throw new BridgeError("The archive is no longer there.");
                Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{_lastPack}\"") { UseShellExecute = false });
                return null;
            default: throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }

    /// <summary>Open documents in the package that have unsaved edits: the archive would hold their last saved text.</summary>
    private async Task<List<object>> UnsavedInPlanAsync(PackagePlan plan)
    {
        var sources = new HashSet<string>(plan.Files.Select(f => f.Source), StringComparer.OrdinalIgnoreCase);
        var list = new List<object>();
        foreach (var s in OrderedTabs())
        {
            if (s.Path == null || !sources.Contains(s.Path)) continue;
            var st = await GetEditorStateAsync(s.TabId);
            if (st?.Dirty ?? s.Dirty) list.Add(new { tabId = s.TabId, name = s.FileName });
        }
        return list;
    }

    private static string SuggestedZipName(VaultState v, PackageOptions o)
    {
        var baseName = o.Selection.Count == 1 ? Path.GetFileNameWithoutExtension(o.Selection[0].TrimEnd('/')) : v.Info.Name;
        if (string.IsNullOrWhiteSpace(baseName)) baseName = v.Info.Name;
        if (o.Handoff) baseName += " (handoff)";
        return NoorMD.Core.Documents.DocumentFile.SafeFileName(baseName, ".zip");
    }

    private async Task<object?> CreatePackageAsync(BridgeRequest req)
    {
        var v = V();
        if (_packCts != null) throw new BridgeError("A package is already being created.");
        var o = PackOptionsFrom(req);

        // Unsaved edits: save them first, or package what is on disk — the user decides, nothing is silently stale.
        if (Json.IsTrue(req.Payload, "saveFirst"))
        {
            var plan0 = await Task.Run(() => PackagePlanner.Build(v.Root, o));
            var sources = new HashSet<string>(plan0.Files.Select(f => f.Source), StringComparer.OrdinalIgnoreCase);
            foreach (var s in OrderedTabs().Where(s => s.Path != null && sources.Contains(s.Path)).ToList())
            {
                var st = await GetEditorStateAsync(s.TabId);
                if (st is { Dirty: true } && !await SaveCoreAsync(s, saveAs: false, st)) return new { cancelled = true };
            }
        }

        var name = SuggestedZipName(v, o);
        var folder = Path.GetDirectoryName(v.Root) is { Length: > 0 } parent && Directory.Exists(parent) ? parent : Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
        var dlg = new SaveFileDialog
        {
            Title = o.Handoff ? "Save the AI handoff package" : "Save the ZIP package",
            Filter = "ZIP archive (*.zip)|*.zip",
            DefaultExt = ".zip",
            AddExtension = true,
            OverwritePrompt = true,
            FileName = UniqueFileName(folder, name),
            InitialDirectory = folder,
        };
        if (dlg.ShowDialog(this) != true) return new { cancelled = true };
        o.OutputPath = dlg.FileName;

        _packCts = new CancellationTokenSource();
        var ct = _packCts.Token;
        var lastPush = DateTime.MinValue;
        var progress = new Progress<PackProgress>(p =>
        {
            if ((DateTime.UtcNow - lastPush).TotalMilliseconds < 120 && p.Done < p.Total) return;
            lastPush = DateTime.UtcNow;
            PushEvent("vault.pack.progress", new { done = p.Done, total = p.Total, bytes = p.Bytes });
        });
        try
        {
            var result = await Task.Run(() =>
            {
                var plan = PackagePlanner.Build(v.Root, o, ct);
                return ZipPackager.Create(plan, o.OutputPath, progress, ct);
            }, ct);
            _lastPack = result.Path;
            Log.Info($"Packed {result.Entries} files ({result.Bytes} bytes) to {result.Path}; {result.Failures.Count} failed");
            return new { path = result.Path, entries = result.Entries, bytes = result.Bytes, failures = result.Failures.Select(f => new { entry = f.Entry, problem = f.Problem }) };
        }
        catch (OperationCanceledException) { return new { cancelled = true }; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Error("Packing failed", ex);
            throw new BridgeError("The package could not be created: " + FriendlyError(ex) + " Your files were not changed.");
        }
        finally
        {
            _packCts.Dispose();
            _packCts = null;
        }
    }

    private static string UniqueFileName(string folder, string name)
    {
        if (!File.Exists(Path.Combine(folder, name))) return name;
        var stem = Path.GetFileNameWithoutExtension(name);
        for (int i = 2; i < 1000; i++)
        {
            var candidate = $"{stem} ({i}).zip";
            if (!File.Exists(Path.Combine(folder, candidate))) return candidate;
        }
        return name;
    }
}
