namespace NoorMD3.Host;

/// <summary>What the page asks for by URL: the shell's own files (from its folder) and each bench's files (from its DLL).
/// <c>/benches/&lt;id&gt;/&lt;path&gt;</c> is a bench's; anything else is the shell's. Nothing outside those is served.</summary>
public sealed class ShellAssets(string shellRoot, BenchRegistry benches)
{
    readonly string _root = Path.GetFullPath(shellRoot);

    public (Stream Body, string ContentType)? Open(string urlPath)
    {
        var path = Uri.UnescapeDataString(urlPath.Split('?', '#')[0]).Replace('\\', '/').TrimStart('/');
        if (path.Length == 0) path = "index.html";
        if (path.Split('/').Any(seg => seg is ".." or "." || seg.Contains(':'))) return null;
        if (path.StartsWith("benches/", StringComparison.Ordinal))
        {
            var rest = path["benches/".Length..];
            var slash = rest.IndexOf('/');
            if (slash <= 0) return null;
            var bench = benches.Find(rest[..slash]);
            var s = bench?.OpenAsset(rest[(slash + 1)..]);
            return s == null ? null : (s, ContentType(path));
        }
        var full = Path.GetFullPath(Path.Combine(_root, path));
        if (!full.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(full)) return null;
        return (File.OpenRead(full), ContentType(full));
    }

    public static string ContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" or ".mjs" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".woff2" => "font/woff2",
        ".ico" => "image/x-icon",
        _ => "application/octet-stream",
    };
}
