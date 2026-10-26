namespace NoorMD.Core.Documents;

/// <summary>A document read from disk plus the facts needed to save it back faithfully.</summary>
public sealed record LoadedDocument(string Path, string Markdown, TextFormat Format, FileStamp Stamp, string? Warning);

/// <summary>Identifies a version of a file on disk, used to detect changes made by other programs.</summary>
public sealed record FileStamp(DateTime LastWriteUtc, long Length)
{
    public static FileStamp? Read(string path)
    {
        try
        {
            var info = new FileInfo(path);
            return info.Exists ? new FileStamp(info.LastWriteTimeUtc, info.Length) : null;
        }
        catch { return null; }
    }
}

public static class DocumentFile
{
    public static readonly string[] OpenableExtensions = [".md", ".markdown", ".mdown", ".mkd", ".txt"];

    public static bool IsOpenable(string path) =>
        OpenableExtensions.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase);

    public static LoadedDocument Load(string path)
    {
        var full = Path.GetFullPath(path);
        var info = new FileInfo(full);
        if (!info.Exists) throw new FileNotFoundException($"\"{full}\" does not exist.", full);
        if (info.Length > TextFileCodec.MaxFileBytes)
            throw new IOException($"\"{info.Name}\" is {info.Length / (1024 * 1024)} MB. NoorMD opens files up to {TextFileCodec.MaxFileBytes / (1024 * 1024)} MB.");

        byte[] bytes;
        using (var fs = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        {
            bytes = new byte[fs.Length];
            fs.ReadExactly(bytes);
        }
        var decoded = TextFileCodec.Decode(bytes);
        return new LoadedDocument(full, decoded.Text, decoded.Format, new FileStamp(info.LastWriteTimeUtc, info.Length), decoded.Warning);
    }

    /// <summary>Writes atomically and returns the new on-disk stamp.</summary>
    public static FileStamp Save(string path, string markdown, TextFormat format, string? backupPath)
    {
        var bytes = TextFileCodec.Encode(markdown, format);
        AtomicFile.WriteAllBytes(path, bytes, backupPath);
        return FileStamp.Read(path) ?? new FileStamp(DateTime.UtcNow, bytes.Length);
    }

    /// <summary>Suggested file name for an untitled document, with characters Windows forbids removed.</summary>
    public static string SafeFileName(string title, string extension = ".md")
    {
        var invalid = Path.GetInvalidFileNameChars().Concat(['\\', '/', ':', '*', '?', '"', '<', '>', '|']).ToHashSet();
        var cleaned = new string(title.Trim().Select(c => invalid.Contains(c) || char.IsControl(c) ? '-' : c).ToArray()).Trim(' ', '.');
        if (cleaned.Length == 0) cleaned = "Untitled document";
        if (cleaned.Length > 100) cleaned = cleaned[..100].TrimEnd(' ', '.');
        var reserved = new[] { "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3" };
        if (reserved.Contains(cleaned, StringComparer.OrdinalIgnoreCase)) cleaned += "-document";
        return cleaned + extension;
    }
}
