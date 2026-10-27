using System.Diagnostics;
using System.IO;
using Microsoft.Web.WebView2.Core;
using NoorMD.Core;
using NoorMD.Core.Bridge;
using NoorMD.Core.Media;
using NoorMD.Host;

namespace NoorMD;

/// <summary>
/// Voice notes: the page records (MediaRecorder) and sends the audio in pieces; recordings are saved next to your
/// notes (the Vault's attachments\Voice notes, or Documents\NoorMD\Voice notes) and can be linked into a document.
/// The microphone is only allowed for a few seconds after you press Record in NoorMD, never otherwise.
/// </summary>
public partial class MainWindow
{
    private VoiceNotes? _voice;
    private DateTime _micArmedUntilUtc = DateTime.MinValue;

    private string VoiceFolder => _vault is { } v
        ? Path.Combine(v.Root, v.Info.Attachments.Replace('/', Path.DirectorySeparatorChar), "Voice notes")
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "NoorMD", "Voice notes");

    private VoiceNotes Voice => _voice is { } v && v.Folder == VoiceFolder ? v : (_voice = new VoiceNotes(VoiceFolder));

    /// <summary>Microphone access for the app page only right after Record was pressed in NoorMD.</summary>
    private void OnPermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        var allow = e.PermissionKind == CoreWebView2PermissionKind.Microphone && DateTime.UtcNow < _micArmedUntilUtc
            && Uri.TryCreate(e.Uri, UriKind.Absolute, out var u) && NoorMD.Core.Security.AssetResolver.IsAppPage(u);
        e.State = allow ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
        if (allow) _micArmedUntilUtc = DateTime.MinValue; // once per press
    }

    private object VoiceStatus() => new
    {
        folder = Voice.Folder, inVault = _vault != null,
        recordings = Voice.List().Select(r => new { name = r.Name, file = Path.GetFileName(r.Path), size = r.Size, created = r.CreatedUtc, url = "/_voice/" + Uri.EscapeDataString(Path.GetFileName(r.Path)) }),
    };

    private async Task<object?> DispatchVoiceAsync(BridgeRequest req)
    {
        var p = req.Payload;
        try
        {
            switch (req.Type)
            {
                case "voice.status": return VoiceStatus();
                case "voice.arm":
                    _micArmedUntilUtc = DateTime.UtcNow.AddSeconds(15);
                    return null;
                case "voice.begin": return new { token = Voice.Begin(req.GetString("name", 120), req.GetString("ext", 8) ?? ".webm") };
                case "voice.chunk":
                {
                    var data = Convert.FromBase64String(req.GetString("data", 2_000_000) ?? "");
                    Voice.Append(req.GetString("token", 40) ?? "", data);
                    return null;
                }
                case "voice.cancel":
                    Voice.Cancel(req.GetString("token", 40) ?? "");
                    return null;
                case "voice.finish":
                {
                    var path = await Task.Run(() => Voice.Finish(req.GetString("token", 40) ?? "", DateTime.Now));
                    var seconds = NoorMD.Core.Bridge.Json.OptDouble(p, "seconds") ?? 0;
                    var doc = TryTabFrom(req)?.Path ?? ActiveSession?.Path;
                    if (_vault != null) ScheduleRescan(0);
                    Log.Info("Voice note saved: " + Path.GetFileName(path));
                    return new { path, name = Path.GetFileNameWithoutExtension(path), link = VoiceNotes.LinkFor(path, doc, seconds), status = VoiceStatus() };
                }
                case "voice.delete":
                {
                    var file = VoiceFile(req.GetString("file", 300));
                    await Task.Run(() => RecycleBin.Send([file]));
                    return VoiceStatus();
                }
                case "voice.reveal":
                {
                    var file = VoiceFile(req.GetString("file", 300));
                    Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{file}\"") { UseShellExecute = false });
                    return null;
                }
                case "voice.link":
                {
                    var file = VoiceFile(req.GetString("file", 300));
                    return new { link = VoiceNotes.LinkFor(file, TryTabFrom(req)?.Path ?? ActiveSession?.Path, 0) };
                }
                default:
                    throw new BridgeError($"Unknown command \"{req.Type}\".");
            }
        }
        catch (ArgumentException ex) { throw new BridgeError(ex.Message); }
        catch (FormatException) { throw new BridgeError("The recording could not be read."); }
    }

    /// <summary>A recording in the voice folder, by file name only (no other path).</summary>
    private string VoiceFile(string? name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Contains('/') || name.Contains('\\') || name.Contains("..")) throw new BridgeError("Unknown recording.");
        var file = Path.Combine(Voice.Folder, name);
        if (!File.Exists(file) || !VoiceNotes.Extensions.Contains(Path.GetExtension(file).ToLowerInvariant())) throw new BridgeError("That recording is no longer there.");
        return file;
    }

    /// <summary>Serves /_voice/{file} (audio only, from the voice folder) for the recorder's list.</summary>
    private bool TryServeVoice(Uri uri, CoreWebView2WebResourceRequestedEventArgs e, CoreWebView2Environment env)
    {
        if (!uri.AbsolutePath.StartsWith("/_voice/", StringComparison.Ordinal)) return false;
        var name = Uri.UnescapeDataString(uri.AbsolutePath["/_voice/".Length..]);
        var file = Path.Combine(Voice.Folder, name);
        var ext = Path.GetExtension(name).ToLowerInvariant();
        var mime = ext switch { ".webm" => "audio/webm", ".wav" => "audio/wav", ".ogg" => "audio/ogg", ".m4a" => "audio/mp4", ".mp3" => "audio/mpeg", _ => null };
        if (mime == null || name.Contains('/') || name.Contains('\\') || name.Contains("..") || !File.Exists(file))
        {
            e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
            return true;
        }
        e.Response = env.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(file)), 200, "OK", $"Content-Type: {mime}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff");
        return true;
    }
}
