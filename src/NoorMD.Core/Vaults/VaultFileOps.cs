namespace NoorMD.Core.Vaults;

/// <summary>Thrown with a message that can be shown to the user as is.</summary>
public sealed class VaultOperationException(string message) : Exception(message);

/// <summary>A path that moved: open documents follow it.</summary>
public sealed record VaultMove(string OldFull, string NewFull, bool IsFolder);

/// <summary>
/// File operations inside a Vault. Every path is Vault-relative and validated; nothing is ever overwritten
/// (a name that is taken is an error), and nothing outside the Vault can be touched. Deleting is done by the
/// host (to the Recycle Bin), not here.
/// </summary>
public sealed class VaultFileOps(string root)
{
    public string Root { get; } = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));

    private string Full(string rel, bool mustExist = true)
    {
        var full = VaultPaths.Resolve(Root, rel) ?? throw new VaultOperationException("That path is not inside the Vault.");
        if (mustExist && !File.Exists(full) && !Directory.Exists(full)) throw new VaultOperationException($"“{Path.GetFileName(full)}” no longer exists.");
        return full;
    }

    private string Folder(string rel)
    {
        var full = VaultPaths.Resolve(Root, rel) ?? throw new VaultOperationException("That folder is not inside the Vault.");
        if (!Directory.Exists(full)) throw new VaultOperationException("That folder no longer exists.");
        return full;
    }

    private static void CheckName(string name)
    {
        if (VaultPaths.NameProblem(name) is { } problem) throw new VaultOperationException(problem);
    }

    private static void CheckFree(string full)
    {
        if (File.Exists(full) || Directory.Exists(full)) throw new VaultOperationException($"“{Path.GetFileName(full)}” already exists there.");
    }

    public string Rel(string full) => VaultPaths.ToRelative(Root, full) ?? throw new VaultOperationException("That path is not inside the Vault.");

    /// <summary>Creates an empty note ("Untitled.md" or the given name) and returns its Vault path.</summary>
    public string CreateNote(string folderRel, string? name = null, string content = "")
    {
        var folder = Folder(folderRel);
        if (string.IsNullOrWhiteSpace(name)) name = VaultPaths.UniqueName(folder, "Untitled", ".md");
        else if (!VaultPaths.IsNote(name)) name += ".md";
        CheckName(name);
        var full = Path.Combine(folder, name);
        CheckFree(full);
        using (var fs = new FileStream(full, FileMode.CreateNew, FileAccess.Write)) // CreateNew: never replaces a file created a moment ago
        {
            var bytes = new System.Text.UTF8Encoding(false).GetBytes(content);
            fs.Write(bytes);
        }
        return Rel(full);
    }

    public string CreateFolder(string parentRel, string name)
    {
        CheckName(name);
        var full = Path.Combine(Folder(parentRel), name);
        CheckFree(full);
        Directory.CreateDirectory(full);
        return Rel(full);
    }

    /// <summary>Renames in place. Changing only the letter case is allowed.</summary>
    public VaultMove Rename(string rel, string newName)
    {
        CheckName(newName);
        var full = Full(rel);
        if (full == Root) throw new VaultOperationException("The Vault folder itself can't be renamed here. Use Windows Explorer.");
        var isFolder = Directory.Exists(full);
        var target = Path.Combine(Path.GetDirectoryName(full)!, newName);
        if (string.Equals(full, target, StringComparison.Ordinal)) return new VaultMove(full, target, isFolder);
        var caseOnly = string.Equals(full, target, StringComparison.OrdinalIgnoreCase);
        if (!caseOnly) CheckFree(target);
        MovePath(full, target, isFolder, caseOnly);
        return new VaultMove(full, target, isFolder);
    }

    /// <summary>Moves files and folders into a folder. Stops at the first problem; earlier moves are reported.</summary>
    public List<VaultMove> Move(IEnumerable<string> rels, string targetFolderRel)
    {
        var target = Folder(targetFolderRel);
        var moves = new List<VaultMove>();
        foreach (var rel in rels)
        {
            var full = Full(rel);
            if (full == Root) throw new VaultOperationException("The Vault folder itself can't be moved.");
            var isFolder = Directory.Exists(full);
            if (isFolder && (string.Equals(full, target, StringComparison.OrdinalIgnoreCase) || target.StartsWith(full + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)))
                throw new VaultOperationException($"“{Path.GetFileName(full)}” can't be moved into itself.");
            var dest = Path.Combine(target, Path.GetFileName(full));
            if (string.Equals(dest, full, StringComparison.OrdinalIgnoreCase)) continue; // already there
            CheckFree(dest);
            MovePath(full, dest, isFolder, false);
            moves.Add(new VaultMove(full, dest, isFolder));
        }
        return moves;
    }

    /// <summary>Copies a file ("Plan copy.md") or a whole folder next to the original.</summary>
    public string Duplicate(string rel)
    {
        var full = Full(rel);
        if (full == Root) throw new VaultOperationException("The Vault folder itself can't be duplicated.");
        var parent = Path.GetDirectoryName(full)!;
        if (Directory.Exists(full))
        {
            var name = VaultPaths.UniqueName(parent, Path.GetFileName(full) + " copy", "");
            var dest = Path.Combine(parent, name);
            CopyFolder(full, dest);
            return Rel(dest);
        }
        var ext = Path.GetExtension(full);
        var copy = Path.Combine(parent, VaultPaths.UniqueName(parent, Path.GetFileNameWithoutExtension(full) + " copy", ext));
        File.Copy(full, copy, overwrite: false);
        return Rel(copy);
    }

    private static void CopyFolder(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var dir in Directory.EnumerateDirectories(from))
        {
            if (new DirectoryInfo(dir).Attributes.HasFlag(FileAttributes.ReparsePoint)) continue;
            CopyFolder(dir, Path.Combine(to, Path.GetFileName(dir)));
        }
        foreach (var file in Directory.EnumerateFiles(from)) File.Copy(file, Path.Combine(to, Path.GetFileName(file)), overwrite: false);
    }

    private static void MovePath(string from, string to, bool isFolder, bool caseOnly)
    {
        try
        {
            if (caseOnly)
            {
                // Windows treats "a.md" → "A.md" as the same name: go through a temporary name.
                var tmp = from + ".noormd-rename-" + Guid.NewGuid().ToString("N")[..8];
                if (isFolder) { Directory.Move(from, tmp); Directory.Move(tmp, to); }
                else { File.Move(from, tmp); File.Move(tmp, to); }
            }
            else if (isFolder) Directory.Move(from, to);
            else File.Move(from, to, overwrite: false);
        }
        catch (IOException ex) when ((ex.HResult & 0xFFFF) is 32 or 33)
        {
            throw new VaultOperationException($"“{Path.GetFileName(from)}” is in use by another program. Close it there and try again.");
        }
    }
}
