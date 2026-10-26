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

    public static bool IsAppPage(Uri uri) => IsAppUri(uri) && (uri.AbsolutePath == "/" || uri.AbsolutePath == "/index.html");

    /// <summary>Returns the file to serve, or null (404). Never returns a path outside the allowed roots.</summary>
    public static string? Resolve(Uri uri, string webRoot, string? documentFolder)
    {
        if (!IsAppUri(uri)) return null;
        var path = Uri.UnescapeDataString(uri.AbsolutePath);
        if (path == "/" || path == "/index.html") return SafeCombine(webRoot, "index.html");
        if (path.StartsWith(AppPrefix, StringComparison.Ordinal))
            return SafeCombine(webRoot, path[AppPrefix.Length..]);
        if (documentFolder == null || !ImageExtensions.Contains(Path.GetExtension(path))) return null;
        return SafeCombine(documentFolder, path.TrimStart('/'));
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
