namespace NoorMD.Core.Security;

/// <summary>
/// Maps requests for https://noormd.local/... to files. App files live under /_noormd/ (from wwwroot);
/// any other path is treated as a relative image reference from the open document and may only
/// resolve to an image file inside that document's folder.
/// </summary>
public static class AssetResolver
{
    public const string Host = "noormd.local";
    public const string Origin = "https://noormd.local";
    public const string AppPrefix = "/_noormd/";

    public static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    { ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif" };

    private static readonly Dictionary<string, string> ContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8", [".js"] = "text/javascript; charset=utf-8", [".css"] = "text/css; charset=utf-8",
        [".json"] = "application/json", [".woff2"] = "font/woff2", [".woff"] = "font/woff", [".txt"] = "text/plain; charset=utf-8",
        [".png"] = "image/png", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".gif"] = "image/gif", [".webp"] = "image/webp",
        [".svg"] = "image/svg+xml", [".bmp"] = "image/bmp", [".ico"] = "image/x-icon", [".avif"] = "image/avif",
    };

    public static string ContentType(string path) =>
        ContentTypes.TryGetValue(Path.GetExtension(path), out var t) ? t : "application/octet-stream";

    public static bool IsAppUri(Uri uri) =>
        uri.Scheme == Uri.UriSchemeHttps && string.Equals(uri.Host, Host, StringComparison.OrdinalIgnoreCase) && uri.IsDefaultPort;

    public const string SketchPagePath = "/_noormd/sketch.html";
    public static bool IsSketchPage(Uri uri) => IsAppUri(uri) && uri.AbsolutePath == SketchPagePath;

    public const string VideoPagePath = "/_noormd/video.html";
    public static bool IsVideoPage(Uri uri) => IsAppUri(uri) && uri.AbsolutePath == VideoPagePath;

    public static bool IsAppPage(Uri uri) => IsAppUri(uri) && (uri.AbsolutePath == "/" || uri.AbsolutePath == "/index.html");

    /// <summary>Returns the file to serve, or null (404). Never returns a path outside the allowed roots.</summary>
    public static string? Resolve(Uri uri, string webRoot, string? documentFolder, string? boundary = null)
    {
        if (!IsAppUri(uri)) return null;
        var path = Uri.UnescapeDataString(uri.AbsolutePath);
        if (path == "/" || path == "/index.html") return SafeCombine(webRoot, "index.html");
        if (path.StartsWith(AppPrefix, StringComparison.Ordinal))
            return SafeCombine(webRoot, path[AppPrefix.Length..]);
        if (documentFolder == null || !ImageExtensions.Contains(Path.GetExtension(path))) return null;
        var rel = path.TrimStart('/');
        var found = SafeCombine(documentFolder, rel);
        if (found != null || boundary == null) return found;
        // The browser resolves "../Images/a.png" against the page itself, so the "../" is gone by the time the request
        // arrives. Look in the parent folders, never above the Vault (boundary) the document belongs to.
        var folder = Path.TrimEndingDirectorySeparator(Path.GetFullPath(documentFolder));
        var stop = Path.TrimEndingDirectorySeparator(Path.GetFullPath(boundary));
        if (!folder.StartsWith(stop + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return null;
        while (!string.Equals(folder, stop, StringComparison.OrdinalIgnoreCase))
        {
            folder = Path.GetDirectoryName(folder)!;
            if ((found = SafeCombine(folder, rel)) != null) return found;
        }
        return null;
    }

    /// <summary>Combines root and a relative path, rejecting traversal, rooted paths, ADS and device names.</summary>
    public static string? SafeCombine(string root, string relative)
    {
        if (string.IsNullOrEmpty(relative) || relative.Contains('\0') || relative.Contains(':')) return null;
        var rel = relative.Replace('\\', '/');
        if (rel.StartsWith('/') || rel.Split('/').Any(seg => seg is ".." )) return null;
        var fullRoot = Path.GetFullPath(root);
        if (!fullRoot.EndsWith(Path.DirectorySeparatorChar)) fullRoot += Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(Path.Combine(fullRoot, rel.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase)) return null;
        return File.Exists(full) ? full : null;
    }
}
