using System.Globalization;
using NoorMD.Core.Documents;

namespace NoorMD.Core.Media;

public sealed record VoiceRecording(string Path, string Name, long Size, DateTime CreatedUtc);

/// <summary>
/// Voice notes: recordings are ordinary audio files (Opus in WebM, or WAV) in a "Voice notes" folder — inside the open
/// Vault's attachments folder, or Documents\NoorMD\Voice notes without a Vault. The page sends a recording in pieces;
/// it is written in one go when complete, so a half recording never appears as a file.
/// </summary>
public sealed class VoiceNotes
{
    public const long MaxBytes = 300L * 1024 * 1024;
    public static readonly string[] Extensions = [".webm", ".wav", ".ogg", ".m4a", ".mp3"];
    private readonly Dictionary<string, (string Name, string Ext, MemoryStream Data)> _uploads = [];

    public VoiceNotes(string folder) => Folder = folder;

    public string Folder { get; }

    /// <summary>"Voice note 2026-10-27 15-12" (or the name given), made safe for Windows and unique in the folder.</summary>
    public string FileNameFor(string? name, string ext, DateTime local)
    {
        var baseName = string.IsNullOrWhiteSpace(name) ? "Voice note " + local.ToString("yyyy-MM-dd HH-mm", CultureInfo.InvariantCulture) : name.Trim();
        baseName = new string(baseName.Select(c => "<>:\"/\\|?*".Contains(c) || char.IsControl(c) ? '-' : c).ToArray()).Trim(' ', '.');
        if (baseName.Length == 0) baseName = "Voice note";
        if (baseName.Length > 100) baseName = baseName[..100].TrimEnd(' ', '.');
        var candidate = baseName + ext;
        for (var i = 2; File.Exists(Path.Combine(Folder, candidate)); i++) candidate = $"{baseName} ({i}){ext}";
        return candidate;
    }

    public string Begin(string? name, string ext)
    {
        ext = ext.StartsWith('.') ? ext.ToLowerInvariant() : "." + ext.ToLowerInvariant();
        if (!Extensions.Contains(ext)) throw new ArgumentException("Unsupported audio format.");
        var token = Guid.NewGuid().ToString("N");
        lock (_uploads) _uploads[token] = (name ?? "", ext, new MemoryStream());
        return token;
    }

    public void Append(string token, byte[] data)
    {
        lock (_uploads)
        {
            if (!_uploads.TryGetValue(token, out var u)) throw new ArgumentException("That recording is no longer being saved.");
            if (u.Data.Length + data.Length > MaxBytes) { _uploads.Remove(token); u.Data.Dispose(); throw new ArgumentException("The recording is too long to save (over 300 MB)."); }
            u.Data.Write(data);
        }
    }

    /// <summary>Writes the finished recording. Returns the full path.</summary>
    public string Finish(string token, DateTime local)
    {
        (string Name, string Ext, MemoryStream Data) u;
        lock (_uploads)
        {
            if (!_uploads.Remove(token, out u)) throw new ArgumentException("That recording is no longer being saved.");
        }
        using (u.Data)
        {
            if (u.Data.Length < 44) throw new ArgumentException("The recording is empty.");
            Directory.CreateDirectory(Folder);
            var path = Path.Combine(Folder, FileNameFor(u.Name, u.Ext, local));
            AtomicFile.WriteAllBytes(path, u.Data.ToArray());
            return path;
        }
    }

    public void Cancel(string token) { lock (_uploads) { if (_uploads.Remove(token, out var u)) u.Data.Dispose(); } }

    public IReadOnlyList<VoiceRecording> List() =>
        !Directory.Exists(Folder) ? [] :
        new DirectoryInfo(Folder).EnumerateFiles().Where(f => Extensions.Contains(f.Extension.ToLowerInvariant()))
            .OrderByDescending(f => f.CreationTimeUtc).Take(500)
            .Select(f => new VoiceRecording(f.FullName, Path.GetFileNameWithoutExtension(f.Name), f.Length, f.CreationTimeUtc)).ToList();

    /// <summary>
    /// The Markdown link to put in a document: relative to the document's folder when it is saved (so it keeps working
    /// in a Vault and after moving both), otherwise the full path.
    /// </summary>
    public static string LinkFor(string recording, string? documentPath, double seconds)
    {
        var label = $"🎙 {Path.GetFileNameWithoutExtension(recording)}" + (seconds > 0 ? $" ({(int)seconds / 60}:{(int)seconds % 60:00})" : "");
        string target;
        if (documentPath != null && Path.GetDirectoryName(documentPath) is { } dir && Path.GetPathRoot(dir) == Path.GetPathRoot(recording))
            target = Path.GetRelativePath(dir, recording).Replace('\\', '/');
        else target = recording.Replace('\\', '/');
        return $"[{label}](<{target}>)";
    }
}

/// <summary>When the app page may use the microphone: only for a short time after Record was pressed in NoorMD, once.</summary>
public static class MicrophoneGate
{
    public static readonly TimeSpan Window = TimeSpan.FromSeconds(15);

    public static bool Allow(bool isMicrophone, bool fromAppPage, DateTime nowUtc, DateTime armedUntilUtc) =>
        isMicrophone && fromAppPage && nowUtc < armedUntilUtc;
}
