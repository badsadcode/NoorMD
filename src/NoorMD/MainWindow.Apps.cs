using System.Diagnostics;
using System.IO;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Hub;
using NoorMD.Core.Security;
using NoorMD.Host;

namespace NoorMD;

/// <summary>
/// Apps Hub: shortcuts to programs, games, files, folders and websites with their pictures. The list lives in
/// NoorMD's local data folder. The page only ever names a shortcut by id; what runs is what you added yourself.
/// Websites open in your browser; NoorMD fetches nothing from the internet (no favicons).
/// </summary>
public partial class MainWindow
{
    private AppsHub? _hub;
    private AppsHub Hub => _hub ??= new AppsHub(Path.Combine(App.Paths.Local, "Apps"));

    private object HubPayload() => new { items = Hub.Items.Select(HubItemForPage), groups = Hub.Groups() };

    private static object HubItemForPage(HubItem i) => new
    {
        id = i.Id, name = i.Name, kind = i.Kind.ToString().ToLowerInvariant(), target = i.Target, arguments = i.Arguments, group = i.Group,
        icon = i.Icon != null ? "/_hubicon/" + i.Icon : null, color = i.Color, lastUsed = i.LastUsedUtc, uses = i.Uses,
        exists = i.Kind == HubKind.Web || File.Exists(i.Target) || Directory.Exists(i.Target),
    };

    private async Task<object?> DispatchAppsAsync(BridgeRequest req)
    {
        var p = req.Payload;
        try
        {
            switch (req.Type)
            {
                case "apps.list": return HubPayload();
                case "apps.add":
                {
                    var kind = req.GetString("kind", 10);
                    string? path;
                    if (kind == "folder")
                    {
                        var dlg = new OpenFolderDialog { Title = "Add a folder to the Apps Hub" };
                        path = dlg.ShowDialog(this) == true ? dlg.FolderName : null;
                    }
                    else
                    {
                        var dlg = new OpenFileDialog
                        {
                            Title = "Add programs, games or files to the Apps Hub",
                            Multiselect = true,
                            DereferenceLinks = false, // keep shortcuts (.lnk) as they are: their own icon and arguments
                            Filter = "Programs and shortcuts (*.exe;*.lnk;*.url;*.appref-ms;*.bat;*.cmd)|*.exe;*.lnk;*.url;*.appref-ms;*.bat;*.cmd|All files (*.*)|*.*",
                            InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu),
                        };
                        if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                        var added = new List<object>();
                        foreach (var f in dlg.FileNames) added.Add(HubItemForPage(await AddHubPathAsync(f, req.GetString("group", 40))));
                        return new { added, hub = HubPayload() };
                    }
                    if (path == null) return new { cancelled = true };
                    return new { added = new[] { HubItemForPage(await AddHubPathAsync(path, req.GetString("group", 40))) }, hub = HubPayload() };
                }
                case "apps.addWeb":
                {
                    var url = req.GetString("url", 2000)?.Trim() ?? "";
                    var name = req.GetString("name", 80);
                    if (string.IsNullOrWhiteSpace(name) && Uri.TryCreate(url, UriKind.Absolute, out var u)) name = u.Scheme is "http" or "https" ? u.Host.Replace("www.", "") : u.Scheme;
                    var item = Hub.Add(new HubItem { Name = name ?? "", Kind = HubKind.Web, Target = url, Group = req.GetString("group", 40) ?? "Web" });
                    return new { added = new[] { HubItemForPage(item) }, hub = HubPayload() };
                }
                case "apps.update":
                    Hub.Update(req.GetString("id", 40) ?? "", req.GetString("name", 80), req.GetString("group", 40), req.GetString("arguments", 1000), req.GetString("color", 10), req.GetString("url", 2000));
                    return HubPayload();
                case "apps.remove":
                    Hub.Remove(req.GetString("id", 40) ?? "");
                    return HubPayload();
                case "apps.reorder":
                    Hub.Reorder(p.TryGetProperty("ids", out var ids) && ids.ValueKind == System.Text.Json.JsonValueKind.Array ? ids.EnumerateArray().Select(x => x.GetString() ?? "").ToList() : []);
                    return HubPayload();
                case "apps.launch": return LaunchHubItem(req.GetString("id", 40) ?? "");
                case "apps.reveal":
                {
                    var i = Hub.Get(req.GetString("id", 40) ?? "") ?? throw new BridgeError("That shortcut is no longer in the hub.");
                    if (i.Kind == HubKind.Web) throw new BridgeError("A web address has no file to show.");
                    if (!File.Exists(i.Target) && !Directory.Exists(i.Target)) throw new BridgeError($"“{i.Target}” is not there any more.");
                    Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{i.Target}\"") { UseShellExecute = false });
                    return null;
                }
                case "apps.icon.pick":
                {
                    var id = req.GetString("id", 40) ?? "";
                    var dlg = new OpenFileDialog { Title = "Choose a picture", Filter = "Pictures (*.png;*.jpg;*.jpeg;*.webp;*.gif;*.ico;*.bmp)|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.ico;*.bmp" };
                    if (dlg.ShowDialog(this) != true) return new { cancelled = true };
                    var info = new FileInfo(dlg.FileName);
                    if (info.Length > 8 * 1024 * 1024) throw new BridgeError("Choose a picture under 8 MB.");
                    Directory.CreateDirectory(Hub.IconsFolder);
                    var name = $"{id}-{DateTime.UtcNow:yyyyMMddHHmmss}{info.Extension.ToLowerInvariant()}";
                    File.Copy(dlg.FileName, Path.Combine(Hub.IconsFolder, name), overwrite: true);
                    Hub.SetIcon(id, name);
                    return HubPayload();
                }
                case "apps.icon.reset":
                {
                    var i = Hub.Get(req.GetString("id", 40) ?? "") ?? throw new BridgeError("That shortcut is no longer in the hub.");
                    Hub.SetIcon(i.Id, i.Kind == HubKind.Web ? null : await SaveShellIconAsync(i.Id, i.Target, i.Kind));
                    return HubPayload();
                }
                default:
                    throw new BridgeError($"Unknown command \"{req.Type}\".");
            }
        }
        catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
        catch (InvalidOperationException ex) { throw new BridgeError(ex.Message); }
    }

    private async Task<HubItem> AddHubPathAsync(string path, string? group)
    {
        var (kind, name, guessGroup) = AppsHub.Guess(path);
        var item = Hub.Add(new HubItem { Name = name, Kind = kind, Target = path, Group = group ?? guessGroup });
        var icon = await SaveShellIconAsync(item.Id, path, kind);
        return icon != null ? Hub.SetIcon(item.Id, icon) : item;
    }

    /// <summary>Saves the Windows picture for a path in the hub's icons folder. Returns its file name, or null.</summary>
    private async Task<string?> SaveShellIconAsync(string id, string path, HubKind kind)
    {
        // The shell must be called on an STA thread; the UI thread is one, and it is quick.
        await Task.Yield();
        var png = ShellIcons.Png(path, 96, iconOnly: kind != HubKind.File);
        if (png == null) return null;
        Directory.CreateDirectory(Hub.IconsFolder);
        var name = $"{id}-shell.png";
        await File.WriteAllBytesAsync(Path.Combine(Hub.IconsFolder, name), png);
        return name;
    }

    private object LaunchHubItem(string id)
    {
        var i = Hub.Get(id) ?? throw new BridgeError("That shortcut is no longer in the hub.");
        try
        {
            if (i.Kind == HubKind.Web)
            {
                if (AppsHub.AddressProblem(i.Target) is { } problem) throw new BridgeError(problem);
                Process.Start(new ProcessStartInfo(i.Target) { UseShellExecute = true });
            }
            else
            {
                if (!File.Exists(i.Target) && !Directory.Exists(i.Target)) throw new BridgeError($"“{i.Name}” is not there any more ({i.Target}). Edit or remove the shortcut.");
                var psi = new ProcessStartInfo(i.Target) { UseShellExecute = true };
                if (!string.IsNullOrWhiteSpace(i.Arguments) && i.Kind == HubKind.App) psi.Arguments = i.Arguments;
                if (i.Kind == HubKind.App && Path.GetDirectoryName(i.Target) is { } dir) psi.WorkingDirectory = dir; // games often need their own folder
                Process.Start(psi);
            }
        }
        catch (System.ComponentModel.Win32Exception ex) { throw new BridgeError($"Windows could not start “{i.Name}”: {ex.Message}"); }
        Log.Info($"Apps Hub: started {i.Kind} “{i.Name}”");
        return HubItemForPage(Hub.MarkUsed(i.Id));
    }

    /// <summary>Serves /_hubicon/{file} from the hub's icons folder (pictures only, no other path).</summary>
    private bool TryServeHubIcon(Uri uri, CoreWebView2WebResourceRequestedEventArgs e, CoreWebView2Environment env)
    {
        if (!uri.AbsolutePath.StartsWith("/_hubicon/", StringComparison.Ordinal)) return false;
        var name = Uri.UnescapeDataString(uri.AbsolutePath["/_hubicon/".Length..]);
        var file = Path.Combine(Hub.IconsFolder, name);
        var ext = Path.GetExtension(name).ToLowerInvariant();
        var mime = ext switch { ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".webp" => "image/webp", ".gif" => "image/gif", ".ico" => "image/x-icon", ".bmp" => "image/bmp", _ => null };
        if (mime == null || name.Contains('/') || name.Contains('\\') || name.Contains("..") || !File.Exists(file))
        {
            e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
            return true;
        }
        e.Response = env.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(file)), 200, "OK", $"Content-Type: {mime}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
        return true;
    }
}
