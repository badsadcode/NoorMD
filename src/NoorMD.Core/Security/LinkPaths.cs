namespace NoorMD.Core.Security;

/// <summary>Relative Markdown links between files on disk.</summary>
public static class LinkPaths
{
    /// <summary>
    /// The link from a document in <paramref name="fromFolder"/> to <paramref name="file"/>, for example
    /// "img/a%20b.png" or "../Images/forest.png". Only succeeds when the file lies inside <paramref name="root"/>
    /// (the document's folder, or its Vault), so links stay portable and NoorMD can show them.
    /// </summary>
    public static bool TryRelative(string fromFolder, string file, string root, out string link)
    {
        link = "";
        var fullRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        var fullFile = Path.GetFullPath(file);
        var fullFrom = Path.GetFullPath(fromFolder);
        if (!IsInside(fullRoot, fullFile) || !(IsInside(fullRoot, fullFrom) || PathEquals(fullRoot, fullFrom))) return false;
        var rel = Path.GetRelativePath(fullFrom, fullFile).Replace('\\', '/');
        if (Path.IsPathRooted(rel)) return false;
        link = string.Join('/', rel.Split('/').Select(seg => seg == ".." ? seg : Uri.EscapeDataString(seg)));
        return true;
    }

    public static bool IsInside(string root, string path)
    {
        var r = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)) + Path.DirectorySeparatorChar;
        return Path.GetFullPath(path).StartsWith(r, StringComparison.OrdinalIgnoreCase);
    }

    public static bool PathEquals(string a, string b) =>
        string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(a)), Path.TrimEndingDirectorySeparator(Path.GetFullPath(b)), StringComparison.OrdinalIgnoreCase);
}
