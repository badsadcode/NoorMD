namespace NoorMD.Core.Documents;

/// <summary>
/// Crash-safe file writes: the new content is written and flushed to a temporary file in the same
/// folder, then swapped into place. A failure at any point leaves the original file untouched.
/// </summary>
public static class AtomicFile
{
    public static void WriteAllBytes(string path, byte[] bytes, string? backupPath = null)
    {
        var full = Path.GetFullPath(path);
        var dir = Path.GetDirectoryName(full) ?? throw new IOException("Invalid file path.");
        Directory.CreateDirectory(dir);
        var tmp = Path.Combine(dir, $".{Path.GetFileName(full)}.{Guid.NewGuid():N}.noormd-tmp");

        try
        {
            using (var fs = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 64 * 1024, FileOptions.WriteThrough))
            {
                fs.Write(bytes, 0, bytes.Length);
                fs.Flush(flushToDisk: true);
            }

            if (File.Exists(full))
            {
                if ((File.GetAttributes(full) & FileAttributes.ReadOnly) != 0)
                    throw new UnauthorizedAccessException($"\"{Path.GetFileName(full)}\" is read-only. Use Save As to save a copy.");

                if (backupPath != null) TryCopy(full, backupPath);
                try
                {
                    // Keeps the original file's identity, ACLs and creation time.
                    File.Replace(tmp, full, destinationBackupFileName: null, ignoreMetadataErrors: true);
                }
                catch (IOException)
                {
                    // Some network shares and sync providers don't support ReplaceFile; fall back to copy+delete.
                    File.Copy(tmp, full, overwrite: true);
                    File.Delete(tmp);
                }
            }
            else
            {
                File.Move(tmp, full);
            }
        }
        finally
        {
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { /* best effort */ }
        }
    }

    public static void WriteAllText(string path, string text) =>
        WriteAllBytes(path, new System.Text.UTF8Encoding(false).GetBytes(text));

    private static void TryCopy(string from, string to)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(to)!);
            File.Copy(from, to, overwrite: true);
        }
        catch { /* a missing backup must never block saving */ }
    }
}
