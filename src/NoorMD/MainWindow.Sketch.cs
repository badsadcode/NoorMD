using System.IO;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Documents;
using NoorMD.Core.Security;
using NoorMD.Core.Sketch;
using NoorMD.Core.Vaults;
using NoorMD.Ui;

namespace NoorMD;

/// <summary>NoorSketch windows opened from this window, and inserting a sketch into a document.</summary>
public partial class MainWindow
{
    private readonly List<SketchWindow> _sketches = [];

    internal string CurrentTheme => _settings.Prefs.Theme;

    internal SketchWindow OpenSketch(string? path)
    {
        if (WebEnvironment == null) throw new BridgeError("The editor is still starting. Try again in a moment.");
        var w = new SketchWindow(this, path) { Owner = null };
        _sketches.Add(w);
        w.Show();
        return w;
    }

    internal void SketchClosed(SketchWindow w) => _sketches.Remove(w);

    private object? DispatchSketch(BridgeRequest req)
    {
        switch (req.Type)
        {
            case "sketch.new": OpenSketch(null); return null;
            case "sketch.open":
                {
                    var dlg = new OpenFileDialog { Title = Tr.T("Open sketch"), Filter = Tr.T("NoorSketch (*.noorsketch)|*.noorsketch"), CheckFileExists = true, InitialDirectory = _vault?.Root ?? Environment.GetFolderPath(Environment.SpecialFolder.MyPictures) };
                    Ui.NativeCursor.Restore();
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    try { SketchFile.Load(dlg.FileName); } // refuse a damaged file here, before a window opens
                    catch (Exception ex) when (ex is InvalidDataException or IOException) { throw new BridgeError(ex.Message); }
                    OpenSketch(dlg.FileName);
                    return null;
                }
            default: throw new BridgeError($"Unknown command \"{req.Type}\".");
        }
    }

    /// <summary>
    /// Saves the sketch as a PNG for the document on screen and inserts a relative link to it there. A saved document
    /// gets the PNG beside it ("assets" folder) or in its Vault's attachments folder; an unsaved one asks where.
    /// Nothing is overwritten without the Save dialog's own confirmation.
    /// </summary>
    internal async Task<object> InsertSketchAsync(byte[] png, string background, bool withSource, string name, SketchWindow from)
    {
        var s = ActiveSession ?? throw new InvalidOperationException("No document is open in NoorMD.");
        string folder;
        var created = false;
        if (VaultRootFor(s.Path) is { } root && _vault is { } v) folder = VaultPaths.Resolve(root, v.Info.Attachments) ?? root;
        else if (s.Folder != null) folder = Path.Combine(s.Folder, "assets");
        else folder = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);
        if (!Directory.Exists(folder)) { Directory.CreateDirectory(folder); created = true; }

        var baseName = Path.GetFileNameWithoutExtension(DocumentFile.SafeFileName(string.IsNullOrWhiteSpace(name) || name == "Untitled sketch" ? "sketch" : name, ".png"));
        var dlg = new SaveFileDialog
        {
            Title = s.Path == null ? "Save the sketch picture (the document is not saved yet, so choose where)" : $"Save the sketch picture for “{s.FileName}”",
            Filter = Tr.T("PNG image (*.png)|*.png"), DefaultExt = ".png", AddExtension = true, OverwritePrompt = true,
            InitialDirectory = folder, FileName = VaultPaths.UniqueName(folder, baseName, ".png"),
        };
        if (dlg.ShowDialog(from) != true)
        {
            if (created) try { if (!Directory.EnumerateFileSystemEntries(folder).Any()) Directory.Delete(folder); } catch { }
            return new { cancelled = true };
        }
        var pngPath = dlg.FileName;
        await Task.Run(() => AtomicFile.WriteAllBytes(pngPath, png));
        if (withSource)
        {
            var source = Path.ChangeExtension(pngPath, ".noorsketch");
            if (!File.Exists(source) || ThemedDialog.Confirm(from, "Replace the editable sketch?", $"“{Path.GetFileName(source)}” already exists next to the picture. Replace it with this sketch?", "Replace", source))
                await Task.Run(() => SketchFile.Save(source, png, background));
        }
        if (created && !Directory.EnumerateFileSystemEntries(folder).Any()) try { Directory.Delete(folder); } catch { }

        if (!_tabs.ContainsKey(s.TabId)) throw new InvalidOperationException("That document was closed while the picture was saved. The picture is at " + pngPath);
        string link;
        if (s.Folder != null && LinkPaths.TryRelative(s.Folder, pngPath, AllowedImageRoot(s), out var rel)) link = rel;
        else
        {
            link = new Uri(pngPath).AbsoluteUri;
            PushNotice(s.Folder == null ? "Save the document to link pictures relative to it. This link uses the picture's full path." : "The picture is outside the document's folder, so it is linked by its full path.");
        }
        var alt = string.IsNullOrWhiteSpace(name) || name == "Untitled sketch" ? "Sketch" : name.Replace("[", "").Replace("]", "");
        PushEvent("insert.text", new { tabId = s.TabId, markdown = $"![{alt}]({link})" });
        ScheduleRescan(0);
        return new { inserted = true, link, path = pngPath, document = s.FileName };
    }

    /// <summary>Before the main window closes: sketches with unsaved drawings are pointed out, not lost.</summary>
    private bool ConfirmCloseSketches()
    {
        var dirty = _sketches.Where(w => w.IsDirty).ToList();
        if (dirty.Count == 0) { foreach (var w in _sketches.ToList()) w.CloseWithoutPrompt(); return true; }
        var choice = ThemedDialog.Show(this, dirty.Count == 1 ? $"Save the sketch “{dirty[0].SketchName}”?" : $"{dirty.Count} sketches have unsaved drawings",
            "NoorSketch windows close together with NoorMD.",
            [new DialogButton("Cancel", "cancel", Cancel: true), new DialogButton("Close without saving", "discard"), new DialogButton("Review sketches", "review", Primary: true)]);
        if (choice == "discard") { foreach (var w in _sketches.ToList()) w.CloseWithoutPrompt(); return true; }
        if (choice == "review") dirty[0].Activate();
        return false;
    }
}
